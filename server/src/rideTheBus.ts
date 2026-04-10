import type { RideTheBusCardFace, RideTheBusState, RideTheBusUiStep } from './sharedTypes.js';

export type PlayingCard = { rank: string; suit: string };

const SUITS = ['♥', '♦', '♣', '♠'] as const;
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

export function buildStandardDeck(): PlayingCard[] {
  const out: PlayingCard[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      out.push({ rank, suit });
    }
  }
  return out;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function rankValue(rank: string): number {
  const order = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const i = order.indexOf(rank);
  return i >= 0 ? i : 0;
}

export function isRedSuit(suit: string): boolean {
  return suit === '♥' || suit === '♦';
}

export interface RideTheBusInternal {
  drawPile: PlayingCard[];
  discardPile: PlayingCard[];
  attemptCards: PlayingCard[];
  hotSeatPlayerId: string;
  completed: Set<string>;
  uiStep: RideTheBusUiStep;
  wrongMessage: string | null;
  /** Set when uiStep === 'roundWin' — who just survived */
  lastRoundSurvivorId: string | null;
}

export function initRideTheBus(playerOrder: string[]): RideTheBusInternal | null {
  if (playerOrder.length < 2) return null;
  const deck = shuffle(buildStandardDeck());
  const hot = playerOrder[0]!;
  return {
    drawPile: deck,
    discardPile: [],
    attemptCards: [],
    hotSeatPlayerId: hot,
    completed: new Set(),
    uiStep: 'awaitFlip',
    wrongMessage: null,
    lastRoundSurvivorId: null,
  };
}

function ensureDrawPile(r: RideTheBusInternal) {
  if (r.drawPile.length > 0) return;
  if (r.discardPile.length === 0) {
    r.drawPile = shuffle(buildStandardDeck());
    return;
  }
  r.drawPile = shuffle(r.discardPile);
  r.discardPile = [];
}

function drawOne(r: RideTheBusInternal): PlayingCard | null {
  ensureDrawPile(r);
  return r.drawPile.pop() ?? null;
}

export function rtbFlip(r: RideTheBusInternal): { ok: true } | { ok: false; error: string } {
  if (r.uiStep !== 'awaitFlip') {
    return { ok: false, error: 'Cannot flip now.' };
  }
  const card = drawOne(r);
  if (!card) return { ok: false, error: 'Deck error.' };
  r.attemptCards.push(card);
  r.uiStep = 'awaitGuess';
  r.wrongMessage = null;
  return { ok: true };
}

export type RtbGuess =
  | { kind: 'color'; color: 'red' | 'black' }
  | { kind: 'hilo'; hilo: 'higher' | 'lower' | 'same' }
  | { kind: 'inout'; inout: 'inside' | 'outside' }
  | { kind: 'suit'; suit: '♥' | '♦' | '♣' | '♠' };

function evalColor(card: PlayingCard, g: RtbGuess): boolean {
  if (g.kind !== 'color') return false;
  const red = isRedSuit(card.suit);
  return g.color === 'red' ? red : !red;
}

function evalHiLo(c0: PlayingCard, c1: PlayingCard, g: RtbGuess): boolean {
  if (g.kind !== 'hilo') return false;
  const v0 = rankValue(c0.rank);
  const v1 = rankValue(c1.rank);
  if (v1 > v0) return g.hilo === 'higher';
  if (v1 < v0) return g.hilo === 'lower';
  return g.hilo === 'same';
}

function evalInOut(c0: PlayingCard, c1: PlayingCard, c2: PlayingCard, g: RtbGuess): boolean {
  if (g.kind !== 'inout') return false;
  const v0 = rankValue(c0.rank);
  const v1 = rankValue(c1.rank);
  const v2 = rankValue(c2.rank);
  const low = Math.min(v0, v1);
  const high = Math.max(v0, v1);
  const inside = v2 > low && v2 < high;
  const outside = v2 <= low || v2 >= high;
  if (g.inout === 'inside') return inside;
  return outside;
}

function evalSuit(card: PlayingCard, g: RtbGuess): boolean {
  if (g.kind !== 'suit') return false;
  return card.suit === g.suit;
}

