import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import type { RoomState } from '@shared';
import {
  DARES_PER_PLAYER,
  MAX_CARD_TEXT_LENGTH,
  MAX_PLAYER_NAME_LENGTH,
  TRUTHS_PER_PLAYER,
} from '@shared';
import { socket } from '../socket';

function ensureConnected() {
  if (!socket.connected) socket.connect();
}

function hostTokenKey(code: string) {
  return `tod_host_${code}`;
}

export default function RoomPage() {
  const { roomCode: codeParam } = useParams();
  const location = useLocation();
  const roomCode = (codeParam ?? '').toUpperCase();

  const initial = location.state?.initialState as RoomState | undefined;
  const [state, setState] = useState<RoomState | null>(() =>
    initial?.roomCode === roomCode ? initial : null,
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

  const [truths, setTruths] = useState<string[]>(() => Array(TRUTHS_PER_PLAYER).fill(''));
  const [dares, setDares] = useState<string[]>(() => Array(DARES_PER_PLAYER).fill(''));
  const [truthAnswer, setTruthAnswer] = useState('');
  const [nowTick, setNowTick] = useState(() => Date.now());

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
    if (state?.truthAdvanceAt == null) return;
    const id = setInterval(() => setNowTick(Date.now()), 500);
    return () => clearInterval(id);
  }, [state?.truthAdvanceAt]);

  useEffect(() => {
    const onState = (s: RoomState) => {
      if (s.roomCode === roomCode) setState(s);
    };
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

    return () => {
      socket.off('room_state', onState);
      socket.off('host_token', onHostToken);
      socket.off('error_toast', onToast);
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
        setState(res.roomState);
        setAutoJoinError('');
      } else {
        setAutoJoinError(res?.error ?? 'Could not join automatically.');
      }
    });
  }, [roomCode, state?.roomCode, joinAttempted]);

  const isHost = useMemo(() => {
    if (!state || !myId) return false;
    return state.hostId === myId;
  }, [state, myId]);

  const truthSecondsLeft =
    state?.truthAdvanceAt == null
      ? null
      : Math.max(0, Math.ceil((state.truthAdvanceAt - nowTick) / 1000));

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
      setState(res.roomState!);
    });
  };

  const startWriting = () => {
    setActionError('');
    socket.emit('start_writing', { hostToken }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setActionError(res?.error ?? 'Failed.');
    });
  };

  const submitCards = () => {
    setActionError('');
    socket.emit('submit_cards', { truths, dares }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setActionError(res?.error ?? 'Invalid cards.');
    });
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

  const currentCard = state.deck[state.currentCardIndex] ?? null;
  const iAmActive = state.activePlayerId === myId;
  const activeName = state.players.find((p) => p.id === state.activePlayerId)?.name ?? '…';

  return (
    <>
      {toast ? (
        <div className="card-panel" style={{ borderColor: 'rgba(252,165,165,0.4)' }}>
          {toast}
        </div>
      ) : null}

      <p className="muted">
        Room <strong style={{ color: '#e8ddff' }}>{state.roomCode}</strong>
        {isHost ? <span className="badge-host" style={{ marginLeft: '0.5rem' }}>Host</span> : null}
      </p>

      {state.phase === 'lobby' && (
        <section>
          <h1>Lobby</h1>
          <p className="muted">Share this URL or the code so friends can join.</p>
          <div className="card-panel">
            <p className="muted" style={{ wordBreak: 'break-all' }}>
              {origin ? `${origin}/room/${state.roomCode}` : `…/room/${state.roomCode}`}
            </p>
            <h2>Players ({state.players.length})</h2>
            <ul className="player-list">
              {state.players.map((p) => (
                <li key={p.id}>
                  {p.name}
                  {p.id === state.hostId ? <span className="badge-host">host</span> : null}
                  {p.id === myId ? <span className="badge-you">you</span> : null}
                </li>
              ))}
            </ul>
            {isHost ? (
              <button
                type="button"
                className="btn-primary"
                onClick={startWriting}
                disabled={state.players.length < 2}
              >
                Start writing cards
              </button>
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
          <h1>Write your cards</h1>
          <p className="muted">
            {TRUTHS_PER_PLAYER} truths and {DARES_PER_PLAYER} dares each (max {MAX_CARD_TEXT_LENGTH} chars).
          </p>

          <div className="card-panel">
            <h2>Your truths</h2>
            {truths.map((t, i) => (
              <div key={`t-${i}`} style={{ marginBottom: '0.75rem' }}>
                <label htmlFor={`t-${i}`}>Truth {i + 1}</label>
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
              </div>
            ))}
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

      {state.phase === 'shuffling' && (
        <section>
          <h1>Shuffling</h1>
          <div className="card-panel shuffle-pulse">Mixing the deck…</div>
        </section>
      )}

      {state.phase === 'turn' && currentCard && (
        <section>
          <h1>Round {state.currentCardIndex + 1}</h1>
          <p className="muted">
            Card {state.currentCardIndex + 1} of {state.deck.length}
          </p>

          <div className="card-panel">
            <span className={currentCard.kind === 'truth' ? 'tag tag-truth' : 'tag tag-dare'}>
              {currentCard.kind}
            </span>
            <p className="prompt-text">{currentCard.text}</p>

            <p className="muted">
              Active: <strong style={{ color: '#fde047' }}>{activeName}</strong>
              {iAmActive ? <span className="badge-active">your turn</span> : null}
            </p>

            {currentCard.kind === 'truth' && (
              <>
                {state.truthAnswer ? (
                  <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(59,130,246,0.12)', borderRadius: '0.5rem' }}>
                    <p className="muted" style={{ margin: 0 }}>
                      Answer
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
                    <label htmlFor="ans">Your answer</label>
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

            {currentCard.kind === 'dare' && (
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
            <p>You made it through the whole deck.</p>
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
