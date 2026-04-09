import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import QRCode from 'react-qr-code';
import type { CardKind, GameMode, PartyMomentPayload, RoomSettings, RoomState } from '@shared';
import {
  DEFAULT_ROOM_SETTINGS,
  MAX_CARD_TEXT_LENGTH,
  MAX_PLAYER_NAME_LENGTH,
  MAX_TEAM_NAME_LENGTH,
} from '@shared';
import { PartyMomentOverlay } from '../party/PartyMomentOverlay';
import { TurnTimerVisual } from '../party/TurnTimerVisual';
import { VoteOverlay } from '../party/VoteOverlay';
import { socket } from '../socket';
import { loadNhieFavorites, toggleNhieFavorite } from '../favorites/nhieFavorites';
import { useCardSwipe } from '../party/useCardSwipe';
import { useLobbyMusic } from '../useLobbyMusic';

function ensureConnected() {
  if (!socket.connected) socket.connect();
}

function hostTokenKey(code: string) {
  return `tod_host_${code}`;
}

function normalizeRoomState(s: RoomState): RoomState {
  const settings: RoomSettings = {
    ...DEFAULT_ROOM_SETTINGS,
    ...s.settings,
  };
  return {
    ...s,
    settings,
    roomLocked: s.roomLocked ?? false,
    turnEndsAt: s.turnEndsAt ?? null,
    teams: s.teams ?? [],
    playerTeamId: s.playerTeamId ?? {},
    teamScores: s.teamScores ?? {},
    teamRevealActive: s.teamRevealActive ?? false,
    voteSession: s.voteSession ?? null,
    deckRecentIndices: s.deckRecentIndices ?? [],
  };
}

function effectiveTurnSeconds(settings: RoomSettings): number {
  const t = settings.turnTimerSeconds;
  if (t === 0) return 0;
  if (t === -1) return settings.turnTimerCustomSeconds;
  return t;
}

function isTextAnswerKind(k: CardKind): boolean {
  return k === 'truth' || k === 'nhie' || k === 'mlt';
}

function cardKindLabel(k: CardKind): string {
  switch (k) {
    case 'nhie':
      return 'Never have I ever';
    case 'mlt':
      return 'Most likely to';
    case 'truth':
      return 'Truth';
    case 'dare':
      return 'Dare';
    default:
      return k;
  }
}

function tagClassForKind(k: CardKind): string {
  if (k === 'dare') return 'tag tag-dare';
  if (k === 'nhie') return 'tag tag-nhie';
  if (k === 'mlt') return 'tag tag-mlt';
  return 'tag tag-truth';
}

