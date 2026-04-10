import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

import type {
  CardKind,
  GameMode,
  MostLikelyCategory,
  PartyMomentPayload,
  Phase,
  Player,
  PublicDeckCard,
  RoomSettings,
  RoomState,
  TeamInfo,
  TruthDarePlayStyle,
  VoteSessionState,
} from './sharedTypes.js';
import {
  advanceKingsTurn,
  clearKingsCupTimers,
  currentKingsTurnPlayerId,
  initKingsCupInternal,
  kcToPublic,
  rankKey,
  type KingsCupInternal,
} from './kingsCup.js';
import {
  MAX_CARD_TEXT_LENGTH,
  MAX_PLAYERS_PER_ROOM,
  MAX_PLAYER_NAME_LENGTH,
  MAX_TEAM_NAME_LENGTH,
  ROOM_CODE_LENGTH,
} from './sharedTypes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PORT = Number(process.env.PORT) || 3001;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_JOINS = 30;

const TEAM_A_ID = 't1';
const TEAM_B_ID = 't2';

/** Curated GIFs (stable CDN). Shuffled randomly when showing a moment. */
const PARTY_MOMENTS: Omit<PartyMomentPayload, 'id'>[] = [
  {
    category: 'funny',
    title: 'Absolutely unhinged',
    imageUrl: 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif',
    sound: 'airhorn',
    confetti: true,
    shake: true,
  },
  {
    category: 'funny',
    title: 'Main character energy',
    imageUrl: 'https://media.giphy.com/media/l0MYC0LajbaPoEADu/giphy.gif',
    sound: 'drum',
    confetti: true,
  },
  {
    category: 'savage',
    title: 'The chaos is real',
    imageUrl: 'https://media.giphy.com/media/3o7btPCcdNniyf0ArS/giphy.gif',
    sound: 'drum',
    shake: true,
  },
  {
    category: 'savage',
    title: 'No mercy',
    imageUrl: 'https://media.giphy.com/media/26BRv0ThflsHCqDrG/giphy.gif',
    sound: 'tick',
    shake: true,
  },
  {
    category: 'chaotic',
    title: 'Party mode: ON',
    imageUrl: 'https://media.giphy.com/media/3o7aCTPPm4OHfRLSH6/giphy.gif',
    sound: 'airhorn',
    confetti: true,
    shake: true,
  },
  {
    category: 'chaotic',
    title: 'Witnessed',
    imageUrl: 'https://media.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif',
    sound: 'airhorn',
    confetti: true,
  },
  {
    category: 'funny',
    title: 'Plot twist',
    imageUrl: 'https://media.giphy.com/media/3o7btO04D7zObfNBqy/giphy.gif',
    sound: 'drum',
    shake: true,
  },
  {
    category: 'savage',
    title: 'Damage report',
    imageUrl: 'https://media.giphy.com/media/l3q2Z6S6nU3ulc6G6/giphy.gif',
    sound: 'tick',
    confetti: true,
  },
  {
    category: 'chaotic',
    title: 'Main character moment',
    imageUrl: 'https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif',
    sound: 'airhorn',
    shake: true,
    confetti: true,
  },
];

function randomPartyMoment(): PartyMomentPayload {
  const pick = PARTY_MOMENTS[Math.floor(Math.random() * PARTY_MOMENTS.length)]!;
  return { ...pick, id: uuidv4() };
}

function maybePartyMoment(ioSrv: Server, room: InternalRoom, chance: number) {
  if (Math.random() > chance) return;
  ioSrv.to(room.code).emit('party_moment', randomPartyMoment());
}

/** Built-in "Most likely to ___" stems; category chosen in room settings. */
const MLT_POOLS: Record<MostLikelyCategory, string[]> = {
  spicy: [
    'text their ex "u up?"',
    'kiss a stranger at a party',
    'have a secret fan account',
    'flirt their way out of a ticket',
    'send a risky selfie',
    'date two people at once',
    'fall in love on the first date',
    'slide into the DMs first',
  ],
  funny: [
    'lose their keys twice in one day',
    'try to microwave metal',
    'buy something off a late-night infomercial',
    'say "wait what?" during a serious talk',
    'trip on absolutely nothing',
    'forget why they walked into a room',
    'accidentally reply-all',
    'laugh so hard they snort in public',
  ],
  college: [
    'pull an all-nighter for the wrong exam',
    'wake up with mystery glitter on their face',
    'join a club just for free pizza',
    'sleep through a final',
    'lose their ID and find it in the fridge',
    'be the last one at the pregame',
    'submit at 11:59 PM',
    'become best friends with the Uber driver',
  ],
  chaotic: [
    'call the teacher "mom"',
    'wave back at someone who wasn\'t waving',
    'laugh at the wrong moment',
    'send a voice note to the group chat by accident',
    'get their card declined on a coffee',
    'trip in front of a crowd',
    'forget someone\'s name immediately',
    'get caught talking to themselves',
    'start drama "just for fun"',
  ],
};

function normalizeDeckText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function orderDeckReduceRepeats(cards: InternalCard[], recent: string[]): InternalCard[] {
  if (cards.length <= 1) return cards;
  let arr = [...cards];
  for (let attempt = 0; attempt < 80; attempt++) {
    arr = shuffle(arr);
    let ok = true;
    for (let i = 1; i < arr.length; i++) {
      if (normalizeDeckText(arr[i]!.text) === normalizeDeckText(arr[i - 1]!.text)) {
        ok = false;
        break;
      }
    }
    if (ok) break;
  }
  for (let i = 1; i < arr.length; i++) {
    if (normalizeDeckText(arr[i]!.text) === normalizeDeckText(arr[i - 1]!.text)) {
      const swapIdx = arr.findIndex(
        (c, j) => j > i && normalizeDeckText(c.text) !== normalizeDeckText(arr[i - 1]!.text),
      );
      if (swapIdx !== -1) {
        const t = arr[i]!;
        arr[i] = arr[swapIdx]!;
        arr[swapIdx] = t;
      }
    }
  }
  if (recent.length > 0 && arr.length > 1) {
    const last = recent[recent.length - 1]!;
    if (normalizeDeckText(arr[0]!.text) === normalizeDeckText(last)) {
      const idx = arr.findIndex((c) => normalizeDeckText(c.text) !== normalizeDeckText(last));
      if (idx > 0) {
        const t = arr[0]!;
        arr[0] = arr[idx]!;
        arr[idx] = t;
      }
    }
  }
  return arr;
}

function defaultRoomSettings(): RoomSettings {
  return {
    truthsPerPlayer: 2,
    daresPerPlayer: 2,
    truthAnswerDisplayMs: Math.min(
      120_000,
      Math.max(3000, Number(process.env.TRUTH_ANSWER_DISPLAY_MS) || 10_000),
    ),
    authorPromptMs: Math.min(
      300_000,
      Math.max(15_000, Number(process.env.AUTHOR_PROMPT_MS) || 90_000),
    ),
    pickCycles: 1,
    turnTimerSeconds: 0,
    turnTimerCustomSeconds: 45,
    teamsEnabled: false,
    preventSelfVoteDefault: true,
    mostLikelyCategory: 'spicy',
    truthDarePlayStyle: 'mixed',
    mltDeckSource: 'mixed',
  };
}

function migrateMostLikelyCategory(raw: unknown): MostLikelyCategory {
  const d = defaultRoomSettings().mostLikelyCategory;
  if (raw === 'funny' || raw === 'college' || raw === 'chaotic' || raw === 'spicy') return raw;
  if (raw === 'dumb') return 'funny';
  if (raw === 'embarrassing') return 'chaotic';
  return d;
}

