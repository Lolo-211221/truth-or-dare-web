export type GameMode =
  | 'sharedDeck'
  | 'pickAndWrite'
  | 'neverHaveIEver'
  | 'mostLikelyTo'
  | 'kingsCup'
  | 'rideTheBus'
  | 'twoTruthsLie';

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
  | 'kingsCup'
  | 'rideTheBus'
  | 'twoTruthsLie'
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

export type KingsCupUiStep =
  | 'waitingDraw'
  | 'cardFaceUp'
  | 'heaven'
  | 'drive'
  | 'pickPlayer'
  | 'kingRule';

export interface KingsCupCardFace {
  rank: string;
  suit: string;
  isX: boolean;
}

export interface KingsCupState {
  cardsRemaining: number;
  currentTurnPlayerId: string;
  uiStep: KingsCupUiStep;
  faceUpCard: KingsCupCardFace | null;
  drawerId: string | null;
  activeRule: string | null;
  activeRuleSetterId: string | null;
  queenCurse: { queenId: string; cursedId: string } | null;
  drinkingBuddy: { aId: string; bId: string } | null;
  heavenEndsAt: number | null;
  heavenTaps: Record<string, number>;
  driveStep: number;
  driveEndsAt: number | null;
  driveTaps: Record<string, number>;
  pickPlayerFor: '2' | '8' | 'Q' | null;
  kingRuleSetterId: string | null;
  lastPenaltyPlayerId: string | null;
}

export type RideTheBusUiStep = 'awaitFlip' | 'awaitGuess' | 'wrong' | 'roundWin';

export interface RideTheBusCardFace {
  rank: string;
  suit: string;
}

export interface RideTheBusState {
  hotSeatPlayerId: string;
  completedPlayerIds: string[];
  questionIndex: number;
  currentQuestion1Based: number;
  cardsThisRound: RideTheBusCardFace[];
  faceUpCard: RideTheBusCardFace | null;
  uiStep: RideTheBusUiStep;
  cardsRemaining: number;
  wrongMessage: string | null;
  totalPlayers: number;
  lastRoundSurvivorId: string | null;
}

export type TwoTruthsLieUiStep = 'entering' | 'voting' | 'reveal';

export interface TwoTruthsLieState {
  hotSeatPlayerId: string;
  roundNumber: number;
  totalRounds: number;
  uiStep: TwoTruthsLieUiStep;
  statements: [string, string, string] | null;
  lieIndex: number | null;
  votesReceived: number;
  votesExpected: number;
  drinkers: string[];
  wrongGuessers: string[];
  allVotersCorrect: boolean;
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
  kingsCup: KingsCupState | null;
  rideTheBus: RideTheBusState | null;
  twoTruthsLie: TwoTruthsLieState | null;
}

export const MAX_CARD_TEXT_LENGTH = 200;
export const MAX_PLAYERS_PER_ROOM = 20;
export const MAX_PLAYER_NAME_LENGTH = 24;
export const ROOM_CODE_LENGTH = 6;
export const MAX_TEAM_NAME_LENGTH = 32;