export default function RoomPage() {
  const { roomCode: codeParam } = useParams();
  const location = useLocation();
  const roomCode = (codeParam ?? '').toUpperCase();

  const initial = location.state?.initialState as RoomState | undefined;
  const [state, setState] = useState<RoomState | null>(() =>
    initial?.roomCode === roomCode && initial ? normalizeRoomState(initial) : null,
  );
  const [toast, setToast] = useState('');
  const [actionError, setActionError] = useState('');
  const [autoJoinError, setAutoJoinError] = useState('');
  const [myId, setMyId] = useState<string | null>(() =>
    socket.connected ? (socket.id ?? null) : null,
  );
  const [origin] = useState(() =>
    typeof globalThis !== 'undefined' && 'location' in globalThis
      ? globalThis.location.origin
      : '',
  );

  const [joinName, setJoinName] = useState(() => sessionStorage.getItem('tod_display_name') ?? '');
  const [joinAttempted, setJoinAttempted] = useState(!!(initial?.roomCode === roomCode));

  const [truths, setTruths] = useState<string[]>(() =>
    Array(DEFAULT_ROOM_SETTINGS.truthsPerPlayer).fill(''),
  );
  const [dares, setDares] = useState<string[]>(() =>
    Array(DEFAULT_ROOM_SETTINGS.daresPerPlayer).fill(''),
  );
  const [truthAnswer, setTruthAnswer] = useState('');
  const [authorDraft, setAuthorDraft] = useState('');
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [musicOn, setMusicOn] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem('tod_music_on') === '1',
  );
  const [partyMoment, setPartyMoment] = useState<PartyMomentPayload | null>(null);
  const [voteDraft, setVoteDraft] = useState('');
  const teamNameInputA = useRef<HTMLInputElement>(null);
  const teamNameInputB = useRef<HTMLInputElement>(null);
  const [, favBump] = useState(0);

  useLobbyMusic(musicOn);

  useEffect(() => {
    ensureConnected();
    const onConnect = () => setMyId(socket.id ?? null);
    const onDisconnect = () => setMyId(null);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  useEffect(() => {
    if (
      state?.truthAdvanceAt == null &&
      state?.authorDeadlineAt == null &&
      state?.turnEndsAt == null
    )
      return;
    const id = setInterval(() => setNowTick(Date.now()), 500);
    return () => clearInterval(id);
  }, [state?.truthAdvanceAt, state?.authorDeadlineAt, state?.turnEndsAt]);

  useEffect(() => {
    const onState = (s: RoomState) => {
      if (s.roomCode === roomCode) setState(normalizeRoomState(s));
    };
    const onPartyMoment = (p: PartyMomentPayload) => setPartyMoment(p);
    const onHostToken = (p: { hostToken: string }) => {
      sessionStorage.setItem(hostTokenKey(roomCode), p.hostToken);
    };
    const onToast = (p: { message: string }) => {
      setToast(p.message);
      setTimeout(() => setToast(''), 5000);
    };

    socket.on('room_state', onState);
    socket.on('host_token', onHostToken);
    socket.on('error_toast', onToast);
    socket.on('party_moment', onPartyMoment);

    return () => {
      socket.off('room_state', onState);
      socket.off('host_token', onHostToken);
      socket.off('error_toast', onToast);
      socket.off('party_moment', onPartyMoment);
    };
  }, [roomCode]);

  useEffect(() => {
    if (!roomCode) return;
    if (state?.roomCode === roomCode) return;
    if (joinAttempted) return;

    const saved = sessionStorage.getItem('tod_display_name')?.trim();
    if (!saved) {
      queueMicrotask(() => setJoinAttempted(true));
      return;
    }

    queueMicrotask(() => setJoinAttempted(true));
    socket.emit('join_room', { roomCode, playerName: saved }, (res: { ok: boolean; error?: string; roomState?: RoomState }) => {
      if (res?.ok && res.roomState) {
        setState(normalizeRoomState(res.roomState));
        setAutoJoinError('');
      } else {
        setAutoJoinError(res?.error ?? 'Could not join automatically.');
      }
    });
  }, [roomCode, state?.roomCode, joinAttempted]);

  useEffect(() => {
    if (!state) return;
    if (state.phase !== 'writingCards' && state.phase !== 'lobby') return;
    const tp = state.settings.truthsPerPlayer;
    const dp = state.settings.daresPerPlayer;
    const gm = state.gameMode;
    const nhieMlt = gm === 'neverHaveIEver' || gm === 'mostLikelyTo';
    queueMicrotask(() => {
      setTruths((prev) => Array.from({ length: tp }, (_, i) => prev[i] ?? ''));
      setDares((prev) => (nhieMlt ? [] : Array.from({ length: dp }, (_, i) => prev[i] ?? '')));
    });
  }, [
    state,
    state?.settings?.truthsPerPlayer,
    state?.settings?.daresPerPlayer,
    state?.phase,
    state?.gameMode,
  ]);

  const isHost = useMemo(() => {
    if (!state || !myId) return false;
    return state.hostId === myId;
  }, [state, myId]);

  const truthSecondsLeft =
    state?.truthAdvanceAt == null
      ? null
      : Math.max(0, Math.ceil((state.truthAdvanceAt - nowTick) / 1000));

  const authorSecondsLeft =
    state?.authorDeadlineAt == null
      ? null
      : Math.max(0, Math.ceil((state.authorDeadlineAt - nowTick) / 1000));

  const hostToken = sessionStorage.getItem(hostTokenKey(roomCode)) ?? '';

  const handleJoinManual = () => {
    setActionError('');
    const trimmed = joinName.trim();
    if (!trimmed) {
      setActionError('Enter your name.');
      return;
    }
    sessionStorage.setItem('tod_display_name', trimmed);
    socket.emit('join_room', { roomCode, playerName: trimmed }, (res: { ok: boolean; error?: string; roomState?: RoomState }) => {
      if (!res?.ok) {
        setActionError(res?.error ?? 'Could not join.');
        return;
      }
      sessionStorage.setItem('tod_last_room', roomCode);
      setState(normalizeRoomState(res.roomState!));
    });
  };

  const startWriting = () => {
    setActionError('');
    socket.emit('start_writing', { hostToken }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setActionError(res?.error ?? 'Failed.');
    });
  };

  const setGameMode = (gameMode: GameMode) => {
    setActionError('');
    socket.emit('set_game_mode', { hostToken, gameMode }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setActionError(res?.error ?? 'Could not change mode.');
    });
  };

  const startPickAuthor = () => {
    setActionError('');
    socket.emit('start_pick_author', { hostToken }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setActionError(res?.error ?? 'Failed.');
    });
  };

  const updateRoomSettings = (partial: Partial<RoomSettings>) => {
    setActionError('');
    socket.emit(
      'update_room_settings',
      { hostToken, settings: partial },
      (res: { ok: boolean; error?: string }) => {
        if (!res?.ok) setActionError(res?.error ?? 'Could not update settings.');
      },
    );
  };

  const pickTruthOrDare = (choice: 'truth' | 'dare') => {
    setActionError('');
    socket.emit('pick_truth_or_dare', { choice }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setActionError(res?.error ?? 'Could not choose.');
    });
  };

  const submitAuthorPrompt = () => {
    setActionError('');
    socket.emit('submit_author_prompt', { text: authorDraft }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setActionError(res?.error ?? 'Could not submit prompt.');
      else setAuthorDraft('');
    });
  };

  const submitCards = () => {
    setActionError('');
    const gm = state?.gameMode ?? 'sharedDeck';
    const nhieMlt = gm === 'neverHaveIEver' || gm === 'mostLikelyTo';
    socket.emit(
      'submit_cards',
      { truths, dares: nhieMlt ? [] : dares },
      (res: { ok: boolean; error?: string }) => {
        if (!res?.ok) setActionError(res?.error ?? 'Invalid cards.');
      },
    );
  };

  const lockDeck = () => {
    setActionError('');
    socket.emit('lock_in_deck', { hostToken }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setActionError(res?.error ?? 'Could not start.');
    });
  };

  const submitTruth = () => {
    setActionError('');
    socket.emit('submit_truth_answer', { text: truthAnswer }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setActionError(res?.error ?? 'Could not submit.');
      else setTruthAnswer('');
    });
  };

  const dareDone = () => {
    setActionError('');
    socket.emit('dare_done', {}, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setActionError(res?.error ?? 'Could not mark done.');
    });
  };

  const toggleRoomLock = (locked: boolean) => {
    setActionError('');
    socket.emit(
      'toggle_room_lock',
      { hostToken, locked },
      (res: { ok: boolean; error?: string }) => {
        if (!res?.ok) setActionError(res?.error ?? 'Could not change lock.');
      },
    );
  };

  const kickPlayer = (targetId: string) => {
    setActionError('');
    socket.emit(
      'kick_player',
      { hostToken, targetId },
      (res: { ok: boolean; error?: string }) => {
        if (!res?.ok) setActionError(res?.error ?? 'Could not remove player.');
      },
    );
  };

  const skipRound = () => {
    setActionError('');
    socket.emit('skip_round', { hostToken }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setActionError(res?.error ?? 'Could not skip.');
    });
  };

  const restartGame = () => {
    if (!window.confirm('Restart and return everyone to the lobby?')) return;
    setActionError('');
    socket.emit('restart_game', { hostToken }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setActionError(res?.error ?? 'Could not restart.');
    });
  };

  const pushTeamNames = () => {
    setActionError('');
    const nameA = teamNameInputA.current?.value?.trim() || 'Team A';
    const nameB = teamNameInputB.current?.value?.trim() || 'Team B';
    socket.emit(
      'set_team_names',
      { hostToken, nameA, nameB },
      (res: { ok: boolean; error?: string }) => {
        if (!res?.ok) setActionError(res?.error ?? 'Could not save team names.');
      },
    );
  };

  const autoBalanceTeams = () => {
    setActionError('');
    socket.emit('auto_balance_teams', { hostToken }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setActionError(res?.error ?? 'Could not balance.');
    });
  };

  const assignTeam = (playerId: string, teamId: string) => {
    setActionError('');
    socket.emit(
      'assign_player_team',
      { hostToken, playerId, teamId },
      (res: { ok: boolean; error?: string }) => {
        if (!res?.ok) setActionError(res?.error ?? 'Could not assign.');
      },
    );
  };

  const teamRevealShow = () => {
    setActionError('');
    socket.emit('team_reveal_show', { hostToken }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setActionError(res?.error ?? 'Could not show reveal.');
    });
  };

  const teamRevealDismiss = () => {
    setActionError('');
    socket.emit('team_reveal_dismiss', { hostToken }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setActionError(res?.error ?? 'Could not dismiss.');
    });
  };

  const startHostVote = (mode: 'players' | 'teams') => {
    setActionError('');
    const question = voteDraft.trim();
    if (!question) {
      setActionError('Write a vote question.');
      return;
    }
    socket.emit(
      'start_vote',
      { hostToken, question, mode },
      (res: { ok: boolean; error?: string }) => {
        if (!res?.ok) setActionError(res?.error ?? 'Could not start vote.');
        else setVoteDraft('');
      },
    );
  };

  const castVote = (voteId: string) => {
    socket.emit('cast_vote', { voteId }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setActionError(res?.error ?? 'Vote failed.');
    });
  };

  const revealVotes = () => {
    socket.emit('reveal_votes', { hostToken }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setActionError(res?.error ?? 'Could not reveal.');
    });
  };

  const clearVote = () => {
    socket.emit('clear_vote', { hostToken }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setActionError(res?.error ?? 'Could not clear vote.');
    });
  };

  const { swipeHandlers } = useCardSwipe(
    () => {
      if (isHost) skipRound();
    },
    Boolean(
      isHost &&
        state &&
        (state.phase === 'turn' || state.phase === 'revealTurn' || state.phase === 'pickType'),
    ),
  );

  if (!roomCode) {
    return (
      <p>
        <Link to="/">Back home</Link>
      </p>
    );
  }

  if (!state) {
    return (
      <>
        <h1>Join room</h1>
        <p className="muted">Code: {roomCode}</p>
        <div className="card-panel">
          <label htmlFor="jn">Your name</label>
          <input
            id="jn"
            value={joinName}
            onChange={(e) => setJoinName(e.target.value)}
            maxLength={MAX_PLAYER_NAME_LENGTH}
          />
          <button type="button" className="btn-primary" onClick={handleJoinManual}>
            Join room
          </button>
        </div>
        {autoJoinError ? <p className="error">{autoJoinError}</p> : null}
        {actionError ? <p className="error">{actionError}</p> : null}
        <p style={{ marginTop: '1rem' }}>
          <Link to="/">Home</Link>
        </p>
      </>
    );
  }

  const settings = state.settings ?? DEFAULT_ROOM_SETTINGS;
  const gameMode = state.gameMode ?? 'sharedDeck';
  const totalPickTurns = state.players.length * settings.pickCycles;
  const joinUrl = origin ? `${origin}/room/${state.roomCode}` : '';
  const turnSec = effectiveTurnSeconds(settings);
  const teamLabelA = state.teams.find((t) => t.id === 't1')?.name ?? 'Team A';
  const teamLabelB = state.teams.find((t) => t.id === 't2')?.name ?? 'Team B';

  const currentPlayCard =
    state.phase === 'turn'
      ? (state.deck[state.currentCardIndex] ?? null)
      : state.phase === 'revealTurn'
        ? state.spotCard
        : null;

  const iAmActive = state.activePlayerId === myId;
  const activeName = state.players.find((p) => p.id === state.activePlayerId)?.name ?? '…';

  const subjectName =
    state.subjectPlayerId == null
      ? '…'
      : (state.players.find((p) => p.id === state.subjectPlayerId)?.name ?? '…');
  const authorName =
    state.authorPlayerId == null
      ? '…'
      : (state.players.find((p) => p.id === state.authorPlayerId)?.name ?? '…');

  const iAmSubject = state.subjectPlayerId === myId;
  const iAmAuthor = state.authorPlayerId === myId;

  return (
    <>
      {toast ? (
        <div className="card-panel" style={{ borderColor: 'rgba(252,165,165,0.4)' }}>
          {toast}
        </div>
      ) : null}

      {partyMoment ? (
        <PartyMomentOverlay moment={partyMoment} onClose={() => setPartyMoment(null)} />
      ) : null}

      {state.teamRevealActive ? (
        <div className="team-reveal-overlay">
          <div className="team-reveal-card">
            <h2>Teams locked in</h2>
            <div className="team-reveal-grid">
              {state.teams.map((t) => (
                <div key={t.id} className="team-reveal-box">
                  <h3>{t.name}</h3>
                  <ul className="team-reveal-list">
                    {state.players
                      .filter((p) => state.playerTeamId[p.id] === t.id)
                      .map((p) => (
                        <li key={p.id}>{p.name}</li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
            {isHost ? (
              <button type="button" className="btn-primary" onClick={teamRevealDismiss}>
                Let&apos;s play
              </button>
            ) : (
              <p className="muted">Waiting for host…</p>
            )}
          </div>
        </div>
      ) : null}

      {state.voteSession ? (
        <VoteOverlay
          teams={state.teams}
          players={state.players}
          vote={state.voteSession}
          myId={myId}
          onVote={castVote}
        />
      ) : null}

      {isHost && state.voteSession ? (
        <div className="host-vote-bar host-vote-bar--split">
          {!state.voteSession.revealed ? (
            <button type="button" className="btn-secondary" onClick={revealVotes}>
              Reveal votes
            </button>
          ) : null}
          <button type="button" className="btn-secondary" onClick={clearVote}>
            Clear vote
          </button>
        </div>
      ) : null}

      <p className="muted" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
        Room <strong style={{ color: '#e8ddff' }}>{state.roomCode}</strong>
        {isHost ? <span className="badge-host">Host</span> : null}
        <button
          type="button"
          className="btn-secondary"
          style={{ width: 'auto', padding: '0.35rem 0.75rem', margin: 0 }}
          onClick={() => {
            const next = !musicOn;
            setMusicOn(next);
            localStorage.setItem('tod_music_on', next ? '1' : '0');
          }}
        >
          {musicOn ? 'Music on' : 'Music off'}
        </button>
      </p>

      {state.phase === 'lobby' && (
        <section>
          <h1>Lobby</h1>
          <p className="muted">Share this URL or the code so friends can join.</p>
          <div className="card-panel">
            <div className="qr-row">
              {joinUrl ? (
                <div className="qr-box" aria-hidden>
                  <QRCode value={joinUrl} size={112} fgColor="#1a1228" bgColor="#e8ddff" />
                </div>
              ) : null}
              <div className="qr-copy">
                <p className="muted" style={{ wordBreak: 'break-all', margin: '0 0 0.5rem' }}>
                  {joinUrl || `…/room/${state.roomCode}`}
                </p>
                {joinUrl ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ marginTop: 0 }}
                    onClick={() => void navigator.clipboard.writeText(joinUrl)}
                  >
                    Copy link
                  </button>
                ) : null}
              </div>
            </div>
            <p className="muted lock-line">
              {state.roomLocked ? 'Room locked — no new joins.' : 'Room open — friends can join.'}
              {isHost ? (
                <button
                  type="button"
                  className="btn-secondary lock-toggle"
                  onClick={() => toggleRoomLock(!state.roomLocked)}
                >
                  {state.roomLocked ? 'Unlock' : 'Lock room'}
                </button>
              ) : null}
            </p>
            <h2>Players ({state.players.length})</h2>
            <ul className="player-list">
              {state.players.map((p) => (
                <li key={p.id} className="player-row">
                  <span>
                    {p.name}
                    {p.id === state.hostId ? <span className="badge-host">host</span> : null}
                    {p.id === myId ? <span className="badge-you">you</span> : null}
                  </span>
                  {isHost && p.id !== myId ? (
                    <button type="button" className="btn-kick" onClick={() => kickPlayer(p.id)}>
                      Remove
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>

            {isHost ? (
              <div className="card-panel" style={{ marginTop: '1rem', padding: '1rem' }}>
                <h2 style={{ marginTop: 0 }}>Teams (optional)</h2>
                <p className="muted" style={{ marginTop: 0 }}>
                  Turn on for team points and team votes. Show a reveal screen before starting.
                </p>
                <label className="toggle-line">
                  <input
                    type="checkbox"
                    checked={settings.teamsEnabled}
                    onChange={(e) => updateRoomSettings({ teamsEnabled: e.target.checked })}
                  />{' '}
                  Team mode
                </label>
                {settings.teamsEnabled ? (
                  <>
                    <div className="team-name-row">
                      <label htmlFor="tn-a">Team 1</label>
                      <input
                        ref={teamNameInputA}
                        id="tn-a"
                        key={`ta-${teamLabelA}`}
                        maxLength={MAX_TEAM_NAME_LENGTH}
                        defaultValue={teamLabelA}
                      />
                      <label htmlFor="tn-b">Team 2</label>
                      <input
                        ref={teamNameInputB}
                        id="tn-b"
                        key={`tb-${teamLabelB}`}
                        maxLength={MAX_TEAM_NAME_LENGTH}
                        defaultValue={teamLabelB}
                      />
                    </div>
                    <button type="button" className="btn-secondary" onClick={pushTeamNames}>
                      Save team names
                    </button>
                    <button type="button" className="btn-secondary" onClick={autoBalanceTeams}>
                      Auto-balance
                    </button>
                    <ul className="team-assign">
                      {state.players.map((p) => (
                        <li key={p.id}>
                          {p.name}
                          <select
                            value={state.playerTeamId[p.id] ?? 't1'}
                            onChange={(e) => assignTeam(p.id, e.target.value)}
                            aria-label={`Team for ${p.name}`}
                          >
                            <option value="t1">{teamLabelA}</option>
                            <option value="t2">{teamLabelB}</option>
                          </select>
                        </li>
                      ))}
                    </ul>
                    <button type="button" className="btn-secondary" onClick={teamRevealShow}>
                      Team reveal screen
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}

            {isHost ? (
              <div className="card-panel" style={{ marginTop: '1rem', padding: '1rem' }}>
                <h2 style={{ marginTop: 0 }}>Game settings</h2>
                <p className="muted" style={{ marginTop: 0 }}>
                  Applies to this room once you start. Everyone sees the same timers.
                </p>
                <label htmlFor="st-truth" style={{ marginTop: '0.5rem' }}>
                  Truths per person (shared deck)
                </label>
                <input
                  id="st-truth"
                  type="number"
                  min={1}
                  max={10}
                  value={settings.truthsPerPlayer}
                  onChange={(e) =>
                    updateRoomSettings({ truthsPerPlayer: Number(e.target.value) || 1 })
                  }
                />
                <label htmlFor="st-dare">Dares per person (shared deck)</label>
                <input
                  id="st-dare"
                  type="number"
                  min={1}
                  max={10}
                  value={settings.daresPerPlayer}
                  onChange={(e) =>
                    updateRoomSettings({ daresPerPlayer: Number(e.target.value) || 1 })
                  }
                />
                <label htmlFor="st-read">Truth answer on screen (seconds)</label>
                <input
                  id="st-read"
                  type="number"
                  min={3}
                  max={120}
                  value={Math.round(settings.truthAnswerDisplayMs / 1000)}
                  onChange={(e) =>
                    updateRoomSettings({
                      truthAnswerDisplayMs: Math.max(3000, (Number(e.target.value) || 10) * 1000),
                    })
                  }
                />
                <label htmlFor="st-author">Time to write prompt — pick &amp; write (seconds)</label>
                <input
                  id="st-author"
                  type="number"
                  min={15}
                  max={300}
                  value={Math.round(settings.authorPromptMs / 1000)}
                  onChange={(e) =>
                    updateRoomSettings({
                      authorPromptMs: Math.max(15000, (Number(e.target.value) || 90) * 1000),
                    })
                  }
                />
                <label htmlFor="st-cycles">Full rounds (pick &amp; write)</label>
                <input
                  id="st-cycles"
                  type="number"
                  min={1}
                  max={10}
                  value={settings.pickCycles}
                  onChange={(e) =>
                    updateRoomSettings({ pickCycles: Number(e.target.value) || 1 })
                  }
                />
                <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.75rem' }}>
                  Turn timer (pick Truth/Dare, play turns — optional)
                </p>
                <div className="timer-presets">
                  {(
                    [
                      ['Off', 0],
                      ['15s', 15],
                      ['30s', 30],
                      ['60s', 60],
                      ['Custom', -1],
                    ] as const
                  ).map(([label, val]) => (
                    <button
                      key={label}
                      type="button"
                      className={
                        settings.turnTimerSeconds === val ? 'btn-primary timer-preset' : 'btn-secondary timer-preset'
                      }
                      onClick={() => updateRoomSettings({ turnTimerSeconds: val })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {settings.turnTimerSeconds === -1 ? (
                  <>
                    <label htmlFor="st-custom-t">Custom seconds</label>
                    <input
                      id="st-custom-t"
                      type="number"
                      min={5}
                      max={300}
                      value={settings.turnTimerCustomSeconds}
                      onChange={(e) =>
                        updateRoomSettings({
                          turnTimerCustomSeconds: Math.min(300, Math.max(5, Number(e.target.value) || 45)),
                        })
                      }
                    />
                  </>
                ) : null}
                <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 0 }}>
                  One round = everyone gets one turn. Increase for more prompts.
                </p>
                <label htmlFor="mlt-cat" style={{ marginTop: '0.75rem' }}>
                  Most likely to — category (built-in prompts)
                </label>
                <select
                  id="mlt-cat"
                  value={settings.mostLikelyCategory}
                  onChange={(e) =>
                    updateRoomSettings({
                      mostLikelyCategory: e.target.value as RoomSettings['mostLikelyCategory'],
                    })
                  }
                >
                  <option value="spicy">Spicy / flirty</option>
                  <option value="dumb">Dumb / chaotic</option>
                  <option value="college">College</option>
                  <option value="embarrassing">Embarrassing</option>
                </select>
              </div>
            ) : null}

            {isHost ? (
              <div className="card-panel" style={{ marginTop: '1rem', padding: '1rem' }}>
                <h2 style={{ marginTop: 0 }}>Game mode</h2>
                <p className="muted" style={{ marginTop: 0 }}>
                  Classic Truth or Dare, Never Have I Ever, or Most Likely To (plus built-in prompts). Pick
                  &amp; write: each turn one person chooses T/D, then a random player writes the prompt.
                </p>
                <div className="mode-grid">
                  <button
                    type="button"
                    className={gameMode === 'sharedDeck' ? 'btn-primary' : 'btn-secondary'}
                    onClick={() => setGameMode('sharedDeck')}
                  >
                    Truth or Dare deck
                  </button>
                  <button
                    type="button"
                    className={gameMode === 'neverHaveIEver' ? 'btn-primary' : 'btn-secondary'}
                    onClick={() => setGameMode('neverHaveIEver')}
                  >
                    Never have I ever
                  </button>
                  <button
                    type="button"
                    className={gameMode === 'mostLikelyTo' ? 'btn-primary' : 'btn-secondary'}
                    onClick={() => setGameMode('mostLikelyTo')}
                  >
                    Most likely to
                  </button>
                  <button
                    type="button"
                    className={gameMode === 'pickAndWrite' ? 'btn-primary' : 'btn-secondary'}
                    onClick={() => setGameMode('pickAndWrite')}
                  >
                    Pick &amp; write
                  </button>
                </div>
              </div>
            ) : (
              <p className="muted" style={{ marginTop: '0.75rem' }}>
                Mode:{' '}
                <strong>
                  {gameMode === 'pickAndWrite'
                    ? 'Pick & write'
                    : gameMode === 'neverHaveIEver'
                      ? 'Never have I ever'
                      : gameMode === 'mostLikelyTo'
                        ? 'Most likely to'
                        : 'Truth or Dare deck'}
                </strong>
              </p>
            )}

            {isHost ? (
              <div className="card-panel" style={{ marginTop: '1rem', padding: '1rem' }}>
                <h2 style={{ marginTop: 0 }}>Party vote</h2>
                <p className="muted" style={{ marginTop: 0 }}>
                  Quick poll — secret ballots, host reveals when ready.
                </p>
                <label htmlFor="vote-q">Question</label>
                <textarea
                  id="vote-q"
                  value={voteDraft}
                  onChange={(e) => setVoteDraft(e.target.value)}
                  placeholder="Who had the worst dare?"
                  maxLength={200}
                  rows={2}
                />
                <button type="button" className="btn-secondary" onClick={() => startHostVote('players')}>
                  Start player vote
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!settings.teamsEnabled}
                  onClick={() => startHostVote('teams')}
                >
                  Start team vote
                </button>
              </div>
            ) : null}

            {isHost ? (
              gameMode === 'pickAndWrite' ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={startPickAuthor}
                  disabled={state.players.length < 2}
                >
                  Start pick &amp; write game
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={startWriting}
                  disabled={state.players.length < 2}
                >
                  {gameMode === 'neverHaveIEver'
                    ? 'Start writing prompts'
                    : gameMode === 'mostLikelyTo'
                      ? 'Start writing prompts'
                      : 'Start writing cards'}
                </button>
              )
            ) : (
              <p className="muted">Waiting for the host to start…</p>
            )}
            {state.players.length < 2 ? (
              <p className="muted" style={{ marginTop: '0.5rem' }}>
                Need at least 2 players.
              </p>
            ) : null}
          </div>
        </section>
      )}

      {state.phase === 'writingCards' && (
        <section>
          <h1>
            {gameMode === 'neverHaveIEver'
              ? 'Write your Never have I ever… lines'
              : gameMode === 'mostLikelyTo'
                ? 'Write your Most likely to… prompts'
                : 'Write your cards'}
          </h1>
          <p className="muted">
            {gameMode === 'neverHaveIEver' || gameMode === 'mostLikelyTo' ? (
              <>
                {settings.truthsPerPlayer} prompts each (max {MAX_CARD_TEXT_LENGTH} chars).{' '}
                {gameMode === 'mostLikelyTo'
                  ? 'The deck mixes your lines with category prompts from the host.'
                  : 'Favorites are saved on this device only.'}
              </>
            ) : (
              <>
                {settings.truthsPerPlayer} truths and {settings.daresPerPlayer} dares each (max{' '}
                {MAX_CARD_TEXT_LENGTH} chars).
              </>
            )}
          </p>

          <div className="card-panel">
            <h2>{gameMode === 'neverHaveIEver' ? 'Your statements' : gameMode === 'mostLikelyTo' ? 'Your prompts' : 'Your truths'}</h2>
            {gameMode === 'neverHaveIEver' && !state.submittedPlayerIds.includes(myId ?? '') ? (
              <div className="fav-block">
                <p className="muted" style={{ marginTop: 0 }}>
                  Favorites (this device)
                </p>
                <div className="fav-chips">
                  {loadNhieFavorites().map((f) => (
                    <button
                      key={f}
                      type="button"
                      className="fav-chip"
                      onClick={() => {
                        const empty = truths.findIndex((x) => !x.trim());
                        const idx = empty >= 0 ? empty : 0;
                        const next = [...truths];
                        next[idx] = f;
                        setTruths(next);
                      }}
                    >
                      {f.length > 42 ? `${f.slice(0, 40)}…` : f}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {truths.map((t, i) => (
              <div key={`t-${i}`} style={{ marginBottom: '0.75rem' }}>
                <label htmlFor={`t-${i}`}>
                  {gameMode === 'neverHaveIEver'
                    ? `Line ${i + 1}`
                    : gameMode === 'mostLikelyTo'
                      ? `Prompt ${i + 1}`
                      : `Truth ${i + 1}`}
                </label>
                <textarea
                  id={`t-${i}`}
                  value={t}
                  maxLength={MAX_CARD_TEXT_LENGTH}
                  disabled={state.submittedPlayerIds.includes(myId ?? '')}
                  onChange={(e) => {
                    const next = [...truths];
                    next[i] = e.target.value;
                    setTruths(next);
                  }}
                />
                {gameMode === 'neverHaveIEver' && t.trim() ? (
                  <button
                    type="button"
                    className="btn-secondary fav-star"
                    onClick={() => {
                      toggleNhieFavorite(t);
                      favBump((n) => n + 1);
                    }}
                  >
                    {loadNhieFavorites().some((x) => x.trim().toLowerCase() === t.trim().toLowerCase())
                      ? '★ Saved'
                      : '☆ Save to favorites'}
                  </button>
                ) : null}
              </div>
            ))}
            {gameMode !== 'neverHaveIEver' && gameMode !== 'mostLikelyTo' ? (
              <>
                <h2>Your dares</h2>
                {dares.map((t, i) => (
                  <div key={`d-${i}`} style={{ marginBottom: '0.75rem' }}>
                    <label htmlFor={`d-${i}`}>Dare {i + 1}</label>
                    <textarea
                      id={`d-${i}`}
                      value={t}
                      maxLength={MAX_CARD_TEXT_LENGTH}
                      disabled={state.submittedPlayerIds.includes(myId ?? '')}
                      onChange={(e) => {
                        const next = [...dares];
                        next[i] = e.target.value;
                        setDares(next);
                      }}
                    />
                  </div>
                ))}
              </>
            ) : null}

            {!state.submittedPlayerIds.includes(myId ?? '') ? (
              <button type="button" className="btn-primary" onClick={submitCards}>
                Submit my cards
              </button>
            ) : (
              <p className="muted">You are done. Waiting for others…</p>
            )}

            <h2 style={{ marginTop: '1.25rem' }}>Status</h2>
            <ul className="player-list">
              {state.players.map((p) => (
                <li key={p.id}>
                  {p.name}
                  {state.submittedPlayerIds.includes(p.id) ? (
                    <span style={{ color: '#86efac', fontSize: '0.8rem' }}>submitted</span>
                  ) : (
                    <span style={{ color: '#a78bfa', fontSize: '0.8rem' }}>writing…</span>
                  )}
                </li>
              ))}
            </ul>

            {isHost ? (
              <button type="button" className="btn-secondary" onClick={lockDeck}>
                Start with submitted cards only
              </button>
            ) : null}
          </div>
        </section>
      )}

      {state.phase === 'pickType' && (
        <section>
          <h1>Pick &amp; write</h1>
          <p className="muted">
            Turn {state.pickAuthorRound + 1} of {totalPickTurns}
          </p>
          {settings.teamsEnabled ? (
            <div className="team-scores-strip">
              {state.teams.map((t) => (
                <span key={t.id} className="team-score-pill">
                  {t.name}: {state.teamScores[t.id] ?? 0}
                </span>
              ))}
            </div>
          ) : null}
          <TurnTimerVisual
            turnEndsAt={state.turnEndsAt}
            totalSeconds={turnSec}
            nowTick={nowTick}
          />
          {isHost ? (
            <div className="host-play-bar">
              <button type="button" className="btn-secondary" onClick={skipRound}>
                Skip round
              </button>
              <button type="button" className="btn-secondary" onClick={restartGame}>
                Restart to lobby
              </button>
            </div>
          ) : null}
          <div className="card-panel card-play-surface" {...swipeHandlers}>
            <p className="prompt-text" style={{ fontSize: '1.05rem' }}>
              <strong>{subjectName}</strong>, choose:
            </p>
            {isHost ? <p className="muted swipe-hint">Swipe left on card to skip (host)</p> : null}
            {iAmSubject ? (
              <>
                <button type="button" className="btn-primary" onClick={() => pickTruthOrDare('truth')}>
                  Truth
                </button>
                <button type="button" className="btn-dare" onClick={() => pickTruthOrDare('dare')}>
                  Dare
                </button>
              </>
            ) : (
              <p className="muted">Waiting for {subjectName} to pick Truth or Dare…</p>
            )}
          </div>
        </section>
      )}

      {state.phase === 'authorPrompt' && (
        <section>
          <h1>Write the prompt</h1>
          <p className="muted">
            {subjectName} chose <strong>{state.pickedKind}</strong>.{' '}
            <strong>{authorName}</strong> must write it.
            {authorSecondsLeft != null ? (
              <>
                {' '}
                Time left: <strong>{authorSecondsLeft}s</strong>
              </>
            ) : null}
          </p>
          <div className="card-panel">
            {iAmAuthor ? (
              <>
                <label htmlFor="author-prompt">Your {state.pickedKind} for {subjectName}</label>
                <textarea
                  id="author-prompt"
                  value={authorDraft}
                  onChange={(e) => setAuthorDraft(e.target.value)}
                  maxLength={MAX_CARD_TEXT_LENGTH}
                  placeholder={state.pickedKind === 'truth' ? 'What should they answer truthfully?' : 'What should they do?'}
                />
                <button type="button" className="btn-primary" onClick={submitAuthorPrompt}>
                  Lock in prompt
                </button>
              </>
            ) : (
              <p className="muted">
                Waiting for <strong>{authorName}</strong> to write the {state.pickedKind}…
              </p>
            )}
          </div>
        </section>
      )}

      {state.phase === 'shuffling' && (
        <section>
          <h1>Shuffling</h1>
          <div className="card-panel shuffle-pulse">Mixing the deck…</div>
        </section>
      )}

      {(state.phase === 'turn' || state.phase === 'revealTurn') && currentPlayCard && (
        <section>
          <h1>
            {state.phase === 'revealTurn'
              ? `Pick & write — turn ${state.pickAuthorRound + 1} of ${totalPickTurns}`
              : gameMode === 'neverHaveIEver'
                ? `Never have I ever — ${state.currentCardIndex + 1} of ${state.deck.length}`
                : gameMode === 'mostLikelyTo'
                  ? `Most likely to — ${state.currentCardIndex + 1} of ${state.deck.length}`
                  : `Round ${state.currentCardIndex + 1}`}
          </h1>
          <p className="muted">
            {state.phase === 'revealTurn'
              ? `${subjectName} is up`
              : `Card ${state.currentCardIndex + 1} of ${state.deck.length}`}
          </p>
          {settings.teamsEnabled ? (
            <div className="team-scores-strip">
              {state.teams.map((t) => (
                <span key={t.id} className="team-score-pill">
                  {t.name}: {state.teamScores[t.id] ?? 0}
                </span>
              ))}
            </div>
          ) : null}
          <TurnTimerVisual
            turnEndsAt={state.turnEndsAt}
            totalSeconds={turnSec}
            nowTick={nowTick}
          />
          {isHost ? (
            <div className="host-play-bar">
              <button type="button" className="btn-secondary" onClick={skipRound}>
                Skip round
              </button>
              <button type="button" className="btn-secondary" onClick={restartGame}>
                Restart to lobby
              </button>
            </div>
          ) : null}

          <div className="card-panel card-play-surface" {...swipeHandlers}>
            <span className={tagClassForKind(currentPlayCard.kind)}>{cardKindLabel(currentPlayCard.kind)}</span>
            <p className="prompt-text">
              {currentPlayCard.kind === 'nhie' ? (
                <>
                  Never have I ever… <em>{currentPlayCard.text}</em>
                </>
              ) : currentPlayCard.kind === 'mlt' ? (
                <>
                  Who is most likely to… <em>{currentPlayCard.text}</em>
                </>
              ) : (
                currentPlayCard.text
              )}
            </p>

            <p className="muted">
              Active: <strong style={{ color: '#fde047' }}>{activeName}</strong>
              {iAmActive ? <span className="badge-active">your turn</span> : null}
              {isHost ? (
                <span className="muted swipe-hint"> · Swipe left to skip (host)</span>
              ) : null}
            </p>

            {isTextAnswerKind(currentPlayCard.kind) && (
              <>
                {state.truthAnswer ? (
                  <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(59,130,246,0.12)', borderRadius: '0.5rem' }}>
                    <p className="muted" style={{ margin: 0 }}>
                      {currentPlayCard.kind === 'nhie'
                        ? 'Response'
                        : currentPlayCard.kind === 'mlt'
                          ? 'Call'
                          : 'Answer'}
                    </p>
                    <p style={{ margin: '0.35rem 0 0' }}>{state.truthAnswer}</p>
                    {truthSecondsLeft != null ? (
                      <p className="muted" style={{ margin: '0.75rem 0 0', fontSize: '0.9rem' }}>
                        {truthSecondsLeft > 0
                          ? `Next card in ${truthSecondsLeft}s — time to read.`
                          : 'Next card…'}
                      </p>
                    ) : null}
                  </div>
                ) : iAmActive ? (
                  <>
                    <label htmlFor="ans">
                      {currentPlayCard.kind === 'nhie'
                        ? 'Have you? Say I have / I haven’t — or explain.'
                        : currentPlayCard.kind === 'mlt'
                          ? 'Name someone (or explain).'
                          : 'Your answer'}
                    </label>
                    <textarea
                      id="ans"
                      value={truthAnswer}
                      onChange={(e) => setTruthAnswer(e.target.value)}
                      maxLength={MAX_CARD_TEXT_LENGTH * 2}
                    />
                    <button type="button" className="btn-primary" onClick={submitTruth}>
                      Submit answer
                    </button>
                  </>
                ) : (
                  <p className="muted">Waiting for {activeName} to answer…</p>
                )}
              </>
            )}

            {currentPlayCard.kind === 'dare' && (
              <>
                {iAmActive ? (
                  <button type="button" className="btn-dare" onClick={dareDone}>
                    I finished the dare
                  </button>
                ) : (
                  <p className="muted">Waiting for {activeName} to finish the dare…</p>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {state.phase === 'finished' && (
        <section>
          <h1>Done</h1>
          <div className="card-panel">
            <p>
              {gameMode === 'pickAndWrite'
                ? 'Everyone had their turn. Nice game!'
                : gameMode === 'neverHaveIEver'
                  ? 'That’s every line — legendary.'
                  : gameMode === 'mostLikelyTo'
                    ? 'Deck finished — chaos contained.'
                    : 'You made it through the whole deck.'}
            </p>
            <p className="muted">Start a new room from home to play again.</p>
          </div>
        </section>
      )}

      {actionError ? <p className="error">{actionError}</p> : null}

      <p style={{ marginTop: '1.5rem' }}>
        <Link to="/">Home</Link>
      </p>

      <p className="disclaimer">
        Play with people you trust. Content is shared live in this room and is not stored long-term.
      </p>
    </>
  );
}