function clampRoomSettings(p: Partial<RoomSettings>): RoomSettings {
  const d = defaultRoomSettings();
  const rawTurn = Number(p.turnTimerSeconds ?? d.turnTimerSeconds);
  const allowed = new Set([0, 15, 30, 60, -1]);
  const turnTimerSeconds = allowed.has(rawTurn) ? rawTurn : d.turnTimerSeconds;
  const mostLikelyCategory = migrateMostLikelyCategory(p.mostLikelyCategory ?? d.mostLikelyCategory);

  const tds = p.truthDarePlayStyle as TruthDarePlayStyle | undefined;
  const truthDarePlayStyle: TruthDarePlayStyle =
    tds === 'truthOnly' || tds === 'dareOnly' || tds === 'mixed' ? tds : d.truthDarePlayStyle;

  const mltSrc = p.mltDeckSource;
  const mltDeckSource =
    mltSrc === 'builtin' || mltSrc === 'custom' || mltSrc === 'mixed' ? mltSrc : d.mltDeckSource;

  let truthsPerPlayer = Math.round(Number(p.truthsPerPlayer ?? d.truthsPerPlayer));
  let daresPerPlayer = Math.round(Number(p.daresPerPlayer ?? d.daresPerPlayer));

  if (truthDarePlayStyle === 'truthOnly') {
    truthsPerPlayer = Math.min(10, Math.max(1, truthsPerPlayer || d.truthsPerPlayer));
    daresPerPlayer = 0;
  } else if (truthDarePlayStyle === 'dareOnly') {
    daresPerPlayer = Math.min(10, Math.max(1, daresPerPlayer || d.daresPerPlayer));
    truthsPerPlayer = 0;
  } else {
    truthsPerPlayer = Math.min(10, Math.max(1, truthsPerPlayer || d.truthsPerPlayer));
    daresPerPlayer = Math.min(10, Math.max(1, daresPerPlayer || d.daresPerPlayer));
  }

  return {
    truthsPerPlayer,
    daresPerPlayer,
    truthAnswerDisplayMs: Math.min(
      120_000,
      Math.max(3000, Math.round(Number(p.truthAnswerDisplayMs ?? d.truthAnswerDisplayMs))),
    ),
    authorPromptMs: Math.min(
      300_000,
      Math.max(15_000, Math.round(Number(p.authorPromptMs ?? d.authorPromptMs))),
    ),
    pickCycles: Math.min(10, Math.max(1, Math.round(Number(p.pickCycles ?? d.pickCycles)))),
    turnTimerSeconds,
    turnTimerCustomSeconds: Math.min(300, Math.max(5, Math.round(Number(p.turnTimerCustomSeconds ?? d.turnTimerCustomSeconds)))),
    teamsEnabled: Boolean(p.teamsEnabled ?? d.teamsEnabled),
    preventSelfVoteDefault: Boolean(p.preventSelfVoteDefault ?? d.preventSelfVoteDefault),
    mostLikelyCategory,
    truthDarePlayStyle,
    mltDeckSource,
  };
}

function effectiveTurnSeconds(room: InternalRoom): number {
  const t = room.settings.turnTimerSeconds;
  if (t === 0) return 0;
  if (t === -1) return room.settings.turnTimerCustomSeconds;
  return t;
}

interface InternalCard {
  kind: CardKind;
  text: string;
  authorId: string;
}

interface InternalVoteSession {
  id: string;
  question: string;
  candidateIds: string[];
  mode: 'players' | 'teams';
  allowSelfVote: boolean;
  votes: Map<string, string>;
  revealed: boolean;
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
  /** Cleared on skip_round / force advance */
  truthAdvanceTimer: ReturnType<typeof setTimeout> | null;

  gameMode: GameMode;
  subjectPlayerId: string | null;
  authorPlayerId: string | null;
  pickedKind: CardKind | null;
  authorDeadlineAt: number | null;
  spotCard: { kind: CardKind; text: string } | null;
  pickAuthorRound: number;
  authorTimer: ReturnType<typeof setTimeout> | null;
  turnTimer: ReturnType<typeof setTimeout> | null;
  settings: RoomSettings;

  roomLocked: boolean;
  turnEndsAt: number | null;

  teams: TeamInfo[];
  playerTeam: Map<string, string>;
  teamScores: Map<string, number>;
  teamRevealActive: boolean;

  voteSession: InternalVoteSession | null;

  deckRecentIndices: number[];
  /** Normalized card texts from recent turns — reduces back-to-back repeats when shuffling */
  deckRecentTexts: string[];

