import type { KingsCupState } from './sharedTypes.js';

export type KingsCupUiStep = KingsCupState['uiStep'];

export interface KingsCupInternal {
  remaining: { rank: string; suit: string; isX: boolean }[];
  turnIndex: number;
  uiStep: KingsCupUiStep;
  faceUp: { rank: string; suit: string; isX: boolean } | null;
  drawerId: string | null;
  activeRule: string | null;
  activeRuleSetterId: string | null;
  queenCurse: { queenId: string; cursedId: string } | null;
  drinkingBuddy: { a: string; b: string } | null;
  heavenEndsAt: number | null;
  heavenTaps: Map<string, number>;
  heavenTimer: ReturnType<typeof setTimeout> | null;
  driveStep: number;
  driveEndsAt: number | null;
  driveTaps: Map<string, number>;
  driveTimer: ReturnType<typeof setTimeout> | null;
  pickKind: '2' | '8' | 'Q' | null;
  kingRuleSetterId: string | null;
  lastPenaltyPlayerId: string | null;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildKingsCupDeck(): { rank: string; suit: string; isX: boolean }[] {
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const out: { rank: string; suit: string; isX: boolean }[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      out.push({ rank, suit, isX: false });
    }
  }
  out.push({ rank: 'X', suit: '', isX: true });
  return shuffle(out);
}

export function emptyKingsCupInternal(): KingsCupInternal {
  return {
    remaining: [],
    turnIndex: 0,
    uiStep: 'waitingDraw',
    faceUp: null,
    drawerId: null,
    activeRule: null,
    activeRuleSetterId: null,
    queenCurse: null,
    drinkingBuddy: null,
    heavenEndsAt: null,
    heavenTaps: new Map(),
    heavenTimer: null,
    driveStep: 0,
    driveEndsAt: null,
    driveTaps: new Map(),
    driveTimer: null,
    pickKind: null,
    kingRuleSetterId: null,
    lastPenaltyPlayerId: null,
  };
}

export function initKingsCupInternal(): KingsCupInternal {
  const k = emptyKingsCupInternal();
  k.remaining = buildKingsCupDeck();
  k.uiStep = 'waitingDraw';
  return k;
}

export function clearKingsCupTimers(k: KingsCupInternal | null) {
  if (!k) return;
  if (k.heavenTimer) {
    clearTimeout(k.heavenTimer);
    k.heavenTimer = null;
  }
  if (k.driveTimer) {
    clearTimeout(k.driveTimer);
    k.driveTimer = null;
  }
}

export function kcToPublic(room: {
  playerOrder: string[];
  kingsCup: KingsCupInternal | null;
}): KingsCupState | null {
  if (!room.kingsCup) return null;
  const k = room.kingsCup;
  const n = room.playerOrder.length;
  const currentTurnPlayerId = n > 0 ? room.playerOrder[k.turnIndex % n]! : '';
  const heavenTaps: Record<string, number> = {};
  for (const [a, b] of k.heavenTaps) heavenTaps[a] = b;
  const driveTaps: Record<string, number> = {};
  for (const [a, b] of k.driveTaps) driveTaps[a] = b;
  return {
    cardsRemaining: k.remaining.length,
    currentTurnPlayerId,
    uiStep: k.uiStep,
    faceUpCard: k.faceUp,
    drawerId: k.drawerId,
    activeRule: k.activeRule,
    activeRuleSetterId: k.activeRuleSetterId,
    queenCurse: k.queenCurse,
    drinkingBuddy: k.drinkingBuddy ? { aId: k.drinkingBuddy.a, bId: k.drinkingBuddy.b } : null,
    heavenEndsAt: k.heavenEndsAt,
    heavenTaps,
    driveStep: k.driveStep,
    driveEndsAt: k.driveEndsAt,
    driveTaps,
    pickPlayerFor: k.pickKind,
    kingRuleSetterId: k.kingRuleSetterId,
    lastPenaltyPlayerId: k.lastPenaltyPlayerId,
  };
}

export function currentKingsTurnPlayerId(playerOrder: string[], turnIndex: number): string | null {
  if (playerOrder.length === 0) return null;
  return playerOrder[turnIndex % playerOrder.length]!;
}

/** After resolving a card, move to next player. */
export function advanceKingsTurn(k: KingsCupInternal, playerCount: number) {
  k.turnIndex = (k.turnIndex + 1) % Math.max(1, playerCount);
  k.uiStep = 'waitingDraw';
  k.faceUp = null;
  k.drawerId = null;
  k.pickKind = null;
  k.kingRuleSetterId = null;
  k.heavenEndsAt = null;
  k.heavenTaps.clear();
  k.driveStep = 0;
  k.driveEndsAt = null;
  k.driveTaps.clear();
  clearKingsCupTimers(k);
}

export function rankKey(card: { rank: string; isX: boolean }): string {
  if (card.isX) return 'X';
  return card.rank;
}
