import type { TwoTruthsLieState, TwoTruthsLieUiStep } from './sharedTypes.js';

export interface TwoTruthsLieInternal {
  roundIndex: number;
  hotSeatPlayerId: string;
  step: TwoTruthsLieUiStep;
  statements: [string, string, string] | null;
  lieIndex: number | null;
  votes: Map<string, number>;
  drinkers: string[];
  wrongGuessers: string[];
  allVotersCorrect: boolean;
}

export function initTwoTruthsLie(playerOrder: string[]): TwoTruthsLieInternal | null {
  if (playerOrder.length < 2) return null;
  return {
    roundIndex: 0,
    hotSeatPlayerId: playerOrder[0]!,
    step: 'entering',
    statements: null,
    lieIndex: null,
    votes: new Map(),
    drinkers: [],
    wrongGuessers: [],
    allVotersCorrect: false,
  };
}

export function ttlAdvanceHotSeat(internal: TwoTruthsLieInternal, playerOrder: string[]) {
  internal.roundIndex += 1;
  internal.statements = null;
  internal.lieIndex = null;
  internal.votes.clear();
  internal.drinkers = [];
  internal.wrongGuessers = [];
  internal.allVotersCorrect = false;
  internal.step = 'entering';
  if (internal.roundIndex >= playerOrder.length) {
    return 'done';
  }
  internal.hotSeatPlayerId = playerOrder[internal.roundIndex]!;
  return 'continue';
}

export function ttlComputeReveal(internal: TwoTruthsLieInternal, playerOrder: string[]): void {
  const hot = internal.hotSeatPlayerId;
  const lie = internal.lieIndex;
  if (lie == null || !internal.statements) return;

  const voters = playerOrder.filter((id) => id !== hot);
  const wrongGuessers: string[] = [];
  let allCorrect = voters.length > 0;
  let allWrong = voters.length > 0;

  for (const v of voters) {
    const choice = internal.votes.get(v);
    if (choice === undefined) {
      allCorrect = false;
      allWrong = false;
      continue;
    }
    if (choice !== lie) {
      wrongGuessers.push(v);
      allCorrect = false;
    }
    if (choice === lie) {
      allWrong = false;
    }
  }

  internal.wrongGuessers = wrongGuessers;
  internal.allVotersCorrect = allCorrect;

  const drinkers = [...wrongGuessers];
  if (allCorrect && voters.length > 0) {
    drinkers.push(hot);
  }
  internal.drinkers = drinkers;
}

export function ttlToPublic(
  internal: TwoTruthsLieInternal,
  playerOrder: string[],
  forSocketId: string | undefined,
): TwoTruthsLieState {
  const hot = internal.hotSeatPlayerId;
  const voters = playerOrder.filter((id) => id !== hot);
  const step = internal.step;

  let statements: [string, string, string] | null = null;
  if (step === 'entering') {
    if (forSocketId === hot) {
      statements = internal.statements ?? ['', '', ''];
    } else {
      statements = null;
    }
  } else {
    statements = internal.statements;
  }

  return {
    hotSeatPlayerId: hot,
    roundNumber: internal.roundIndex + 1,
    totalRounds: playerOrder.length,
    uiStep: step,
    statements,
    lieIndex: internal.step === 'reveal' ? internal.lieIndex : null,
    votesReceived: internal.votes.size,
    votesExpected: voters.length,
    drinkers: internal.step === 'reveal' ? [...internal.drinkers] : [],
    wrongGuessers: internal.step === 'reveal' ? [...internal.wrongGuessers] : [],
    allVotersCorrect: internal.step === 'reveal' && internal.allVotersCorrect,
    youVoted: forSocketId ? internal.votes.has(forSocketId) : false,
  };
}