  kingsCup: KingsCupInternal | null;
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

function activePlayerIdDeck(room: InternalRoom): string | null {
  if (room.phase !== 'turn' || room.deck.length === 0) return null;
  if (room.currentCardIndex < 0 || room.currentCardIndex >= room.deck.length) return null;
  const n = room.playerOrder.length;
  if (n === 0) return null;
  return room.playerOrder[room.currentCardIndex % n]!;
}

function publicDeck(room: InternalRoom): PublicDeckCard[] {
  return room.deck.map(({ kind, text }) => ({ kind, text }));
}

function teamsToPublic(room: InternalRoom): {
  teams: TeamInfo[];
  playerTeamId: Record<string, string>;
  teamScores: Record<string, number>;
} {
  const playerTeamId: Record<string, string> = {};
  for (const [pid, tid] of room.playerTeam) {
    playerTeamId[pid] = tid;
  }
  const teamScores: Record<string, number> = {};
  for (const t of room.teams) {
    teamScores[t.id] = room.teamScores.get(t.id) ?? 0;
  }
  return { teams: [...room.teams], playerTeamId, teamScores };
}

function voteSessionToPublic(room: InternalRoom, forSocketId?: string): VoteSessionState | null {
  const v = room.voteSession;
  if (!v) return null;
  const voteCount = v.votes.size;
  const youVoted = forSocketId ? v.votes.has(forSocketId) : false;
  if (!v.revealed) {
    return {
      id: v.id,
      question: v.question,
      candidateIds: v.candidateIds,
      mode: v.mode,
      allowSelfVote: v.allowSelfVote,
      revealed: false,
      voteCount,
      youVoted,
    };
  }
  const tallies: Record<string, number> = {};
  for (const cid of v.candidateIds) tallies[cid] = 0;
  for (const c of v.votes.values()) {
    tallies[c] = (tallies[c] ?? 0) + 1;
  }
  const votesObj: Record<string, string> = {};
  for (const [voter, cand] of v.votes) {
    votesObj[voter] = cand;
  }
  return {
    id: v.id,
    question: v.question,
    candidateIds: v.candidateIds,
    mode: v.mode,
    allowSelfVote: v.allowSelfVote,
    revealed: true,
    voteCount,
    youVoted,
    tallies,
    votes: votesObj,
  };
}

function toRoomState(room: InternalRoom, forSocketId?: string): RoomState {
  let active: string | null = null;
  if (room.phase === 'kingsCup' && room.kingsCup) {
    active = currentKingsTurnPlayerId(room.playerOrder, room.kingsCup.turnIndex);
  } else if (room.phase === 'turn') {
    active = activePlayerIdDeck(room);
  } else if (room.phase === 'revealTurn') {
    active = room.subjectPlayerId;
  }

  const { teams, playerTeamId, teamScores } = teamsToPublic(room);

  return {
    roomCode: room.code,
    phase: room.phase,
    players: playersList(room),
    hostId: room.hostSocketId,
    submittedPlayerIds: [...room.submitted],
    deck: publicDeck(room),
    currentCardIndex: room.currentCardIndex,
    activePlayerId: active,
    truthAnswer: room.truthAnswer,
    truthAdvanceAt: room.truthAdvanceAt,
    gameMode: room.gameMode,
    subjectPlayerId: room.subjectPlayerId,
    authorPlayerId: room.authorPlayerId,
    pickedKind: room.pickedKind,
    authorDeadlineAt: room.authorDeadlineAt,
    spotCard: room.spotCard,
    pickAuthorRound: room.pickAuthorRound,
    settings: room.settings,
    roomLocked: room.roomLocked,
    turnEndsAt: room.turnEndsAt,
    teams,
    playerTeamId,
    teamScores,
    teamRevealActive: room.teamRevealActive,
    voteSession: voteSessionToPublic(room, forSocketId),
    deckRecentIndices: [...room.deckRecentIndices],
    kingsCup: kcToPublic(room),
  };
}

function emitRoomState(ioSrv: Server, room: InternalRoom) {
  for (const sid of room.playerOrder) {
    ioSrv.to(sid).emit('room_state', toRoomState(room, sid));
  }
}

function parseInitialGameMode(raw: unknown): GameMode {
  const m = raw as string;
  if (
    m === 'sharedDeck' ||
    m === 'pickAndWrite' ||
    m === 'neverHaveIEver' ||
    m === 'mostLikelyTo' ||
    m === 'kingsCup'
  ) {
    return m;
  }
  return 'sharedDeck';
}

function finishKingsCupGame(ioSrv: Server, room: InternalRoom) {
  if (room.kingsCup) clearKingsCupTimers(room.kingsCup);
  room.kingsCup = null;
  room.phase = 'finished';
  emitRoomState(ioSrv, room);
}

function resolveHeavenMinigame(ioSrv: Server, room: InternalRoom) {
  const k = room.kingsCup;
  if (!k || k.uiStep !== 'heaven') return;
  if (k.heavenTimer) {
    clearTimeout(k.heavenTimer);
    k.heavenTimer = null;
  }
  const order = room.playerOrder;
  let loser: string | null = null;
  if (k.heavenTaps.size === 0) {
    loser = k.drawerId ?? null;
  } else {
    for (const id of order) {
      if (!k.heavenTaps.has(id)) {
        loser = id;
        break;
      }
    }
    if (!loser) {
      let maxT = -1;
      for (const id of order) {
        const t = k.heavenTaps.get(id);
        if (t != null && t >= maxT) {
          maxT = t;
          loser = id;
        }
      }
    }
  }
  k.lastPenaltyPlayerId = loser;
  k.heavenEndsAt = null;
  const wasLast = k.remaining.length === 0;
  advanceKingsTurn(k, order.length);
  if (wasLast) {
    finishKingsCupGame(ioSrv, room);
  } else {
    emitRoomState(ioSrv, room);
  }
}

/** Drive (5): in-person challenge — drawer taps Done when ready; no tap race. */
function finishDriveRound(ioSrv: Server, room: InternalRoom) {
  const k = room.kingsCup;
  if (!k || k.uiStep !== 'drive') return;
  if (k.driveTimer) {
    clearTimeout(k.driveTimer);
    k.driveTimer = null;
  }
  k.driveEndsAt = null;
  k.driveTaps.clear();
  k.lastPenaltyPlayerId = null;
  const order = room.playerOrder;
  const wasLast = k.remaining.length === 0;
  advanceKingsTurn(k, order.length);
  if (wasLast) finishKingsCupGame(ioSrv, room);
  else emitRoomState(ioSrv, room);
}

function applyKingsCardAck(ioSrv: Server, room: InternalRoom, code: string) {
  const k = room.kingsCup;
  if (!k || !k.faceUp || k.uiStep !== 'cardFaceUp') return;
  const card = k.faceUp;
  const rk = rankKey(card);
  const wasLast = k.remaining.length === 0;
  const drawer = k.drawerId;
  const n = room.playerOrder.length;

  if (rk === 'X') {
    k.lastPenaltyPlayerId = drawer;
    advanceKingsTurn(k, n);
    if (wasLast) finishKingsCupGame(ioSrv, room);
    else emitRoomState(ioSrv, room);
    return;
  }

  if (rk === '5') {
    k.uiStep = 'drive';
    k.driveStep = 0;
    k.driveTaps.clear();
    k.driveEndsAt = null;
    if (k.driveTimer) {
      clearTimeout(k.driveTimer);
      k.driveTimer = null;
    }
    emitRoomState(ioSrv, room);
    return;
  }

  if (rk === '7') {
    k.uiStep = 'heaven';
    k.heavenTaps.clear();
    k.heavenEndsAt = Date.now() + 5000;
    if (k.heavenTimer) clearTimeout(k.heavenTimer);
    k.heavenTimer = setTimeout(() => {
      const r = rooms.get(code);
      if (!r?.kingsCup || r.kingsCup.uiStep !== 'heaven') return;
      resolveHeavenMinigame(ioSrv, r);
    }, 5200);
    emitRoomState(ioSrv, room);
    return;
  }

  if (rk === '2' || rk === '8' || rk === 'Q') {
    k.pickKind = rk as '2' | '8' | 'Q';
    k.uiStep = 'pickPlayer';
    emitRoomState(ioSrv, room);
    return;
  }

  if (rk === 'K') {
    k.activeRule = null;
    k.activeRuleSetterId = null;
    k.uiStep = 'kingRule';
    k.kingRuleSetterId = drawer ?? null;
    emitRoomState(ioSrv, room);
    return;
  }

  advanceKingsTurn(k, n);
  if (wasLast) finishKingsCupGame(ioSrv, room);
  else emitRoomState(ioSrv, room);
}

function pickRandomAuthor(room: InternalRoom, subjectId: string): string {
  const pool = room.playerOrder.filter((id) => id !== subjectId);
  return pool[Math.floor(Math.random() * pool.length)]!;
}

/** Skip Truth/Dare buttons when host chose truth-only or dare-only play style. */
function resolvePickTypeIfAuto(ioSrv: Server, room: InternalRoom) {
  const style = room.settings.truthDarePlayStyle ?? 'mixed';
  if (room.phase !== 'pickType' || !room.subjectPlayerId) return;
  if (style === 'mixed') return;
  clearTurnTimer(room);
  room.pickedKind = style === 'truthOnly' ? 'truth' : 'dare';
  room.authorPlayerId = pickRandomAuthor(room, room.subjectPlayerId);
  room.phase = 'authorPrompt';
  scheduleAuthorDeadline(ioSrv, room);
}

function clearAuthorTimer(room: InternalRoom) {
  if (room.authorTimer) {
    clearTimeout(room.authorTimer);
    room.authorTimer = null;
  }
  room.authorDeadlineAt = null;
}

function clearTruthAdvanceTimer(room: InternalRoom) {
  if (room.truthAdvanceTimer) {
    clearTimeout(room.truthAdvanceTimer);
    room.truthAdvanceTimer = null;
  }
}

function clearTurnTimer(room: InternalRoom) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
  room.turnEndsAt = null;
}

function awardRoundToActiveTeam(room: InternalRoom) {
  if (!room.settings.teamsEnabled) return;
  let active: string | null =
    room.phase === 'revealTurn' ? room.subjectPlayerId : room.phase === 'turn' ? activePlayerIdDeck(room) : null;
  if (!active) return;
  const tid = room.playerTeam.get(active);
  if (!tid) return;
  room.teamScores.set(tid, (room.teamScores.get(tid) ?? 0) + 1);
}

function assignNewPlayerTeam(room: InternalRoom, socketId: string) {
  if (!room.settings.teamsEnabled) return;
  if (room.playerTeam.has(socketId)) return;
  let a = 0;
  let b = 0;
  for (const id of room.playerOrder) {
    const t = room.playerTeam.get(id);
    if (t === TEAM_A_ID) a++;
    else if (t === TEAM_B_ID) b++;
  }
  room.playerTeam.set(socketId, a <= b ? TEAM_A_ID : TEAM_B_ID);
}

function autoBalanceTeams(room: InternalRoom) {
  room.playerOrder.forEach((id, i) => {
    room.playerTeam.set(id, i % 2 === 0 ? TEAM_A_ID : TEAM_B_ID);
  });
}

function scheduleAuthorDeadline(ioSrv: Server, room: InternalRoom) {
  const code = room.code;
  const ms = room.settings.authorPromptMs;
  clearAuthorTimer(room);
  room.authorDeadlineAt = Date.now() + ms;
  room.authorTimer = setTimeout(() => {
    const r = rooms.get(code);
    if (!r || r.phase !== 'authorPrompt' || !r.pickedKind) return;
    clearAuthorTimer(r);
    r.spotCard = {
      kind: r.pickedKind,
      text:
        r.pickedKind === 'truth'
          ? 'Time ran out — ask them any truth question you want!'
          : 'Time ran out — give them a quick dare on the spot!',
    };
    r.phase = 'revealTurn';
    r.pickedKind = null;
    r.authorPlayerId = null;
    emitRoomState(ioSrv, r);
    scheduleTurnTimer(ioSrv, r);
  }, ms);
}

