import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RoomState } from '@shared';
import { MAX_PLAYER_NAME_LENGTH, ROOM_CODE_LENGTH } from '@shared';
import { socket } from '../socket';

function ensureConnected() {
  if (!socket.connected) socket.connect();
}

export default function HomePage() {
  const navigate = useNavigate();
  const [name, setName] = useState(() => sessionStorage.getItem('tod_display_name') ?? '');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');

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
    socket.emit('create_room', { playerName: trimmed }, (res: { ok: boolean; error?: string; hostToken?: string; roomState?: RoomState }) => {
      if (!res?.ok) {
        setError(res?.error ?? 'Could not create room.');
        return;
      }
      const code = res.roomState!.roomCode;
      sessionStorage.setItem(`tod_host_${code}`, res.hostToken!);
      sessionStorage.setItem('tod_last_room', code);
      navigate(`/room/${code}`, { state: { initialState: res.roomState } });
    });
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
    socket.emit('join_room', { roomCode: code, playerName: trimmed }, (res: { ok: boolean; error?: string; roomState?: RoomState }) => {
      if (!res?.ok) {
        setError(res?.error ?? 'Could not join.');
        return;
      }
      sessionStorage.setItem('tod_last_room', code);
      navigate(`/room/${code}`, { state: { initialState: res.roomState } });
    });
  };

  return (
    <>
      <h1>Truth or Dare</h1>
      <p className="muted">Create a room, share the code, build a deck together, then play.</p>

      <div className="card-panel" style={{ marginTop: '1.5rem' }}>
        <label htmlFor="name">Your name</label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_PLAYER_NAME_LENGTH}
          placeholder="How should others see you?"
          autoComplete="nickname"
        />
      </div>

      <div className="card-panel">
        <h2>Create a room</h2>
        <p className="muted">You will be the host and get a code to share.</p>
        <button type="button" className="btn-primary" onClick={handleCreate}>
          Create room
        </button>
      </div>

      <div className="card-panel">
        <h2>Join a room</h2>
        <label htmlFor="code">Room code</label>
        <input
          id="code"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          maxLength={ROOM_CODE_LENGTH}
          placeholder="e.g. ABC123"
          autoCapitalize="characters"
        />
        <button type="button" className="btn-secondary" onClick={handleJoin}>
          Join with code
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <p className="disclaimer">
        Play with people you trust. Prompts and answers are visible to everyone in the room. This MVP keeps
        rooms in server memory only (no accounts).
      </p>
    </>
  );
}
