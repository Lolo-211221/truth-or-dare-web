import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GameMode, RoomState } from '@shared';
import { MAX_PLAYER_NAME_LENGTH, ROOM_CODE_LENGTH } from '@shared';
import { socket } from '../socket';

function ensureConnected() {
  if (!socket.connected) socket.connect();
}

const HOME_GAME_OPTIONS: {
  mode: GameMode;
  emoji: string;
  title: string;
  sub: string;
}[] = [
  { mode: 'sharedDeck', emoji: '🎭', title: 'Truth or Dare', sub: 'Prompts and turns — pick style in the lobby' },
  { mode: 'kingsCup', emoji: '🃏', title: 'Kings Cup', sub: '52 cards + secret X — rules on every draw' },
  { mode: 'neverHaveIEver', emoji: '👆', title: 'Never Have I Ever', sub: 'Statement rounds' },
  { mode: 'mostLikelyTo', emoji: '🗳️', title: 'Most Likely To', sub: 'Callouts & chaos' },
];

export default function HomePage() {
  const navigate = useNavigate();
  const [name, setName] = useState(() => sessionStorage.getItem('tod_display_name') ?? '');
  const [joinCode, setJoinCode] = useState('');
  const [selectedGame, setSelectedGame] = useState<GameMode>('sharedDeck');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);

  useEffect(() => {
    ensureConnected();
  }, []);

  const saveName = (n: string) => {
    sessionStorage.setItem('tod_display_name', n);
  };

  const handleCreate = () => {
    setError('');
    const trimmed = name.trim().slice(0, MAX_PLAYER_NAME_LENGTH);
    if (!trimmed) {
      setError('Enter a display name.');
      return;
    }
    saveName(trimmed);
    setBusy('create');
    socket.emit(
      'create_room',
      { playerName: trimmed, gameMode: selectedGame },
      (res: { ok: boolean; error?: string; hostToken?: string; roomState?: RoomState }) => {
        setBusy(null);
        if (!res?.ok) {
          setError(res?.error ?? 'Could not create room.');
          return;
        }
        const code = res.roomState!.roomCode;
        sessionStorage.setItem(`tod_host_${code}`, res.hostToken!);
        sessionStorage.setItem('tod_last_room', code);
        navigate(`/room/${code}`, { state: { initialState: res.roomState } });
      },
    );
  };

  const handleJoin = () => {
    setError('');
    const trimmed = name.trim().slice(0, MAX_PLAYER_NAME_LENGTH);
    const code = joinCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!trimmed) {
      setError('Enter a display name.');
      return;
    }
    if (code.length !== ROOM_CODE_LENGTH) {
      setError(`Room code must be ${ROOM_CODE_LENGTH} characters.`);
      return;
    }
    saveName(trimmed);
    setBusy('join');
    socket.emit('join_room', { roomCode: code, playerName: trimmed }, (res: { ok: boolean; error?: string; roomState?: RoomState }) => {
      setBusy(null);
      if (!res?.ok) {
        setError(res?.error ?? 'Could not join.');
        return;
      }
      sessionStorage.setItem('tod_last_room', code);
      navigate(`/room/${code}`, { state: { initialState: res.roomState } });
    });
  };

  return (
    <div className="home-wrap animate-in">
      <header className="home-hero">
        <p className="home-eyebrow">Party game</p>
        <h1 className="home-title">Truth or Dare</h1>
        <p className="home-tagline">
          One room, QR join, live lobby — Truth or Dare, Kings Cup, NHIE, and Most Likely. Built for phones.
        </p>
      </header>

      <div className="card-panel home-card home-card--name">
        <label htmlFor="name">Your name</label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_PLAYER_NAME_LENGTH}
          placeholder="How should friends see you?"
          autoComplete="nickname"
          className="input-lg"
        />
      </div>

      <div className="card-panel home-card home-game-picker">
        <h2 className="home-game-picker-title">Pick a game</h2>
        <p className="muted home-game-picker-lead">One mode per room — tap a card, then create.</p>
        <div className="home-game-grid" role="listbox" aria-label="Game mode">
          {HOME_GAME_OPTIONS.map((opt) => {
            const active = selectedGame === opt.mode;
            return (
              <button
                key={opt.mode}
                type="button"
                role="option"
                aria-selected={active}
                className={`home-game-card ${active ? 'home-game-card--active' : ''}`}
                onClick={() => setSelectedGame(opt.mode)}
              >
                <span className="home-game-card-emoji" aria-hidden>
                  {opt.emoji}
                </span>
                <span className="home-game-card-title">{opt.title}</span>
                <span className="home-game-card-sub">{opt.sub}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="home-actions">
        <div className="card-panel home-card home-card--cta">
          <h2 className="home-card-title">Host a room</h2>
          <p className="muted home-card-desc">You get the code, QR, and controls.</p>
          <button
            type="button"
            className="btn-primary btn-primary-cta"
            onClick={handleCreate}
            disabled={busy !== null}
          >
            {busy === 'create' ? 'Creating…' : 'Create room'}
          </button>
        </div>

        <div className="card-panel home-card home-card--cta">
          <h2 className="home-card-title">Join with code</h2>
          <label htmlFor="code">Room code</label>
          <input
            id="code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            maxLength={ROOM_CODE_LENGTH}
            placeholder="ABC123"
            autoCapitalize="characters"
            className="input-lg code-input"
          />
          <button
            type="button"
            className="btn-secondary btn-primary-cta"
            onClick={handleJoin}
            disabled={busy !== null}
          >
            {busy === 'join' ? 'Joining…' : 'Join room'}
          </button>
        </div>
      </div>

      {error ? <p className="error home-error">{error}</p> : null}

      <p className="disclaimer home-disclaimer">
        Play with people you trust. Content is visible to everyone in the room. Rooms live in server memory only
        (no accounts).
      </p>
    </div>
  );
}
