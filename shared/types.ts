export type Phase = 'lobby' | 'writingCards' | 'shuffling' | 'turn' | 'finished';

export type CardKind = 'truth' | 'dare';

/** Shown to clients (no author) */
export interface PublicDeckCard {
  kind: CardKind;
  text: string;
}

export interface Player {
  id: string;
  name: string;
}

export interface RoomState {
  roomCode: string;
  phase: Phase;
  players: Player[];
  /** Socket id of host (for display); authority uses hostToken client-side */
  hostId: string;
  submittedPlayerIds: string[];
  /** Only in turn / after shuffle */
  deck: PublicDeckCard[];
  currentCardIndex: number;
  /** Player who must act this card */
  activePlayerId: string | null;
  /** After a Truth is answered, shown until next card */
  truthAnswer: string | null;
}

export const TRUTHS_PER_PLAYER = 2;
export const DARES_PER_PLAYER = 2;
export const MAX_CARD_TEXT_LENGTH = 200;
export const MAX_PLAYERS_PER_ROOM = 20;
export const MAX_PLAYER_NAME_LENGTH = 24;
export const ROOM_CODE_LENGTH = 6;
