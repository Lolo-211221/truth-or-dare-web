import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

import type { CardKind, Phase, Player, PublicDeckCard, RoomState } from './sharedTypes.js';
import {
  DARES_PER_PLAYER,
  MAX_CARD_TEXT_LENGTH,
  MAX_PLAYERS_PER_ROOM,
  MAX_PLAYER_NAME_LENGTH,
  ROOM_CODE_LENGTH,
  TRUTHS_PER_PLAYER,
} from './sharedTypes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PORT = Number(process.env.PORT) || 3001;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_JOINS = 30;
/** How long everyone can read a Truth answer before the next card (ms). Override with TRUTH_ANSWER_DISPLAY_MS. */
const TRUTH_ANSWER_DISPLAY_MS = Math.min(
  120_000,
  Math.max(3000, Number(process.env.TRUTH_ANSWER_DISPLAY_MS) || 10_000),
);

interface InternalCard {
  kind: CardKind;
  text: string;
  authorId: string;
}

interface InternalRoom {
  code: string;
  hostSocketId: string;
  hostToken: string;
  /** Stable join order */
  playerOrder: string[];
  players: Map<string, { name: string }>;
  phase: Phase;
  submitted: Set<string>;
  /** socketId -> cards */
  cardStorage: Map<string, { truths: string[]; dares: string[] }>;
  deck: InternalCard[];
  currentCardIndex: number;
  truthAnswer: string | null;
  /** When the next card will auto-advance after a Truth answer (server time ms) */
  truthAdvanceAt: number | null;
  /** Prevents double advance (truth timeout / dare tap) */
  pendingAdvance: boolean;
}

const rooms = new Map<string, InternalRoom>();
const socketRoom = new Map<string, string>();
const rateMap = new Map<string, { count: number; resetAt: number }>();

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]!;
  }
  return code;
}

function normalizeName(raw: string): string {
  return raw.trim().slice(0, MAX_PLAYER_NAME_LENGTH);
}

function checkRate(ip: string): boolean {
  const now = Date.now();
  let e = rateMap.get(ip);
  if (!e || now > e.resetAt) {
    e = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateMap.set(ip, e);
  }
  e.count += 1;
  return e.count <= RATE_MAX_JOINS;
}

function playersList(room: InternalRoom): Player[] {
  return room.playerOrder.map((id) => ({
    id,
    name: room.players.get(id)!.name,
  }));
}

function activePlayerId(room: InternalRoom): string | null {
  if (room.phase !== 'turn' || room.deck.length === 0) return null;
  if (room.currentCardIndex < 0 || room.currentCardIndex >= room.deck.length) return null;
  const n = room.playerOrder.length;
  if (n === 0) return null;
  return room.playerOrder[room.currentCardIndex % n]!;
}

function publicDeck(room: InternalRoom): PublicDeckCard[] {
  return room.deck.map(({ kind, text }) => ({ kind, text }));
}

function toRoomState(room: InternalRoom): RoomState {
  return {
    roomCode: room.code,
    phase: room.phase,
    players: playersList(room),
    hostId: room.hostSocketId,
    submittedPlayerIds: [...room.submitted],
    deck: publicDeck(room),
    currentCardIndex: room.currentCardIndex,
    activePlayerId: activePlayerId(room),
    truthAnswer: room.truthAnswer,
    truthAdvanceAt: room.truthAdvanceAt,
  };
}

function validateCardBatch(
  truths: string[],
  dares: string[],
): { ok: true } | { ok: false; error: string } {
  if (truths.length !== TRUTHS_PER_PLAYER || dares.length !== DARES_PER_PLAYER) {
    return {
      ok: false,
      error: `Need exactly ${TRUTHS_PER_PLAYER} truths and ${DARES_PER_PLAYER} dares.`,
    };
  }
  const all = [...truths, ...dares];
  for (const t of all) {
    const s = t.trim();
    if (!s) return { ok: false, error: 'Cards cannot be empty.' };
    if (s.length > MAX_CARD_TEXT_LENGTH) {
      return { ok: false, error: `Max ${MAX_CARD_TEXT_LENGTH} characters per card.` };
    }
  }
  return { ok: true };
}

