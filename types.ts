
export enum GamePhase {
  PICKING = 'PICKING',
  DRAWING = 'DRAWING',
  GUESSING = 'GUESSING',
  LOBBY = 'LOBBY'
}

export interface Player {
  id: string;
  name: string;
  score: number;
  isHost: boolean;
  isGuesser: boolean;
  hasFinishedDrawing: boolean;
  drawingOrder: number; // 0 means not finished
  drawingData: string | null; // base64 image data
  socketId?: string; // Socket.io ID for disconnection tracking
}

export interface GameState {
  roomId: string;
  phase: GamePhase;
  players: Player[];
  currentWord: string | null;
  guesserId: string | null;
  winnerId: string | null;
  revealOrder: number; // Current index in the drawing sequence being guessed
  selectableWords: string[] | null;
  isBoardLocked: boolean;
}

export interface SocketEvent {
  type: string;
  payload: any;
  senderId: string;
}