export function rtbEvaluateGuess(
  r: RideTheBusInternal,
  guess: RtbGuess,
): { ok: true; correct: boolean } | { ok: false; error: string } {
  if (r.uiStep !== 'awaitGuess') return { ok: false, error: 'Not guessing now.' };
  const n = r.attemptCards.length;
  if (n < 1 || n > 4) return { ok: false, error: 'Bad card state.' };
  const q = n - 1;
  const cards = r.attemptCards;
  let correct = false;
  if (q === 0) {
    correct = evalColor(cards[0]!, guess);
  } else if (q === 1) {
    correct = evalHiLo(cards[0]!, cards[1]!, guess);
  } else if (q === 2) {
    correct = evalInOut(cards[0]!, cards[1]!, cards[2]!, guess);
  } else {
    correct = evalSuit(cards[3]!, guess);
  }
  return { ok: true, correct };
}

export function rtbApplyCorrect(r: RideTheBusInternal, playerOrder: string[]): 'continue' | 'roundComplete' {
  const n = r.attemptCards.length;
  if (n === 4) {
    return 'roundComplete';
  }
  r.uiStep = 'awaitFlip';
  return 'continue';
}

export function rtbApplyWrong(r: RideTheBusInternal): void {
  for (const c of r.attemptCards) {
    r.discardPile.push(c);
  }
  r.attemptCards = [];
  r.uiStep = 'wrong';
  r.wrongMessage = 'Wrong — take a drink and start over from question 1.';
}

export function rtbCompleteRound(r: RideTheBusInternal, playerOrder: string[]): 'nextPlayer' | 'gameComplete' {
  const survivor = r.hotSeatPlayerId;
  r.completed.add(survivor);
  r.attemptCards = [];
  r.discardPile = [];
  r.drawPile = shuffle(buildStandardDeck());
  r.wrongMessage = null;
  if (r.completed.size >= playerOrder.length) {
    r.lastRoundSurvivorId = survivor;
    return 'gameComplete';
  }
  const next = playerOrder.find((id) => !r.completed.has(id));
  if (!next) {
    r.lastRoundSurvivorId = survivor;
    return 'gameComplete';
  }
  r.lastRoundSurvivorId = survivor;
  r.hotSeatPlayerId = next;
  r.uiStep = 'roundWin';
  return 'nextPlayer';
}

export function rtbAckWrong(r: RideTheBusInternal): void {
  if (r.uiStep !== 'wrong') return;
  r.uiStep = 'awaitFlip';
  r.wrongMessage = null;
}

export function rtbAckRoundWin(r: RideTheBusInternal): void {
  if (r.uiStep !== 'roundWin') return;
  r.uiStep = 'awaitFlip';
  r.lastRoundSurvivorId = null;
}

export function cardToFace(c: PlayingCard): RideTheBusCardFace {
  return { rank: c.rank, suit: c.suit };
}

export function rtbToPublic(
  r: RideTheBusInternal,
  playerOrder: string[],
): RideTheBusState {
  const last = r.attemptCards[r.attemptCards.length - 1];
  const qIdx =
    r.uiStep === 'roundWin'
      ? 0
      : r.uiStep === 'awaitGuess'
        ? Math.max(0, r.attemptCards.length - 1)
        : Math.max(0, r.attemptCards.length - 1);
  const q1 =
    r.uiStep === 'roundWin'
      ? 1
      : r.uiStep === 'awaitGuess'
        ? r.attemptCards.length
        : Math.min(4, r.attemptCards.length + 1);
  return {
    hotSeatPlayerId: r.hotSeatPlayerId,
    completedPlayerIds: playerOrder.filter((id) => r.completed.has(id)),
    questionIndex: qIdx,
    currentQuestion1Based: q1,
    cardsThisRound: r.attemptCards.map(cardToFace),
    faceUpCard: last ? cardToFace(last) : null,
    uiStep: r.uiStep,
    cardsRemaining: r.drawPile.length,
    wrongMessage: r.wrongMessage,
    totalPlayers: playerOrder.length,
    lastRoundSurvivorId: r.lastRoundSurvivorId,
  };
}
