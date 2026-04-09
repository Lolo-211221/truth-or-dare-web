export type GameMode = 'sharedDeck' | 'pickAndWrite' | 'neverHaveIEver' | 'mostLikelyTo';

export type Phase =
  | 'lobby'
  | 'writingCards'
  | 'shuffling'
  | 'turn'
  | 'pickType'
  | 'authorPrompt'
  | 'revealTurn'
  | 'finished';

export type CardKind = 'truth' | 'dare' | 'nhie' | 'mlt';

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

export type ReactionCategory = 'funny' | 'savage' | 'chaotic';

export type MostLikelyCategory = 'spicy' | 'dumb' | 'college' | 'embarrassing';

export interface TeamInfo {
  id: string;
  name: string;
}

/** Active secret vote (per-viewer fields filled server-side). */
export interface VoteSessionState {
  id: string;
  question: string;
  candidateIds: string[];
  /** Team mode: candidates are team ids */
  mode: 'players' | 'teams';
  allowSelfVote: boolean;
  revealed: boolean;
  /** How many players have voted (before reveal) */
  voteCount: number;
  /** After reveal */
  tallies?: Record<string, number>;
  /** After reveal: voterId -> candidateId */
  votes?: Record<string, string>;
  /** Current socket already cast a vote */
  youVoted: boolean;
}

export interface PartyMomentPayload {
  id: string;
  category: ReactionCategory;
  title: string;
  imageUrl: string;
  /** 'tick' | 'drum' | 'airhorn' — client maps to sounds */
  sound: 'tick' | 'drum' | 'airhorn';
  shake?: boolean;
  confetti?: boolean;
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
  /** 0 = off; otherwise seconds for pickType / turn / revealTurn action window */
  turnTimerSeconds: number;
  /** When > 0 and turnTimerSeconds is "custom", clamped 5–300 */
  turnTimerCustomSeconds: number;
  /** Split players into two teams; scoring & team votes when enabled */
  teamsEnabled: boolean;
  /** Default on for party votes; host can toggle per vote */
  preventSelfVoteDefault: boolean;
  /** Weighted random for built-in question picks (future packs / MLT) */
  mostLikelyCategory: MostLikelyCategory;
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

  /** Host can block new joins while in lobby */
  roomLocked: boolean;
  /** Optional per-turn wall clock; client shows countdown */
  turnEndsAt: number | null;

  teams: TeamInfo[];
  /** playerId -> teamId */
  playerTeamId: Record<string, string>;
  teamScores: Record<string, number>;
  /** Full-screen team splash before starting */
  teamRevealActive: boolean;

  voteSession: VoteSessionState | null;

  /** Recent card indices to reduce immediate repeats (shared deck) */
  deckRecentIndices: number[];
}

/** Defaults when creating a room; server may seed ms from env. */
export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  truthsPerPlayer: 2,
  daresPerPlayer: 2,
  truthAnswerDisplayMs: 10_000,
  authorPromptMs: 90_000,
  pickCycles: 1,
  turnTimerSeconds: 0,
  turnTimerCustomSeconds: 45,
  teamsEnabled: false,
  preventSelfVoteDefault: true,
  mostLikelyCategory: 'spicy',
};

export const MAX_CARD_TEXT_LENGTH = 200;
export const MAX_PLAYERS_PER_ROOM = 20;
export const MAX_PLAYER_NAME_LENGTH = 24;
export const ROOM_CODE_LENGTH = 6;
export const MAX_TEAM_NAME_LENGTH = 32;
