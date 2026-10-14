
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
  drawingOrder: number; // Rank among finishers by press time; 0 means not finished
  finishedAt: number | null; // Server-clock press time after latency compensation
  socketId?: string; // Socket.io ID for disconnection tracking
  isConnected: boolean;
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
  round: number; // Increments whenever drawings are reset; drawings are sent separately and tagged with it
  notice: string | null; // Why the last round was cancelled, shown in the lobby
}

export interface SocketEvent {
  type: string;
  payload: any;
  senderId: string;
}
