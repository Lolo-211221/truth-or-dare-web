export type GameMode = 'sharedDeck' | 'pickAndWrite';

export type Phase =
  | 'lobby'
  | 'writingCards'
  | 'shuffling'
  | 'turn'
  | 'pickType'
  | 'authorPrompt'
  | 'revealTurn'
  | 'finished';

export type CardKind = 'truth' | 'dare';

/** Shown to clients (no author) */
export interface PublicDeckCard {
  kind: CardKind;
  text: string;
}

/** Single prompt in pickAndWrite reveal phase */
export interface SpotCard {
  kind: CardKind;
  text: string;
}

export interface Player {
  id: string;
  name: string;
}

/** Host-adjustable before the game starts (lobby only). */
export interface RoomSettings {
  /** sharedDeck: truths each person writes */
  truthsPerPlayer: number;
  /** sharedDeck: dares each person writes */
  daresPerPlayer: number;
  /** How long a Truth answer stays on screen before the next card (ms) */
  truthAnswerDisplayMs: number;
  /** pickAndWrite: time for the random author to write the prompt (ms) */
  authorPromptMs: number;
  /** pickAndWrite: how many full passes through all players (each person gets a turn per pass) */
  pickCycles: number;
}

export interface RoomState {
  roomCode: string;
  phase: Phase;
  players: Player[];
  /** Socket id of host (for display); authority uses hostToken client-side */
  hostId: string;
  submittedPlayerIds: string[];
  /** sharedDeck: shuffled deck. pickAndWrite: usually empty during play */
  deck: PublicDeckCard[];
  currentCardIndex: number;
  /**
   * Who must answer the current card (sharedDeck `turn`, or pickAndWrite `revealTurn`).
   * pickAndWrite `pickType`: null (use subjectPlayerId). `authorPrompt`: null (use authorPlayerId).
   */
  activePlayerId: string | null;
  truthAnswer: string | null;
  truthAdvanceAt: number | null;

  gameMode: GameMode;
  /** pickAndWrite: whose turn it is to choose Truth/Dare and then answer */
  subjectPlayerId: string | null;
  /** pickAndWrite: randomly chosen player who writes the prompt */
  authorPlayerId: string | null;
  pickedKind: CardKind | null;
  /** Unix ms deadline for the author to submit */
  authorDeadlineAt: number | null;
  spotCard: SpotCard | null;
  /** pickAndWrite: 0-based turn counter */
  pickAuthorRound: number;
  settings: RoomSettings;
}

/** Defaults when creating a room; server may seed ms from env. */
export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  truthsPerPlayer: 2,
  daresPerPlayer: 2,
  truthAnswerDisplayMs: 10_000,
  authorPromptMs: 90_000,
  pickCycles: 1,
};

export const MAX_CARD_TEXT_LENGTH = 200;
export const MAX_PLAYERS_PER_ROOM = 20;
export const MAX_PLAYER_NAME_LENGTH = 24;
export const ROOM_CODE_LENGTH = 6;