function buildDeck(room: InternalRoom): InternalCard[] {
  const cards: InternalCard[] = [];
  for (const sid of room.playerOrder) {
    const pack = room.cardStorage.get(sid);
    if (!pack) continue;
    for (const text of pack.truths) {
      cards.push({ kind: 'truth', text: text.trim(), authorId: sid });
    }
    for (const text of pack.dares) {
      cards.push({ kind: 'dare', text: text.trim(), authorId: sid });
    }
  }
  return shuffle(cards);
}

function transferHost(io: Server, room: InternalRoom, excludeSocketId?: string) {
  const next = room.playerOrder.find((id) => id !== excludeSocketId && room.players.has(id));
  if (!next) return false;
  room.hostSocketId = next;
  room.hostToken = uuidv4();
  io.to(next).emit('host_token', { hostToken: room.hostToken });
  return true;
}

function leaveRoom(io: Server, socketId: string) {
  const code = socketRoom.get(socketId);
  if (!code) return;
  const room = rooms.get(code);
  if (!room) {
    socketRoom.delete(socketId);
    return;
  }

  socketRoom.delete(socketId);
  room.players.delete(socketId);
  room.playerOrder = room.playerOrder.filter((id) => id !== socketId);
  room.submitted.delete(socketId);
  room.cardStorage.delete(socketId);

  const wasHost = room.hostSocketId === socketId;

  if (room.players.size === 0) {
    rooms.delete(code);
    return;
  }

  if (wasHost) {
    if (!transferHost(io, room, socketId)) {
      rooms.delete(code);
      return;
    }
  }

  if (room.phase === 'turn' || room.phase === 'shuffling') {
    const ap = activePlayerId(room);
    if (ap && !room.players.has(ap)) {
      room.phase = 'lobby';
      room.deck = [];
      room.currentCardIndex = 0;
      room.truthAnswer = null;
      room.truthAdvanceAt = null;
      room.pendingAdvance = false;
      room.submitted.clear();
      room.cardStorage.clear();
    }
  }

  io.to(code).emit('room_state', toRoomState(room));
}

/** Monorepo + Railway: cwd may be repo root or `server/`; built files live at `client/dist`. */
function resolveClientDistDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'client', 'dist'),
    path.resolve(process.cwd(), '..', 'client', 'dist'),
    path.join(__dirname, '..', '..', 'client', 'dist'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return candidates[candidates.length - 1]!;
}

const app = express();
app.use(cors());
app.set('trust proxy', 1);

/** Railway / load balancers often probe this; keep it cheap. */
app.get('/health', (_req, res) => {
  res.status(200).type('text/plain').send('ok');
});

const clientDist = resolveClientDistDir();
const spaIndex = path.join(clientDist, 'index.html');
const hasSpa = fs.existsSync(spaIndex);
console.log(`Static UI: ${hasSpa ? clientDist : 'MISSING — run "npm run build" at repo root before start'}`);

if (hasSpa) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.path.startsWith('/socket.io')) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.sendFile(spaIndex, (err) => {
      if (err) next(err);
    });
  });
} else {
  app.get('/', (_req, res) => {
    res
      .status(503)
      .type('text/plain')
      .send('Client not built. Set build command to: npm install && npm run build');
  });
}

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true },
});