function forceSkipRound(ioSrv: Server, room: InternalRoom) {
  clearTurnTimer(room);
  clearTruthAdvanceTimer(room);
  clearAuthorTimer(room);
  room.pendingAdvance = false;
  room.truthAnswer = null;
  room.truthAdvanceAt = null;

  if (room.voteSession && !room.voteSession.revealed) {
    return;
  }

  if (room.phase === 'pickType' && room.subjectPlayerId) {
    const style = room.settings.truthDarePlayStyle ?? 'mixed';
    const choice: CardKind =
      style === 'truthOnly' ? 'truth' : style === 'dareOnly' ? 'dare' : Math.random() < 0.5 ? 'truth' : 'dare';
    room.pickedKind = choice;
    room.authorPlayerId = pickRandomAuthor(room, room.subjectPlayerId);
    room.phase = 'authorPrompt';
    scheduleAuthorDeadline(ioSrv, room);
    emitRoomState(ioSrv, room);
    maybePartyMoment(ioSrv, room, 0.35);
    return;
  }

  if (room.phase === 'authorPrompt' && room.subjectPlayerId && room.pickedKind) {
    room.spotCard = {
      kind: room.pickedKind,
      text: 'Skipped — make something up on the spot!',
    };
    room.pickedKind = null;
    room.authorPlayerId = null;
    room.phase = 'revealTurn';
    emitRoomState(ioSrv, room);
    scheduleTurnTimer(ioSrv, room);
    maybePartyMoment(ioSrv, room, 0.35);
    return;
  }

  if (room.phase === 'turn') {
    advanceCard(ioSrv, room);
    maybePartyMoment(ioSrv, room, 0.3);
    return;
  }

  if (room.phase === 'revealTurn') {
    advancePickAuthorTurn(ioSrv, room);
    maybePartyMoment(ioSrv, room, 0.3);
  }
}

function scheduleTurnTimer(ioSrv: Server, room: InternalRoom) {
  clearTurnTimer(room);
  if (room.voteSession && !room.voteSession.revealed) return;
  const sec = effectiveTurnSeconds(room);
  if (sec <= 0) return;
  if (room.phase === 'authorPrompt') return;
  if (!['pickType', 'turn', 'revealTurn'].includes(room.phase)) return;

  room.turnEndsAt = Date.now() + sec * 1000;
  const code = room.code;
  room.turnTimer = setTimeout(() => {
    const r = rooms.get(code);
    if (!r) return;
    forceSkipRound(ioSrv, r);
  }, sec * 1000);
}

