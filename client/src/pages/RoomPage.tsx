import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import type { CardKind, GameMode, PartyMomentPayload, RoomSettings, RoomState } from '@shared';
import { QrCode } from '../components/QrCode';
import {
  DEFAULT_ROOM_SETTINGS,
  MAX_CARD_TEXT_LENGTH,
  MAX_PLAYER_NAME_LENGTH,
} from '@shared';
import { PartyMomentOverlay } from '../party/PartyMomentOverlay';
import { TurnTimerVisual } from '../party/TurnTimerVisual';
import { VoteOverlay } from '../party/VoteOverlay';
import { socket } from '../socket';
import { loadNhieFavorites, toggleNhieFavorite } from '../favorites/nhieFavorites';
import { useCardSwipe } from '../party/useCardSwipe';
import { useLobbyMusic } from '../useLobbyMusic';
import { LobbySettingsContent } from '../lobby/LobbySettingsContent';
import { TeamSetupPanel } from '../lobby/TeamSetupPanel';
import { KingsCupGame } from '../kings/KingsCupGame';

function ensureConnected() {
  if (!socket.connected) socket.connect();
}

function hostTokenKey(code: string) {
  return `tod_host_${code}`;
}

function normalizeRoomState(s: RoomState): RoomState {
  /** Avoid spread on null/undefined (runtime throw) and always provide arrays for .map/.length */
  const settings: RoomSettings = {
    ...DEFAULT_ROOM_SETTINGS,
    ...(s.settings && typeof s.settings === 'object' ? s.settings : {}),
  };
  return {
    ...s,
    players: Array.isArray(s.players) ? s.players : [],
    deck: Array.isArray(s.deck) ? s.deck : [],
    submittedPlayerIds: Array.isArray(s.submittedPlayerIds) ? s.submittedPlayerIds : [],
    settings,
    roomLocked: s.roomLocked ?? false,
    turnEndsAt: s.turnEndsAt ?? null,
    teams: Array.isArray(s.teams) ? s.teams : [],
    playerTeamId: s.playerTeamId && typeof s.playerTeamId === 'object' ? s.playerTeamId : {},
    teamScores: s.teamScores && typeof s.teamScores === 'object' ? s.teamScores : {},
    teamRevealActive: s.teamRevealActive ?? false,
    voteSession: s.voteSession ?? null,
    deckRecentIndices: Array.isArray(s.deckRecentIndices) ? s.deckRecentIndices : [],
    kingsCup: s.kingsCup ?? null,
    gameMode: (s.gameMode ?? 'sharedDeck') as GameMode,
    phase: s.phase ?? 'lobby',
    currentCardIndex: typeof s.currentCardIndex === 'number' ? s.currentCardIndex : 0,
    hostId: s.hostId ?? '',
    roomCode: s.roomCode ?? '',
    pickAuthorRound: typeof s.pickAuthorRound === 'number' ? s.pickAuthorRound : 0,
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
  const [sfxOn, setSfxOn] = useState(
    () => typeof localStorage === 'undefined' || localStorage.getItem('tod_sfx_on') !== '0',
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [partyMoment, setPartyMoment] = useState<PartyMomentPayload | null>(null);
  const [voteDraft, setVoteDraft] = useState('');
  const [lobbyVoteOpen, setLobbyVoteOpen] = useState(false);
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
    const tdStyle = state.settings.truthDarePlayStyle ?? 'mixed';
    queueMicrotask(() => {
      setTruths((prev) => {
        if (nhieMlt) return Array.from({ length: tp }, (_, i) => prev[i] ?? '');
        if (tdStyle === 'dareOnly') return [];
        return Array.from({ length: tp }, (_, i) => prev[i] ?? '');
      });
      setDares((prev) => {
        if (nhieMlt) return [];
        if (tdStyle === 'truthOnly') return [];
        return Array.from({ length: dp }, (_, i) => prev[i] ?? '');
      });
    });
  }, [
    state,
    state?.settings?.truthsPerPlayer,
    state?.settings?.daresPerPlayer,
    state?.settings?.truthDarePlayStyle,
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
    const mltBuiltin = gm === 'mostLikelyTo' && (state?.settings.mltDeckSource ?? 'mixed') === 'builtin';
    const style = state?.settings.truthDarePlayStyle ?? 'mixed';
    if (mltBuiltin) {
      socket.emit('submit_cards', { truths: [], dares: [] }, (res: { ok: boolean; error?: string }) => {
        if (!res?.ok) setActionError(res?.error ?? 'Invalid cards.');
      });
      return;
    }
    const truthsOut = nhieMlt ? truths : style === 'dareOnly' ? [] : truths;
    const daresOut = nhieMlt ? [] : style === 'truthOnly' ? [] : dares;
    socket.emit(
      'submit_cards',
      { truths: truthsOut, dares: daresOut },
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

  const restartGame = (fromFinished = false) => {
    if (!fromFinished && !window.confirm('Restart and return everyone to the lobby?')) return;
    setActionError('');
    socket.emit('restart_game', { hostToken }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setActionError(res?.error ?? 'Could not restart.');
    });
  };

  const startKingsCup = () => {
    setActionError('');
    socket.emit('start_kings_cup', { hostToken }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setActionError(res?.error ?? 'Could not start Kings Cup.');
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
  const truthDareStyle = settings.truthDarePlayStyle ?? 'mixed';
  const mltDeckSource = settings.mltDeckSource ?? 'mixed';
  const gameMode = state.gameMode ?? 'sharedDeck';
  const totalPickTurns = state.players.length * settings.pickCycles;
  const joinUrl =
    typeof globalThis !== 'undefined' && 'location' in globalThis && globalThis.location.origin
      ? `${globalThis.location.origin}/room/${state.roomCode}`
      : '';
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

  if (state.phase === 'kingsCup' && state.kingsCup) {
    return (
      <>
        {toast ? (
          <div className="card-panel" style={{ borderColor: 'rgba(252,165,165,0.4)' }}>
            {toast}
          </div>
        ) : null}
        {partyMoment ? (
          <PartyMomentOverlay
            moment={partyMoment}
            onClose={() => setPartyMoment(null)}
            soundEnabled={sfxOn}
          />
        ) : null}
        <header className="lobby-topbar">
          <div className="lobby-brand">
            <span className="lobby-room-pill">
              <span className="lobby-room-label">Kings Cup</span>
              <button
                type="button"
                className="room-code-btn"
                title="Copy code"
                onClick={() => void navigator.clipboard.writeText(state.roomCode)}
              >
                {state.roomCode}
              </button>
            </span>
            {isHost ? <span className="badge-host">Host</span> : null}
          </div>
        </header>
        <KingsCupGame state={state} myId={myId} sfxOn={sfxOn} />
        {actionError ? <p className="error">{actionError}</p> : null}
        <p style={{ marginTop: '1.5rem' }}>
          <Link to="/">Home</Link>
        </p>
        <p className="disclaimer">
          Drink responsibly. This game references drinking as a social prompt only.
        </p>
      </>
    );
  }

  return (
    <>
      {toast ? (
        <div className="card-panel" style={{ borderColor: 'rgba(252,165,165,0.4)' }}>
          {toast}
        </div>
      ) : null}

      {partyMoment ? (
        <PartyMomentOverlay
          moment={partyMoment}
          onClose={() => setPartyMoment(null)}
          soundEnabled={sfxOn}
        />
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

      <header className="lobby-topbar">
        <div className="lobby-brand">
          <span className="lobby-room-pill">
            <span className="lobby-room-label">Room</span>
            <button
              type="button"
              className="room-code-btn"
              title="Copy code"
              onClick={() => void navigator.clipboard.writeText(state.roomCode)}
            >
              {state.roomCode}
            </button>
          </span>
          {isHost ? <span className="badge-host">Host</span> : null}
        </div>
        {isHost ? (
          <button
            type="button"
            className={`btn-gear ${settingsOpen ? 'btn-gear--open' : ''}`}
            aria-expanded={settingsOpen}
            aria-controls="room-settings-drawer"
            onClick={() => setSettingsOpen((o) => !o)}
          >
            Settings
          </button>
        ) : (
          <p className="muted lobby-settings-hint">Only the host can change modes &amp; timers.</p>
        )}
      </header>

      {isHost && settingsOpen ? (
        <>
          <button
            type="button"
            className="settings-scrim"
            aria-label="Close settings"
            onClick={() => setSettingsOpen(false)}
          />
          <div className="settings-drawer" id="room-settings-drawer" role="dialog">
            <div className="settings-drawer-head">
              <h2 className="settings-drawer-title">Room settings</h2>
              <button type="button" className="btn-text" onClick={() => setSettingsOpen(false)}>
                Done
              </button>
            </div>
            <LobbySettingsContent
              settings={settings}
              updateRoomSettings={updateRoomSettings}
              musicOn={musicOn}
              onMusicToggle={(on) => {
                setMusicOn(on);
                localStorage.setItem('tod_music_on', on ? '1' : '0');
              }}
              sfxOn={sfxOn}
              onSfxToggle={(on) => {
                setSfxOn(on);
                localStorage.setItem('tod_sfx_on', on ? '1' : '0');
              }}
            />
          </div>
        </>
      ) : null}

      {state.phase === 'lobby' && (
        <section className="lobby-section">
          <div className="card-panel lobby-hero">
            <h1 className="lobby-title">Party lobby</h1>
            <p className="muted lobby-lead">
              Scan the QR, share the link, or read the code out loud — the list updates live.
            </p>
            <div className="qr-row lobby-qr">
              {joinUrl ? (
                <div className="qr-box qr-box--lg" aria-hidden>
                  <QrCode value={joinUrl} size={128} fgColor="#1a1228" bgColor="#e8ddff" />
                </div>
              ) : null}
              <div className="qr-copy">
                <p className="join-url-text">{joinUrl || `…/room/${state.roomCode}`}</p>
                <div className="btn-row-2">
                  {joinUrl ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => void navigator.clipboard.writeText(joinUrl)}
                    >
                      Copy link
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void navigator.clipboard.writeText(state.roomCode)}
                  >
                    Copy code
                  </button>
                </div>
              </div>
            </div>
            <div className="lock-banner">
              <span className={state.roomLocked ? 'lock-state lock-state--locked' : 'lock-state'}>
                {state.roomLocked ? 'Locked — no new joins' : 'Open — friends can join'}
              </span>
              {isHost ? (
                <button
                  type="button"
                  className="btn-secondary btn-pill lock-toggle"
                  onClick={() => toggleRoomLock(!state.roomLocked)}
                >
                  {state.roomLocked ? 'Unlock' : 'Lock'}
                </button>
              ) : null}
            </div>
          </div>

          <div className="card-panel lobby-players">
            <div className="section-head">
              <h2>Players</h2>
              <span className="player-count">{state.players.length}</span>
            </div>
            <ul className="player-list player-list--lobby">
              {state.players.map((p) => (
                <li key={p.id} className="player-row player-chip">
                  <span className="player-chip-name">
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
          </div>

          {isHost && settings.teamsEnabled ? (
            <TeamSetupPanel
              state={state}
              teamLabelA={teamLabelA}
              teamLabelB={teamLabelB}
              teamNameInputA={teamNameInputA}
              teamNameInputB={teamNameInputB}
              teamsEnabled={settings.teamsEnabled}
              onSaveNames={pushTeamNames}
              onAutoBalance={autoBalanceTeams}
              onAssign={assignTeam}
              onReveal={teamRevealShow}
            />
          ) : null}

          {isHost ? (
            <div className="card-panel lobby-modes">
              <h2 className="section-title">Choose a game</h2>
              <p className="muted lobby-modes-lead">
                {gameMode === 'kingsCup' ? (
                  <>
                    <strong className="td-highlight">Kings Cup</strong> — 53 cards (52 + one secret X). Take turns
                    drawing; rules on each card.
                  </>
                ) : (
                  <>
                    <strong className="td-highlight">Truth or Dare</strong> — choose how you play and what goes in the
                    deck. Other party modes are below.
                  </>
                )}
              </p>

              {(gameMode === 'sharedDeck' || gameMode === 'pickAndWrite') && isHost ? (
                <div className="lobby-td-block">
                  <h3 className="lobby-td-heading">Truth or Dare</h3>
                  <div className="mode-section">
                    <p className="mode-section-label">How you play</p>
                    <div className="mode-card-row">
                      <button
                        type="button"
                        className={`mode-card ${gameMode === 'sharedDeck' ? 'mode-card--active' : ''}`}
                        onClick={() => setGameMode('sharedDeck')}
                      >
                        <span className="mode-card-title">Classic</span>
                        <span className="mode-card-sub">Shared deck, random turns</span>
                      </button>
                      <button
                        type="button"
                        className={`mode-card ${gameMode === 'pickAndWrite' ? 'mode-card--active' : ''}`}
                        onClick={() => setGameMode('pickAndWrite')}
                      >
                        <span className="mode-card-title">Hot seat</span>
                        <span className="mode-card-sub">Pick T/D each turn, someone writes the prompt</span>
                      </button>
                    </div>
                  </div>

                  <div className="mode-section animate-in lobby-td-mix">
                    <p className="mode-section-label">Prompt mix</p>
                    <div className="td-style-grid">
                      {(
                        [
                          ['truthOnly', 'Truth only', 'No dares'],
                          ['dareOnly', 'Dare only', 'No truths'],
                          ['mixed', 'Mixed', 'Truths & dares'],
                        ] as const
                      ).map(([id, title, sub]) => (
                        <button
                          key={id}
                          type="button"
                          className={`mode-card mode-card--sm ${
                            (settings.truthDarePlayStyle ?? 'mixed') === id ? 'mode-card--active' : ''
                          }`}
                          onClick={() =>
                            updateRoomSettings({ truthDarePlayStyle: id as RoomSettings['truthDarePlayStyle'] })
                          }
                        >
                          <span className="mode-card-title">{title}</span>
                          <span className="mode-card-sub">{sub}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="mode-section">
                <p className="mode-section-label">Other party modes</p>
                <div
                  className={`mode-card-row mode-card-row--other ${
                    gameMode === 'sharedDeck' || gameMode === 'pickAndWrite'
                      ? 'mode-card-row--triple'
                      : 'mode-card-row--quad'
                  }`}
                >
                  {gameMode !== 'sharedDeck' && gameMode !== 'pickAndWrite' ? (
                    <button
                      type="button"
                      className="mode-card"
                      onClick={() => setGameMode('sharedDeck')}
                    >
                      <span className="mode-card-title">🎭 Truth or Dare</span>
                      <span className="mode-card-sub">Classic, hot seat &amp; mix</span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={`mode-card ${gameMode === 'neverHaveIEver' ? 'mode-card--active' : ''}`}
                    onClick={() => setGameMode('neverHaveIEver')}
                  >
                    <span className="mode-card-title">👆 Never have I ever</span>
                    <span className="mode-card-sub">Statement rounds</span>
                  </button>
                  <button
                    type="button"
                    className={`mode-card ${gameMode === 'mostLikelyTo' ? 'mode-card--active' : ''}`}
                    onClick={() => setGameMode('mostLikelyTo')}
                  >
                    <span className="mode-card-title">🗳️ Most likely to</span>
                    <span className="mode-card-sub">Callouts &amp; chaos</span>
                  </button>
                  <button
                    type="button"
                    className={`mode-card ${gameMode === 'kingsCup' ? 'mode-card--active' : ''}`}
                    onClick={() => setGameMode('kingsCup')}
                  >
                    <span className="mode-card-title">🃏 Kings Cup</span>
                    <span className="mode-card-sub">Cards &amp; house rules</span>
                  </button>
                </div>
              </div>

              {gameMode === 'mostLikelyTo' && isHost ? (
                <div className="mode-section animate-in">
                  <p className="mode-section-label">Most likely to — deck</p>
                  <div className="mlt-source-grid">
                    {(
                      [
                        ['builtin', 'Built-in only', 'Curated prompts'],
                        ['custom', 'Custom only', 'Your lines'],
                        ['mixed', 'Mix both', 'Best of both'],
                      ] as const
                    ).map(([id, title, sub]) => (
                      <button
                        key={id}
                        type="button"
                        className={`mode-card mode-card--sm ${
                          (settings.mltDeckSource ?? 'mixed') === id ? 'mode-card--active' : ''
                        }`}
                        onClick={() => updateRoomSettings({ mltDeckSource: id as RoomSettings['mltDeckSource'] })}
                      >
                        <span className="mode-card-title">{title}</span>
                        <span className="mode-card-sub">{sub}</span>
                      </button>
                    ))}
                  </div>
                  <label className="muted" htmlFor="mlt-cat-lobby" style={{ display: 'block', marginTop: '0.75rem' }}>
                    Vibe category
                  </label>
                  <select
                    id="mlt-cat-lobby"
                    className="mlt-cat-select"
                    value={settings.mostLikelyCategory}
                    onChange={(e) =>
                      updateRoomSettings({
                        mostLikelyCategory: e.target.value as RoomSettings['mostLikelyCategory'],
                      })
                    }
                  >
                    <option value="funny">Funny</option>
                    <option value="college">College</option>
                    <option value="chaotic">Chaotic</option>
                    <option value="spicy">Spicy / flirty</option>
                  </select>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="card-panel guest-mode-hint">
              <p className="muted" style={{ margin: 0 }}>
                Mode:{' '}
                <strong>
                  {gameMode === 'pickAndWrite'
                    ? 'Truth or Dare — hot seat'
                    : gameMode === 'neverHaveIEver'
                      ? 'Never have I ever'
                      : gameMode === 'mostLikelyTo'
                        ? 'Most likely to'
                        : gameMode === 'kingsCup'
                          ? 'Kings Cup'
                          : 'Truth or Dare — classic deck'}
                </strong>
              </p>
            </div>
          )}

            {isHost ? (
              <div className="card-panel lobby-vote-collapsed" style={{ marginTop: '1rem', padding: '1rem' }}>
                <button
                  type="button"
                  className="btn-secondary lobby-vote-toggle"
                  aria-expanded={lobbyVoteOpen}
                  onClick={() => setLobbyVoteOpen((o) => !o)}
                >
                  {lobbyVoteOpen ? '▼ Party vote' : '▶ Party vote'}
                </button>
                {lobbyVoteOpen ? (
                  <div className="lobby-vote-panel animate-in">
                    <h2 className="lobby-vote-title">Party vote</h2>
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
              </div>
            ) : null}

            {isHost ? (
              gameMode === 'kingsCup' ? (
                <button
                  type="button"
                  className="btn-primary btn-primary-cta"
                  onClick={startKingsCup}
                  disabled={state.players.length < 2}
                >
                  Start Kings Cup
                </button>
              ) : gameMode === 'pickAndWrite' ? (
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
                  className="btn-primary btn-primary-cta"
                  onClick={startWriting}
                  disabled={state.players.length < 2}
                >
                  {gameMode === 'neverHaveIEver'
                    ? 'Start writing prompts'
                    : gameMode === 'mostLikelyTo'
                      ? mltDeckSource === 'builtin'
                        ? 'Start ready check'
                        : 'Start writing prompts'
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
        </section>
      )}

      {state.phase === 'writingCards' && (
        <section>
          <h1>
            {gameMode === 'neverHaveIEver'
              ? 'Write your Never have I ever… lines'
              : gameMode === 'mostLikelyTo'
                ? mltDeckSource === 'builtin'
                  ? 'Built-in Most likely to'
                  : 'Write your Most likely to… prompts'
                : 'Write your cards'}
          </h1>
          <p className="muted">
            {gameMode === 'mostLikelyTo' && mltDeckSource === 'builtin' ? (
              <>
                Curated prompts from the <strong>{settings.mostLikelyCategory}</strong> pack — tap ready for everyone,
                then the host can roll.
              </>
            ) : gameMode === 'neverHaveIEver' || gameMode === 'mostLikelyTo' ? (
              <>
                {settings.truthsPerPlayer} prompts each (max {MAX_CARD_TEXT_LENGTH} chars).{' '}
                {gameMode === 'mostLikelyTo' && mltDeckSource === 'mixed'
                  ? 'The deck mixes your lines with built-ins from the vibe you picked.'
                  : gameMode === 'mostLikelyTo'
                    ? 'Only your crew’s lines go in.'
                    : 'Favorites are saved on this device only.'}
              </>
            ) : truthDareStyle === 'truthOnly' ? (
              <>
                {settings.truthsPerPlayer} truths each — <strong>truth only</strong> (max {MAX_CARD_TEXT_LENGTH}{' '}
                chars).
              </>
            ) : truthDareStyle === 'dareOnly' ? (
              <>
                {settings.daresPerPlayer} dares each — <strong>dare only</strong> (max {MAX_CARD_TEXT_LENGTH}{' '}
                chars).
              </>
            ) : (
              <>
                {settings.truthsPerPlayer} truths and {settings.daresPerPlayer} dares each (max{' '}
                {MAX_CARD_TEXT_LENGTH} chars).
              </>
            )}
          </p>

          <div className="card-panel">
            {gameMode === 'mostLikelyTo' && mltDeckSource === 'builtin' ? (
              <>
                <h2>Ready check</h2>
                <p className="muted">No typing — you’re opting into the built-in deck.</p>
                {!state.submittedPlayerIds.includes(myId ?? '') ? (
                  <button type="button" className="btn-primary btn-fat" onClick={submitCards}>
                    I&apos;m ready
                  </button>
                ) : (
                  <p className="muted">You&apos;re in. Nudge the host when everyone&apos;s tapped.</p>
                )}
              </>
            ) : (
              <>
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
              </>
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
                {gameMode === 'mostLikelyTo' && mltDeckSource === 'builtin'
                  ? 'Start game (built-in deck)'
                  : 'Start with submitted cards only'}
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
            soundEnabled={sfxOn}
          />
          {isHost ? (
            <div className="host-play-bar">
              <button type="button" className="btn-secondary" onClick={skipRound}>
                Skip round
              </button>
              <button type="button" className="btn-secondary" onClick={() => restartGame()}>
                Restart to lobby
              </button>
            </div>
          ) : null}
          <div className="card-panel card-play-surface" {...swipeHandlers}>
            <p className="prompt-text" style={{ fontSize: '1.05rem' }}>
              <strong>{subjectName}</strong>
              {truthDareStyle === 'mixed' ? ', choose:' : truthDareStyle === 'truthOnly' ? ' — truth round' : ' — dare round'}
            </p>
            {isHost ? <p className="muted swipe-hint">Swipe left on card to skip (host)</p> : null}
            {truthDareStyle !== 'mixed' ? (
              <p className="muted">Hang tight — locking in the round…</p>
            ) : iAmSubject ? (
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
            soundEnabled={sfxOn}
          />
          {isHost ? (
            <div className="host-play-bar">
              <button type="button" className="btn-secondary" onClick={skipRound}>
                Skip round
              </button>
              <button type="button" className="btn-secondary" onClick={() => restartGame()}>
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
        <section className="finished-section animate-in">
          <h1 className="finished-title">That&apos;s a wrap</h1>
          <div className="card-panel finished-card">
            <p className="finished-lead">
              {gameMode === 'pickAndWrite'
                ? 'Everyone had their turn — same crew, new chaos anytime.'
                : gameMode === 'neverHaveIEver'
                  ? 'Every line played — legendary.'
                  : gameMode === 'mostLikelyTo'
                    ? 'Deck finished — chaos contained.'
                    : gameMode === 'kingsCup'
                      ? 'Deck empty — the table is clear. Same crew, rematch anytime.'
                      : 'You made it through the whole deck.'}
            </p>
            <div className="finished-actions">
              {isHost ? (
                <button type="button" className="btn-primary" onClick={() => restartGame(true)}>
                  Play again
                </button>
              ) : (
                <p className="muted">Waiting for the host to restart or head home…</p>
              )}
              <Link to="/" className="btn-secondary btn-link-home">
                Go home
              </Link>
            </div>
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
