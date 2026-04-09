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

export interface RoomSettings {
  truthsPerPlayer: number;
  daresPerPlayer: number;
  truthAnswerDisplayMs: number;
  authorPromptMs: number;
  pickCycles: number;
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
}

export const MAX_CARD_TEXT_LENGTH = 200;
export const MAX_PLAYERS_PER_ROOM = 20;
export const MAX_PLAYER_NAME_LENGTH = 24;
export const ROOM_CODE_LENGTH = 6;