io.on('connection', (socket) => {
  const ip = socket.handshake.address || 'unknown';

  socket.on('create_room', (payload: { playerName: string }, ack) => {
    if (!checkRate(ip)) {
      ack?.({ ok: false, error: 'Too many requests. Try again in a minute.' });
      return;
    }
    const name = normalizeName(payload?.playerName ?? '');
    if (!name) {
      ack?.({ ok: false, error: 'Enter a display name.' });
      return;
    }

    let code = generateRoomCode();
    while (rooms.has(code)) code = generateRoomCode();

    const hostToken = uuidv4();
    const room: InternalRoom = {
      code,
      hostSocketId: socket.id,
      hostToken,
      playerOrder: [socket.id],
      players: new Map([[socket.id, { name }]]),
      phase: 'lobby',
      submitted: new Set(),
      cardStorage: new Map(),
      deck: [],
      currentCardIndex: 0,
      truthAnswer: null,
      truthAdvanceAt: null,
      pendingAdvance: false,
    };
    rooms.set(code, room);
    socket.join(code);
    socketRoom.set(socket.id, code);

    ack?.({ ok: true, hostToken, roomState: toRoomState(room) });
    socket.emit('room_state', toRoomState(room));
  });

  socket.on('join_room', (payload: { roomCode: string; playerName: string }, ack) => {
    if (!checkRate(ip)) {
      ack?.({ ok: false, error: 'Too many requests. Try again in a minute.' });
      return;
    }
    const rawCode = (payload?.roomCode ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const name = normalizeName(payload?.playerName ?? '');
    if (!name) {
      ack?.({ ok: false, error: 'Enter a display name.' });
      return;
    }
    if (rawCode.length !== ROOM_CODE_LENGTH) {
      ack?.({ ok: false, error: 'Invalid room code.' });
      return;
    }

    const room = rooms.get(rawCode);
    if (!room) {
      ack?.({ ok: false, error: 'Room not found.' });
      return;
    }
    if (['shuffling', 'turn', 'finished'].includes(room.phase)) {
      ack?.({ ok: false, error: 'This game already started. Ask for a new room.' });
      return;
    }
    if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
      ack?.({ ok: false, error: 'Room is full.' });
      return;
    }

    const prev = socketRoom.get(socket.id);
    if (prev && prev !== rawCode) leaveRoom(io, socket.id);

    room.players.set(socket.id, { name });
    if (!room.playerOrder.includes(socket.id)) room.playerOrder.push(socket.id);

    socket.join(rawCode);
    socketRoom.set(socket.id, rawCode);

    ack?.({ ok: true, roomState: toRoomState(room) });
    io.to(rawCode).emit('room_state', toRoomState(room));
  });

  socket.on('start_writing', (payload: { hostToken: string }, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id || payload?.hostToken !== room.hostToken) {
      ack?.({ ok: false, error: 'Only the host can start this phase.' });
      return;
    }
    if (room.phase !== 'lobby') {
      ack?.({ ok: false, error: 'Already past lobby.' });
      return;
    }
    if (room.players.size < 2) {
      ack?.({ ok: false, error: 'Need at least 2 players.' });
      return;
    }

    room.phase = 'writingCards';
    room.submitted.clear();
    room.cardStorage.clear();
    room.pendingAdvance = false;
    ack?.({ ok: true });
    io.to(code).emit('room_state', toRoomState(room));
  });

  socket.on('submit_cards', (payload: { truths: string[]; dares: string[] }, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    if (!room || room.phase !== 'writingCards') {
      ack?.({ ok: false, error: 'Not accepting cards right now.' });
      return;
    }
    if (room.submitted.has(socket.id)) {
      ack?.({ ok: false, error: 'You already submitted your cards.' });
      return;
    }

    const v = validateCardBatch(payload?.truths ?? [], payload?.dares ?? []);
    if (!v.ok) {
      ack?.({ ok: false, error: v.error });
      return;
    }

    room.cardStorage.set(socket.id, {
      truths: payload.truths.map((t) => t.trim()),
      dares: payload.dares.map((t) => t.trim()),
    });
    room.submitted.add(socket.id);

    const allIn =
      room.playerOrder.length > 0 &&
      room.playerOrder.every((id) => room.submitted.has(id));

    if (allIn) {
      if (!beginShuffleAndPlay(io, room)) {
        ack?.({ ok: false, error: 'Could not build deck.' });
        return;
      }
      ack?.({ ok: true });
    } else {
      ack?.({ ok: true });
      io.to(code).emit('room_state', toRoomState(room));
    }
  });

  function beginShuffleAndPlay(ioSrv: Server, room: InternalRoom): boolean {
    const code = room.code;
    const deck = buildDeck(room);
    if (deck.length === 0) {
      ioSrv.to(code).emit('error_toast', { message: 'No cards to play. Add cards and try again.' });
      return false;
    }
    room.deck = deck;
    room.phase = 'shuffling';
    room.currentCardIndex = 0;
    room.truthAnswer = null;
    room.truthAdvanceAt = null;
    room.pendingAdvance = false;
    ioSrv.to(code).emit('room_state', toRoomState(room));

    setTimeout(() => {
      const r = rooms.get(code);
      if (!r || r.phase !== 'shuffling') return;
      r.phase = 'turn';
      ioSrv.to(code).emit('room_state', toRoomState(r));
    }, 600);
    return true;
  }

  socket.on('lock_in_deck', (payload: { hostToken: string }, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id || payload?.hostToken !== room.hostToken) {
      ack?.({ ok: false, error: 'Only the host can lock the deck.' });
      return;
    }
    if (room.phase !== 'writingCards') {
      ack?.({ ok: false, error: 'Wrong phase.' });
      return;
    }
    if (room.submitted.size === 0) {
      ack?.({ ok: false, error: 'No cards submitted yet.' });
      return;
    }

    if (!beginShuffleAndPlay(io, room)) {
      ack?.({ ok: false, error: 'No cards submitted to shuffle.' });
      return;
    }
    ack?.({ ok: true });
  });

  socket.on('submit_truth_answer', (payload: { text: string }, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    if (!room || room.phase !== 'turn') {
      ack?.({ ok: false, error: 'Not your turn to answer.' });
      return;
    }
    const active = activePlayerId(room);
    if (active !== socket.id) {
      ack?.({ ok: false, error: 'Only the active player can answer.' });
      return;
    }
    const card = room.deck[room.currentCardIndex];
    if (!card || card.kind !== 'truth') {
      ack?.({ ok: false, error: 'Current card is not a Truth.' });
      return;
    }
    if (room.truthAnswer !== null) {
      ack?.({ ok: false, error: 'Answer already submitted.' });
      return;
    }
    if (room.pendingAdvance) {
      ack?.({ ok: false, error: 'Please wait.' });
      return;
    }

    const text = (payload?.text ?? '').trim();
    if (!text) {
      ack?.({ ok: false, error: 'Type an answer.' });
      return;
    }
    if (text.length > MAX_CARD_TEXT_LENGTH * 2) {
      ack?.({ ok: false, error: 'Answer is too long.' });
      return;
    }

    room.truthAnswer = text;
    room.truthAdvanceAt = Date.now() + TRUTH_ANSWER_DISPLAY_MS;
    room.pendingAdvance = true;
    io.to(code).emit('room_state', toRoomState(room));

    setTimeout(() => {
      const r = rooms.get(code);
      if (r) {
        r.pendingAdvance = false;
        advanceCard(io, r);
      }
    }, TRUTH_ANSWER_DISPLAY_MS);
    ack?.({ ok: true });
  });

  socket.on('dare_done', (_payload, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    if (!room || room.phase !== 'turn') {
      ack?.({ ok: false, error: 'No active dare.' });
      return;
    }
    const active = activePlayerId(room);
    if (active !== socket.id) {
      ack?.({ ok: false, error: 'Only the active player can mark done.' });
      return;
    }
    const card = room.deck[room.currentCardIndex];
    if (!card || card.kind !== 'dare') {
      ack?.({ ok: false, error: 'Current card is not a Dare.' });
      return;
    }
    if (room.pendingAdvance) {
      ack?.({ ok: false, error: 'Please wait.' });
      return;
    }

    room.pendingAdvance = true;
    advanceCard(io, room);
    room.pendingAdvance = false;
    ack?.({ ok: true });
  });

  socket.on('disconnect', () => {
    leaveRoom(io, socket.id);
  });
});

function advanceCard(ioSrv: Server, room: InternalRoom) {
  const code = room.code;
  room.truthAnswer = null;
  room.truthAdvanceAt = null;
  room.currentCardIndex += 1;

  if (room.currentCardIndex >= room.deck.length) {
    room.phase = 'finished';
  }

  ioSrv.to(code).emit('room_state', toRoomState(room));
}

/** Must bind 0.0.0.0 in Docker / Railway or the proxy cannot reach the process. */
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Truth or Dare server listening on 0.0.0.0:${PORT}`);
});