function validateCardBatch(
  room: InternalRoom,
  truths: string[],
  dares: string[],
): { ok: true } | { ok: false; error: string } {
  const tp = room.settings.truthsPerPlayer;
  const dp = room.settings.daresPerPlayer;
  const mltSrc = room.settings.mltDeckSource ?? 'mixed';

  if (room.gameMode === 'neverHaveIEver') {
    if (truths.length !== tp || dares.length !== 0) {
      return {
        ok: false,
        error: `Need exactly ${tp} prompts and no dare slots for this mode.`,
      };
    }
    for (const t of truths) {
      const s = t.trim();
      if (!s) return { ok: false, error: 'Prompts cannot be empty.' };
      if (s.length > MAX_CARD_TEXT_LENGTH) {
        return { ok: false, error: `Max ${MAX_CARD_TEXT_LENGTH} characters per line.` };
      }
    }
    return { ok: true };
  }

  if (room.gameMode === 'mostLikelyTo') {
    if (mltSrc === 'builtin') {
      return { ok: true };
    }
    if (mltSrc === 'custom') {
      if (truths.length !== tp || dares.length !== 0) {
        return {
          ok: false,
          error: `Need exactly ${tp} custom prompts (no dare slots).`,
        };
      }
      for (const t of truths) {
        const s = t.trim();
        if (!s) return { ok: false, error: 'Prompts cannot be empty.' };
        if (s.length > MAX_CARD_TEXT_LENGTH) {
          return { ok: false, error: `Max ${MAX_CARD_TEXT_LENGTH} characters per line.` };
        }
      }
      return { ok: true };
    }
    if (truths.length !== tp || dares.length !== 0) {
      return {
        ok: false,
        error: `Need exactly ${tp} prompts and no dare slots for this mode.`,
      };
    }
    for (const t of truths) {
      const s = t.trim();
      if (!s) return { ok: false, error: 'Prompts cannot be empty.' };
      if (s.length > MAX_CARD_TEXT_LENGTH) {
        return { ok: false, error: `Max ${MAX_CARD_TEXT_LENGTH} characters per line.` };
      }
    }
    return { ok: true };
  }

  const style = room.settings.truthDarePlayStyle ?? 'mixed';
  if (style === 'truthOnly') {
    if (truths.length !== tp || dares.length !== 0) {
      return {
        ok: false,
        error: `Need exactly ${tp} truths and no dares.`,
      };
    }
    for (const t of truths) {
      const s = t.trim();
      if (!s) return { ok: false, error: 'Cards cannot be empty.' };
      if (s.length > MAX_CARD_TEXT_LENGTH) {
        return { ok: false, error: `Max ${MAX_CARD_TEXT_LENGTH} characters per card.` };
      }
    }
    return { ok: true };
  }
  if (style === 'dareOnly') {
    if (dares.length !== dp || truths.length !== 0) {
      return {
        ok: false,
        error: `Need exactly ${dp} dares and no truths.`,
      };
    }
    for (const t of dares) {
      const s = t.trim();
      if (!s) return { ok: false, error: 'Cards cannot be empty.' };
      if (s.length > MAX_CARD_TEXT_LENGTH) {
        return { ok: false, error: `Max ${MAX_CARD_TEXT_LENGTH} characters per card.` };
      }
    }
    return { ok: true };
  }

  if (truths.length !== tp || dares.length !== dp) {
    return {
      ok: false,
      error: `Need exactly ${tp} truths and ${dp} dares.`,
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

function buildNhieDeck(room: InternalRoom): InternalCard[] {
  const cards: InternalCard[] = [];
  for (const sid of room.playerOrder) {
    const pack = room.cardStorage.get(sid);
    if (!pack) continue;
    for (const text of pack.truths) {
      cards.push({ kind: 'nhie', text: text.trim(), authorId: sid });
    }
  }
  return orderDeckReduceRepeats(shuffle(cards), room.deckRecentTexts);
}

function buildMltDeck(room: InternalRoom): InternalCard[] {
  const playerCards: InternalCard[] = [];
  for (const sid of room.playerOrder) {
    const pack = room.cardStorage.get(sid);
    if (!pack) continue;
    for (const text of pack.truths) {
      const t = text.trim();
      if (!t) continue;
      playerCards.push({ kind: 'mlt', text: t, authorId: sid });
    }
  }
  const cat = room.settings.mostLikelyCategory;
  const pool = MLT_POOLS[cat] ?? MLT_POOLS.spicy;
  const source = room.settings.mltDeckSource ?? 'mixed';

  if (source === 'custom') {
    if (playerCards.length === 0) return [];
    return orderDeckReduceRepeats(shuffle(playerCards), room.deckRecentTexts);
  }

  if (source === 'builtin') {
    const n = Math.max(16, Math.min(48, Math.max(room.playerOrder.length * 8, 24)));
    const lines = shuffle([...pool]);
    const builtin: InternalCard[] = [];
    for (let i = 0; i < Math.min(n, lines.length); i++) {
      builtin.push({ kind: 'mlt', text: lines[i]!, authorId: 'system' });
    }
    return orderDeckReduceRepeats(shuffle(builtin), room.deckRecentTexts);
  }

  const taken = new Set(playerCards.map((c) => normalizeDeckText(c.text)));
  const extras = shuffle([...pool]).filter((t) => !taken.has(normalizeDeckText(t)));
  const nExtra = Math.min(12, Math.max(4, Math.floor(playerCards.length * 0.45)));
  const merged = [...playerCards];
  for (let i = 0; i < Math.min(nExtra, extras.length); i++) {
    const text = extras[i]!;
    merged.push({ kind: 'mlt', text, authorId: 'system' });
  }
  if (merged.length === 0) return [];
  return orderDeckReduceRepeats(shuffle(merged), room.deckRecentTexts);
}

function buildDeck(room: InternalRoom): InternalCard[] {
  if (room.gameMode === 'neverHaveIEver') return buildNhieDeck(room);
  if (room.gameMode === 'mostLikelyTo') return buildMltDeck(room);

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
  return orderDeckReduceRepeats(shuffle(cards), room.deckRecentTexts);
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
  room.playerTeam.delete(socketId);
  if (room.voteSession) {
    room.voteSession.votes.delete(socketId);
  }
  clearTruthAdvanceTimer(room);
  clearTurnTimer(room);
  clearAuthorTimer(room);

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
    const ap = activePlayerIdDeck(room);
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

  if (['pickType', 'authorPrompt', 'revealTurn'].includes(room.phase)) {
    const subjectGone = room.subjectPlayerId && !room.players.has(room.subjectPlayerId);
    const authorGone =
      room.phase === 'authorPrompt' &&
      room.authorPlayerId &&
      !room.players.has(room.authorPlayerId);
    if (subjectGone) {
      clearAuthorTimer(room);
      room.phase = 'lobby';
      room.subjectPlayerId = null;
      room.authorPlayerId = null;
      room.pickedKind = null;
      room.spotCard = null;
      room.truthAnswer = null;
      room.truthAdvanceAt = null;
      room.pendingAdvance = false;
    } else if (authorGone && room.subjectPlayerId) {
      clearAuthorTimer(room);
      const pool = room.playerOrder.filter((id) => id !== room.subjectPlayerId);
      if (pool.length === 0) {
        room.phase = 'lobby';
        room.subjectPlayerId = null;
        room.authorPlayerId = null;
        room.pickedKind = null;
        room.spotCard = null;
        room.truthAnswer = null;
        room.truthAdvanceAt = null;
        room.pendingAdvance = false;
      } else {
        room.authorPlayerId = pickRandomAuthor(room, room.subjectPlayerId);
        scheduleAuthorDeadline(io, room);
      }
    }
  }

  emitRoomState(io, room);
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

  socket.on('create_room', (payload: { playerName: string; gameMode?: GameMode }, ack) => {
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
      truthAdvanceTimer: null,
      gameMode: parseInitialGameMode(payload?.gameMode),
      subjectPlayerId: null,
      authorPlayerId: null,
      pickedKind: null,
      authorDeadlineAt: null,
      spotCard: null,
      pickAuthorRound: 0,
      authorTimer: null,
      turnTimer: null,
      settings: defaultRoomSettings(),
      roomLocked: false,
      turnEndsAt: null,
      teams: [
        { id: TEAM_A_ID, name: 'Team A' },
        { id: TEAM_B_ID, name: 'Team B' },
      ],
      playerTeam: new Map([[socket.id, TEAM_A_ID]]),
      teamScores: new Map([
        [TEAM_A_ID, 0],
        [TEAM_B_ID, 0],
      ]),
      teamRevealActive: false,
      voteSession: null,
      deckRecentIndices: [],
      deckRecentTexts: [],
      kingsCup: null,
    };
    rooms.set(code, room);
    socket.join(code);
    socketRoom.set(socket.id, code);

    ack?.({ ok: true, hostToken, roomState: toRoomState(room, socket.id) });
    socket.emit('room_state', toRoomState(room, socket.id));
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
    if (room.roomLocked && room.phase === 'lobby') {
      ack?.({ ok: false, error: 'Room is locked by the host.' });
      return;
    }
    if (
      ['shuffling', 'turn', 'finished', 'pickType', 'authorPrompt', 'revealTurn', 'kingsCup'].includes(
        room.phase,
      )
    ) {
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
    assignNewPlayerTeam(room, socket.id);

    ack?.({ ok: true, roomState: toRoomState(room, socket.id) });
    emitRoomState(io, room);
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
    if (room.gameMode === 'pickAndWrite') {
      ack?.({ ok: false, error: 'Use “Start pick & write” for that mode.' });
      return;
    }
    if (room.settings.teamsEnabled && room.teamRevealActive) {
      ack?.({ ok: false, error: 'Dismiss the team reveal first.' });
      return;
    }

    room.phase = 'writingCards';
    room.submitted.clear();
    room.cardStorage.clear();
    room.pendingAdvance = false;
    clearAuthorTimer(room);
    room.subjectPlayerId = null;
    room.authorPlayerId = null;
    room.pickedKind = null;
    room.spotCard = null;
    room.authorDeadlineAt = null;
    ack?.({ ok: true });
    emitRoomState(io, room);
  });

  socket.on('set_game_mode', (payload: { hostToken: string; gameMode: GameMode }, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id || payload?.hostToken !== room.hostToken) {
      ack?.({ ok: false, error: 'Only the host can change mode.' });
      return;
    }
    if (room.phase !== 'lobby') {
      ack?.({ ok: false, error: 'Can only change mode in the lobby.' });
      return;
    }
    const m = payload?.gameMode;
    if (
      m !== 'sharedDeck' &&
      m !== 'pickAndWrite' &&
      m !== 'neverHaveIEver' &&
      m !== 'mostLikelyTo' &&
      m !== 'kingsCup'
    ) {
      ack?.({ ok: false, error: 'Invalid game mode.' });
      return;
    }
    room.gameMode = m;
    ack?.({ ok: true });
    emitRoomState(io, room);
  });

  socket.on(
    'update_room_settings',
    (payload: { hostToken: string; settings: Partial<RoomSettings> }, ack) => {
      const code = socketRoom.get(socket.id);
      if (!code) {
        ack?.({ ok: false, error: 'Not in a room.' });
        return;
      }
      const room = rooms.get(code);
      if (!room || room.hostSocketId !== socket.id || payload?.hostToken !== room.hostToken) {
        ack?.({ ok: false, error: 'Only the host can change settings.' });
        return;
      }
      if (room.phase !== 'lobby') {
        ack?.({ ok: false, error: 'Settings can only be changed in the lobby.' });
        return;
      }
      room.settings = clampRoomSettings({ ...room.settings, ...payload?.settings });
      if (room.settings.teamsEnabled) {
        for (const id of room.playerOrder) {
          if (!room.playerTeam.has(id)) assignNewPlayerTeam(room, id);
        }
      }
      ack?.({ ok: true });
      emitRoomState(io, room);
    },
  );

  socket.on('start_pick_author', (payload: { hostToken: string }, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id || payload?.hostToken !== room.hostToken) {
      ack?.({ ok: false, error: 'Only the host can start.' });
      return;
    }
    if (room.phase !== 'lobby') {
      ack?.({ ok: false, error: 'Already started.' });
      return;
    }
    if (room.players.size < 2) {
      ack?.({ ok: false, error: 'Need at least 2 players.' });
      return;
    }
    if (room.settings.teamsEnabled && room.teamRevealActive) {
      ack?.({ ok: false, error: 'Dismiss the team reveal first.' });
      return;
    }
    if (room.gameMode !== 'pickAndWrite') {
      ack?.({ ok: false, error: 'Switch to “Pick & write” mode first.' });
      return;
    }

    clearAuthorTimer(room);
    room.gameMode = 'pickAndWrite';
    room.phase = 'pickType';
    room.pickAuthorRound = 0;
    room.subjectPlayerId = room.playerOrder[0]!;
    room.authorPlayerId = null;
    room.pickedKind = null;
    room.spotCard = null;
    room.truthAnswer = null;
    room.truthAdvanceAt = null;
    room.pendingAdvance = false;
    room.deck = [];
    room.currentCardIndex = 0;
    room.submitted.clear();
    room.cardStorage.clear();
    room.authorDeadlineAt = null;

    resolvePickTypeIfAuto(io, room);

    ack?.({ ok: true });
    emitRoomState(io, room);
    if (room.phase === 'pickType') scheduleTurnTimer(io, room);
  });

  socket.on('pick_truth_or_dare', (payload: { choice: CardKind }, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    if (!room || room.phase !== 'pickType' || !room.subjectPlayerId) {
      ack?.({ ok: false, error: 'Not choosing right now.' });
      return;
    }
    if (socket.id !== room.subjectPlayerId) {
      ack?.({ ok: false, error: 'Only the player whose turn it is can choose.' });
      return;
    }
    const choice = payload?.choice;
    if (choice !== 'truth' && choice !== 'dare') {
      ack?.({ ok: false, error: 'Pick truth or dare.' });
      return;
    }
    const style = room.settings.truthDarePlayStyle ?? 'mixed';
    if (style === 'truthOnly' && choice !== 'truth') {
      ack?.({ ok: false, error: 'This round is truth only.' });
      return;
    }
    if (style === 'dareOnly' && choice !== 'dare') {
      ack?.({ ok: false, error: 'This round is dare only.' });
      return;
    }
    if (room.voteSession && !room.voteSession.revealed) {
      ack?.({ ok: false, error: 'Finish the vote first.' });
      return;
    }

    clearTurnTimer(room);
    room.pickedKind = choice;
    room.authorPlayerId = pickRandomAuthor(room, room.subjectPlayerId);
    room.phase = 'authorPrompt';
    scheduleAuthorDeadline(io, room);

    ack?.({ ok: true });
    emitRoomState(io, room);
  });

  socket.on('submit_author_prompt', (payload: { text: string }, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    if (!room || room.phase !== 'authorPrompt' || !room.authorPlayerId || !room.pickedKind) {
      ack?.({ ok: false, error: 'Not writing a prompt right now.' });
      return;
    }
    if (room.voteSession && !room.voteSession.revealed) {
      ack?.({ ok: false, error: 'Finish the vote first.' });
      return;
    }
    if (socket.id !== room.authorPlayerId) {
      ack?.({ ok: false, error: 'You were not picked to write this prompt.' });
      return;
    }

    const text = (payload?.text ?? '').trim();
    if (!text) {
      ack?.({ ok: false, error: 'Write something.' });
      return;
    }
    if (text.length > MAX_CARD_TEXT_LENGTH) {
      ack?.({ ok: false, error: `Max ${MAX_CARD_TEXT_LENGTH} characters.` });
      return;
    }

    clearAuthorTimer(room);
    room.spotCard = { kind: room.pickedKind, text };
    room.pickedKind = null;
    room.authorPlayerId = null;
    room.phase = 'revealTurn';

    ack?.({ ok: true });
    emitRoomState(io, room);
    scheduleTurnTimer(io, room);
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

    const v = validateCardBatch(room, payload?.truths ?? [], payload?.dares ?? []);
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
      emitRoomState(io, room);
    }
  });

  function beginShuffleAndPlay(ioSrv: Server, room: InternalRoom): boolean {
    const code = room.code;
    clearTurnTimer(room);
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
    emitRoomState(ioSrv, room);

    setTimeout(() => {
      const r = rooms.get(code);
      if (!r || r.phase !== 'shuffling') return;
      r.phase = 'turn';
      emitRoomState(ioSrv, r);
      scheduleTurnTimer(ioSrv, r);
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
    const mltBuiltin =
      room.gameMode === 'mostLikelyTo' && (room.settings.mltDeckSource ?? 'mixed') === 'builtin';
    if (room.submitted.size === 0 && !mltBuiltin) {
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
    if (!room || (room.phase !== 'turn' && room.phase !== 'revealTurn')) {
      ack?.({ ok: false, error: 'Not your turn to answer.' });
      return;
    }

    const subjectId =
      room.phase === 'revealTurn' ? room.subjectPlayerId : activePlayerIdDeck(room);
    if (!subjectId || subjectId !== socket.id) {
      ack?.({ ok: false, error: 'Only the active player can answer.' });
      return;
    }

    const card =
      room.phase === 'revealTurn'
        ? room.spotCard
        : room.deck[room.currentCardIndex];
    if (!card || card.kind === 'dare') {
      ack?.({ ok: false, error: 'This card needs a written answer.' });
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
    if (room.voteSession && !room.voteSession.revealed) {
      ack?.({ ok: false, error: 'Finish the vote first.' });
      return;
    }

    clearTurnTimer(room);
    clearTruthAdvanceTimer(room);

    const readMs = room.settings.truthAnswerDisplayMs;
    room.truthAnswer = text;
    room.truthAdvanceAt = Date.now() + readMs;
    room.pendingAdvance = true;
    emitRoomState(io, room);

    room.truthAdvanceTimer = setTimeout(() => {
      const r = rooms.get(code);
      if (!r) return;
      r.pendingAdvance = false;
      clearTruthAdvanceTimer(r);
      awardRoundToActiveTeam(r);
      if (r.phase === 'revealTurn' && r.gameMode === 'pickAndWrite') {
        advancePickAuthorTurn(io, r);
      } else {
        advanceCard(io, r);
      }
    }, readMs);
    ack?.({ ok: true });
  });

  socket.on('dare_done', (_payload, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    if (!room || (room.phase !== 'turn' && room.phase !== 'revealTurn')) {
      ack?.({ ok: false, error: 'No active dare.' });
      return;
    }

    const subjectId =
      room.phase === 'revealTurn' ? room.subjectPlayerId : activePlayerIdDeck(room);
    if (!subjectId || subjectId !== socket.id) {
      ack?.({ ok: false, error: 'Only the active player can mark done.' });
      return;
    }

    const card =
      room.phase === 'revealTurn'
        ? room.spotCard
        : room.deck[room.currentCardIndex];
    if (!card || card.kind !== 'dare') {
      ack?.({ ok: false, error: 'Current card is not a Dare.' });
      return;
    }
    if (room.pendingAdvance) {
      ack?.({ ok: false, error: 'Please wait.' });
      return;
    }
    if (room.voteSession && !room.voteSession.revealed) {
      ack?.({ ok: false, error: 'Finish the vote first.' });
      return;
    }

    clearTurnTimer(room);
    awardRoundToActiveTeam(room);
    room.pendingAdvance = true;
    if (room.phase === 'revealTurn' && room.gameMode === 'pickAndWrite') {
      advancePickAuthorTurn(io, room);
    } else {
      advanceCard(io, room);
    }
    room.pendingAdvance = false;
    maybePartyMoment(io, room, 0.28);
    ack?.({ ok: true });
  });

  socket.on('toggle_room_lock', (payload: { hostToken: string; locked: boolean }, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id || payload?.hostToken !== room.hostToken) {
      ack?.({ ok: false, error: 'Only the host can lock the room.' });
      return;
    }
    if (room.phase !== 'lobby') {
      ack?.({ ok: false, error: 'Lock only works in the lobby.' });
      return;
    }
    room.roomLocked = Boolean(payload?.locked);
    ack?.({ ok: true });
    emitRoomState(io, room);
  });

  socket.on('kick_player', (payload: { hostToken: string; targetId: string }, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id || payload?.hostToken !== room.hostToken) {
      ack?.({ ok: false, error: 'Only the host can remove players.' });
      return;
    }
    const target = payload?.targetId;
    if (!target || target === socket.id) {
      ack?.({ ok: false, error: 'Invalid player.' });
      return;
    }
    if (!room.players.has(target)) {
      ack?.({ ok: false, error: 'Player not in room.' });
      return;
    }
    leaveRoom(io, target);
    io.sockets.sockets.get(target)?.disconnect(true);
    ack?.({ ok: true });
  });

  socket.on('skip_round', (payload: { hostToken: string }, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id || payload?.hostToken !== room.hostToken) {
      ack?.({ ok: false, error: 'Only the host can skip.' });
      return;
    }
    forceSkipRound(io, room);
    ack?.({ ok: true });
  });

  socket.on('restart_game', (payload: { hostToken: string }, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id || payload?.hostToken !== room.hostToken) {
      ack?.({ ok: false, error: 'Only the host can restart.' });
      return;
    }
    clearTruthAdvanceTimer(room);
    clearTurnTimer(room);
    clearAuthorTimer(room);
    room.phase = 'lobby';
    room.deck = [];
    room.currentCardIndex = 0;
    room.truthAnswer = null;
    room.truthAdvanceAt = null;
    room.pendingAdvance = false;
    room.submitted.clear();
    room.cardStorage.clear();
    room.subjectPlayerId = null;
    room.authorPlayerId = null;
    room.pickedKind = null;
    room.spotCard = null;
    room.pickAuthorRound = 0;
    room.authorDeadlineAt = null;
    room.voteSession = null;
    room.teamRevealActive = false;
    room.deckRecentTexts = [];
    for (const tid of room.teamScores.keys()) {
      room.teamScores.set(tid, 0);
    }
    if (room.kingsCup) clearKingsCupTimers(room.kingsCup);
    room.kingsCup = null;
    ack?.({ ok: true });
    emitRoomState(io, room);
  });

  socket.on('start_kings_cup', (payload: { hostToken: string }, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id || payload?.hostToken !== room.hostToken) {
      ack?.({ ok: false, error: 'Only the host can start.' });
      return;
    }
    if (room.phase !== 'lobby') {
      ack?.({ ok: false, error: 'Already started.' });
      return;
    }
    if (room.gameMode !== 'kingsCup') {
      ack?.({ ok: false, error: 'Room is not Kings Cup mode.' });
      return;
    }
    if (room.players.size < 2) {
      ack?.({ ok: false, error: 'Need at least 2 players.' });
      return;
    }
    if (room.kingsCup) clearKingsCupTimers(room.kingsCup);
    room.kingsCup = initKingsCupInternal();
    room.phase = 'kingsCup';
    ack?.({ ok: true });
    emitRoomState(io, room);
  });

  socket.on('kings_draw', (_payload, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    if (!room || room.phase !== 'kingsCup' || !room.kingsCup) {
      ack?.({ ok: false, error: 'Not in a Kings Cup game.' });
      return;
    }
    const k = room.kingsCup;
    if (k.uiStep !== 'waitingDraw') {
      ack?.({ ok: false, error: 'Not your turn to draw.' });
      return;
    }
    const expected = currentKingsTurnPlayerId(room.playerOrder, k.turnIndex);
    if (socket.id !== expected) {
      ack?.({ ok: false, error: 'Wait for your turn.' });
      return;
    }
    k.lastPenaltyPlayerId = null;
    if (k.remaining.length === 0) {
      finishKingsCupGame(io, room);
      ack?.({ ok: true });
      return;
    }
    const card = k.remaining.pop()!;
    k.faceUp = card;
    k.drawerId = socket.id;
    k.uiStep = 'cardFaceUp';
    ack?.({ ok: true });
    emitRoomState(io, room);
  });

  socket.on('kings_ack_reveal', (_payload, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    if (!room?.kingsCup || room.phase !== 'kingsCup') {
      ack?.({ ok: false, error: 'No active card.' });
      return;
    }
    const k = room.kingsCup;
    if (k.uiStep !== 'cardFaceUp' || socket.id !== k.drawerId) {
      ack?.({ ok: false, error: 'Only the drawer can continue.' });
      return;
    }
    applyKingsCardAck(io, room, code);
    ack?.({ ok: true });
  });

  socket.on('kings_heaven_tap', (_payload, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    const k = room?.kingsCup;
    if (!k || k.uiStep !== 'heaven') {
      ack?.({ ok: false, error: 'Not in heaven round.' });
      return;
    }
    k.heavenTaps.set(socket.id, Date.now());
    ack?.({ ok: true });
    emitRoomState(io, room);
  });

  socket.on('kings_drive_done', (_payload, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    const k = room?.kingsCup;
    if (!room || !k || k.uiStep !== 'drive') {
      ack?.({ ok: false, error: 'Not in drive round.' });
      return;
    }
    if (socket.id !== k.drawerId) {
      ack?.({ ok: false, error: 'Only the drawer can continue.' });
      return;
    }
    finishDriveRound(io, room);
    ack?.({ ok: true });
  });

  socket.on('kings_pick_player', (payload: { targetId: string }, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    const k = room?.kingsCup;
    if (!room || !k || k.uiStep !== 'pickPlayer' || !k.pickKind || !k.drawerId) {
      ack?.({ ok: false, error: 'Cannot pick now.' });
      return;
    }
    if (socket.id !== k.drawerId) {
      ack?.({ ok: false, error: 'Only the card drawer picks.' });
      return;
    }
    const targetId = payload?.targetId;
    if (!targetId || !room.players.has(targetId)) {
      ack?.({ ok: false, error: 'Pick a player in the room.' });
      return;
    }
    if (k.pickKind === '8' && targetId === k.drawerId) {
      ack?.({ ok: false, error: 'Pick someone else as your mate.' });
      return;
    }
    if (k.pickKind === '2') k.lastPenaltyPlayerId = targetId;
    if (k.pickKind === '8') k.drinkingBuddy = { a: k.drawerId, b: targetId };
    if (k.pickKind === 'Q') k.queenCurse = { queenId: k.drawerId, cursedId: targetId };
    const wasLast = k.remaining.length === 0;
    advanceKingsTurn(k, room.playerOrder.length);
    if (wasLast) finishKingsCupGame(io, room);
    else emitRoomState(io, room);
    ack?.({ ok: true });
  });

  socket.on('kings_submit_king_rule', (payload: { text: string }, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    const k = room?.kingsCup;
    if (!room || !k || k.uiStep !== 'kingRule' || !k.kingRuleSetterId) {
      ack?.({ ok: false, error: 'No rule entry.' });
      return;
    }
    if (socket.id !== k.kingRuleSetterId) {
      ack?.({ ok: false, error: 'Only the King drawer sets the rule.' });
      return;
    }
    const text = (payload?.text ?? '').trim().slice(0, 280);
    if (!text) {
      ack?.({ ok: false, error: 'Write a rule.' });
      return;
    }
    k.activeRule = text;
    k.activeRuleSetterId = socket.id;
    const wasLast = k.remaining.length === 0;
    advanceKingsTurn(k, room.playerOrder.length);
    if (wasLast) finishKingsCupGame(io, room);
    else emitRoomState(io, room);
    ack?.({ ok: true });
  });

  socket.on('clear_vote', (payload: { hostToken: string }, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id || payload?.hostToken !== room.hostToken) {
      ack?.({ ok: false, error: 'Only the host can clear the vote.' });
      return;
    }
    room.voteSession = null;
    ack?.({ ok: true });
    emitRoomState(io, room);
    scheduleTurnTimer(io, room);
  });

  socket.on('set_team_names', (payload: { hostToken: string; nameA: string; nameB: string }, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id || payload?.hostToken !== room.hostToken) {
      ack?.({ ok: false, error: 'Only the host can name teams.' });
      return;
    }
    if (room.phase !== 'lobby') {
      ack?.({ ok: false, error: 'Only in the lobby.' });
      return;
    }
    const na = (payload?.nameA ?? 'Team A').trim().slice(0, MAX_TEAM_NAME_LENGTH) || 'Team A';
    const nb = (payload?.nameB ?? 'Team B').trim().slice(0, MAX_TEAM_NAME_LENGTH) || 'Team B';
    room.teams = [
      { id: TEAM_A_ID, name: na },
      { id: TEAM_B_ID, name: nb },
    ];
    ack?.({ ok: true });
    emitRoomState(io, room);
  });

  socket.on(
    'assign_player_team',
    (payload: { hostToken: string; playerId: string; teamId: string }, ack) => {
      const code = socketRoom.get(socket.id);
      if (!code) {
        ack?.({ ok: false, error: 'Not in a room.' });
        return;
      }
      const room = rooms.get(code);
      if (!room || room.hostSocketId !== socket.id || payload?.hostToken !== room.hostToken) {
        ack?.({ ok: false, error: 'Only the host can assign teams.' });
        return;
      }
      if (room.phase !== 'lobby') {
        ack?.({ ok: false, error: 'Only in the lobby.' });
        return;
      }
      const pid = payload?.playerId;
      const tid = payload?.teamId;
      if (!pid || !room.players.has(pid)) {
        ack?.({ ok: false, error: 'Invalid player.' });
        return;
      }
      if (tid !== TEAM_A_ID && tid !== TEAM_B_ID) {
        ack?.({ ok: false, error: 'Invalid team.' });
        return;
      }
      room.playerTeam.set(pid, tid);
      ack?.({ ok: true });
      emitRoomState(io, room);
    },
  );

  socket.on('auto_balance_teams', (payload: { hostToken: string }, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id || payload?.hostToken !== room.hostToken) {
      ack?.({ ok: false, error: 'Only the host.' });
      return;
    }
    if (room.phase !== 'lobby') {
      ack?.({ ok: false, error: 'Only in the lobby.' });
      return;
    }
    autoBalanceTeams(room);
    ack?.({ ok: true });
    emitRoomState(io, room);
  });

  socket.on('team_reveal_show', (payload: { hostToken: string }, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id || payload?.hostToken !== room.hostToken) {
      ack?.({ ok: false, error: 'Only the host.' });
      return;
    }
    if (room.phase !== 'lobby' || !room.settings.teamsEnabled) {
      ack?.({ ok: false, error: 'Teams must be on in the lobby.' });
      return;
    }
    room.teamRevealActive = true;
    ack?.({ ok: true });
    emitRoomState(io, room);
  });

  socket.on('team_reveal_dismiss', (payload: { hostToken: string }, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id || payload?.hostToken !== room.hostToken) {
      ack?.({ ok: false, error: 'Only the host.' });
      return;
    }
    room.teamRevealActive = false;
    ack?.({ ok: true });
    emitRoomState(io, room);
  });

  socket.on(
    'start_vote',
    (
      payload: {
        hostToken: string;
        question: string;
        mode: 'players' | 'teams';
        allowSelfVote?: boolean;
      },
      ack,
    ) => {
      const code = socketRoom.get(socket.id);
      if (!code) {
        ack?.({ ok: false, error: 'Not in a room.' });
        return;
      }
      const room = rooms.get(code);
      if (!room || room.hostSocketId !== socket.id || payload?.hostToken !== room.hostToken) {
        ack?.({ ok: false, error: 'Only the host can start a vote.' });
        return;
      }
      if (room.voteSession && !room.voteSession.revealed) {
        ack?.({ ok: false, error: 'Finish or reveal the current vote first.' });
        return;
      }
      const q = (payload?.question ?? '').trim();
      if (!q || q.length > 200) {
        ack?.({ ok: false, error: 'Add a short question.' });
        return;
      }
      const mode = payload?.mode === 'teams' ? 'teams' : 'players';
      let candidateIds: string[] = [];
      if (mode === 'teams') {
        candidateIds = [TEAM_A_ID, TEAM_B_ID];
      } else {
        candidateIds = [...room.playerOrder];
      }
      if (candidateIds.length < 2) {
        ack?.({ ok: false, error: 'Need at least 2 candidates.' });
        return;
      }
      room.voteSession = {
        id: uuidv4(),
        question: q,
        candidateIds,
        mode,
        allowSelfVote: payload?.allowSelfVote ?? room.settings.preventSelfVoteDefault,
        votes: new Map(),
        revealed: false,
      };
      clearTurnTimer(room);
      ack?.({ ok: true });
      emitRoomState(io, room);
    },
  );

  socket.on('cast_vote', (payload: { voteId: string }, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    if (!room?.voteSession || room.voteSession.revealed) {
      ack?.({ ok: false, error: 'No open vote.' });
      return;
    }
    const v = room.voteSession;
    const choice = payload?.voteId;
    if (!choice || !v.candidateIds.includes(choice)) {
      ack?.({ ok: false, error: 'Pick a valid option.' });
      return;
    }
    if (!v.allowSelfVote && v.mode === 'players' && choice === socket.id) {
      ack?.({ ok: false, error: 'Self-votes are off.' });
      return;
    }
    if (!v.allowSelfVote && v.mode === 'teams') {
      const myTeam = room.playerTeam.get(socket.id);
      if (myTeam && choice === myTeam) {
        ack?.({ ok: false, error: 'Self-votes are off.' });
        return;
      }
    }
    v.votes.set(socket.id, choice);
    ack?.({ ok: true });
    emitRoomState(io, room);
  });

  socket.on('reveal_votes', (payload: { hostToken: string }, ack) => {
    const code = socketRoom.get(socket.id);
    if (!code) {
      ack?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id || payload?.hostToken !== room.hostToken) {
      ack?.({ ok: false, error: 'Only the host can reveal.' });
      return;
    }
    if (!room.voteSession || room.voteSession.revealed) {
      ack?.({ ok: false, error: 'Nothing to reveal.' });
      return;
    }
    room.voteSession.revealed = true;
    io.to(code).emit('party_moment', randomPartyMoment());
    ack?.({ ok: true });
    emitRoomState(io, room);
    scheduleTurnTimer(io, room);
  });

  socket.on('disconnect', () => {
    leaveRoom(io, socket.id);
  });
});

