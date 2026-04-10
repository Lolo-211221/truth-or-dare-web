export type GameMode = 'sharedDeck' | 'pickAndWrite' | 'neverHaveIEver' | 'mostLikelyTo';

export type TruthDarePlayStyle = 'truthOnly' | 'dareOnly' | 'mixed';

export type MltDeckSource = 'builtin' | 'custom' | 'mixed';

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

export interface PublicDeckCard {
  kind: CardKind;
  text: string;
}

export interface SpotCard {
  kind: CardKind;
  text: string;
}

export interface Player {
  id: string;
  name: string;
}

export type ReactionCategory = 'funny' | 'savage' | 'chaotic';

export type MostLikelyCategory = 'funny' | 'college' | 'chaotic' | 'spicy';

export interface TeamInfo {
  id: string;
  name: string;
}

export interface VoteSessionState {
  id: string;
  question: string;
  candidateIds: string[];
  mode: 'players' | 'teams';
  allowSelfVote: boolean;
  revealed: boolean;
  voteCount: number;
  tallies?: Record<string, number>;
  votes?: Record<string, string>;
  youVoted: boolean;
}

export interface PartyMomentPayload {
  id: string;
  category: ReactionCategory;
  title: string;
  imageUrl: string;
  sound: 'tick' | 'drum' | 'airhorn';
  shake?: boolean;
  confetti?: boolean;
}

export interface RoomSettings {
  truthsPerPlayer: number;
  daresPerPlayer: number;
  truthAnswerDisplayMs: number;
  authorPromptMs: number;
  pickCycles: number;
  turnTimerSeconds: number;
  turnTimerCustomSeconds: number;
  teamsEnabled: boolean;
  preventSelfVoteDefault: boolean;
  mostLikelyCategory: MostLikelyCategory;
  truthDarePlayStyle: TruthDarePlayStyle;
  mltDeckSource: MltDeckSource;
}

export interface RoomState {
  roomCode: string;
  phase: Phase;
  players: Player[];
  hostId: string;
  submittedPlayerIds: string[];
  deck: PublicDeckCard[];
  currentCardIndex: number;
  activePlayerId: string | null;
  truthAnswer: string | null;
  truthAdvanceAt: number | null;
  gameMode: GameMode;
  subjectPlayerId: string | null;
  authorPlayerId: string | null;
  pickedKind: CardKind | null;
  authorDeadlineAt: number | null;
  spotCard: SpotCard | null;
  pickAuthorRound: number;
  settings: RoomSettings;
  roomLocked: boolean;
  turnEndsAt: number | null;
  teams: TeamInfo[];
  playerTeamId: Record<string, string>;
  teamScores: Record<string, number>;
  teamRevealActive: boolean;
  voteSession: VoteSessionState | null;
  deckRecentIndices: number[];
}

export const MAX_CARD_TEXT_LENGTH = 200;
export const MAX_PLAYERS_PER_ROOM = 20;
export const MAX_PLAYER_NAME_LENGTH = 24;
export const ROOM_CODE_LENGTH = 6;
export const MAX_TEAM_NAME_LENGTH = 32;