function advancePickAuthorTurn(ioSrv: Server, room: InternalRoom) {
  clearAuthorTimer(room);
  clearTurnTimer(room);
  room.truthAnswer = null;
  room.truthAdvanceAt = null;
  room.spotCard = null;
  room.pickedKind = null;
  room.authorPlayerId = null;
  room.subjectPlayerId = null;
  room.pendingAdvance = false;

  room.pickAuthorRound += 1;
  const totalTurns = room.playerOrder.length * room.settings.pickCycles;
  if (room.pickAuthorRound >= totalTurns) {
    room.phase = 'finished';
    emitRoomState(ioSrv, room);
    maybePartyMoment(ioSrv, room, 0.45);
    return;
  }
  room.phase = 'pickType';
  room.subjectPlayerId = room.playerOrder[room.pickAuthorRound % room.playerOrder.length]!;

  resolvePickTypeIfAuto(ioSrv, room);

  emitRoomState(ioSrv, room);
  if (room.phase === 'pickType') scheduleTurnTimer(ioSrv, room);
}

function advanceCard(ioSrv: Server, room: InternalRoom) {
  clearTurnTimer(room);
  room.truthAnswer = null;
  room.truthAdvanceAt = null;
  const cur = room.deck[room.currentCardIndex];
  if (cur) {
    const nt = normalizeDeckText(cur.text);
    room.deckRecentTexts.push(nt);
    if (room.deckRecentTexts.length > 32) {
      room.deckRecentTexts.splice(0, room.deckRecentTexts.length - 32);
    }
  }
  room.deckRecentIndices.push(room.currentCardIndex);
  if (room.deckRecentIndices.length > 16) {
    room.deckRecentIndices.splice(0, room.deckRecentIndices.length - 16);
  }
  room.currentCardIndex += 1;

  if (room.currentCardIndex >= room.deck.length) {
    room.phase = 'finished';
    emitRoomState(ioSrv, room);
    maybePartyMoment(ioSrv, room, 0.4);
    return;
  }

  emitRoomState(ioSrv, room);
  scheduleTurnTimer(ioSrv, room);
}

/** Must bind 0.0.0.0 in Docker / Railway or the proxy cannot reach the process. */
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Truth or Dare server listening on 0.0.0.0:${PORT}`);
});
