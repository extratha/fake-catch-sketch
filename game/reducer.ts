import { GamePhase, GameState, Player } from '../types';
import { WORD_LIST } from '../constants';

// Intents a client may send. The server attaches the sender's playerId from its own session,
// so a client can never act on behalf of someone else.
export type ClientIntent =
  | { type: 'START_ROUND' }
  | { type: 'SELECT_WORD'; index: number }
  | { type: 'REROLL_WORD' }
  // inputDelayMs: time between the pointer event and the emit on the client (main-thread jank)
  | { type: 'FINISH_DRAWING'; inputDelayMs?: number }
  | { type: 'GUESS'; correct: boolean }
  // Host controls for when the game would otherwise wait forever
  | { type: 'SKIP_ROUND' }
  | { type: 'FORCE_FINISH'; targetId: string };

export type GameAction =
  | (Exclude<ClientIntent, { type: 'FINISH_DRAWING' | 'FORCE_FINISH' }> & { playerId: string })
  // pressedAt: server-clock press time, already latency-compensated by the server
  | { type: 'FINISH_DRAWING'; playerId: string; pressedAt: number }
  | { type: 'FORCE_FINISH'; playerId: string; targetId: string; pressedAt: number }
  | { type: 'JOIN'; playerId: string; name: string; socketId: string }
  | { type: 'DISCONNECT'; playerId: string; socketId: string };

export type ReduceResult = { ok: true; state: GameState; error?: never } | { ok: false; error: string; state?: never };

const MAX_NAME_LENGTH = 15;

export const createInitialState = (roomId: string): GameState => ({
  roomId,
  phase: GamePhase.LOBBY,
  players: [],
  currentWord: null,
  guesserId: null,
  winnerId: null,
  revealOrder: 0,
  selectableWords: null,
  isBoardLocked: false,
  round: 0,
  notice: null
});

// Order in which drawings are revealed: finished drawings by press time, then unfinished ones.
// Used both for rendering the guessing grid and for awarding points, so they can never disagree.
export const revealSequence = (players: Player[]): Player[] =>
  players
    .filter(p => !p.isGuesser)
    .sort((a, b) => {
      if (a.hasFinishedDrawing && b.hasFinishedDrawing) return a.finishedAt! - b.finishedAt!;
      if (a.hasFinishedDrawing) return -1;
      if (b.hasFinishedDrawing) return 1;
      return 0;
    });

// Strict ranking by press time (1, 2, 3, ...) — there are no ties, however close the presses are.
const rankFinishers = (players: Player[]): Player[] => {
  const finished = players.filter(p => p.hasFinishedDrawing).sort((a, b) => a.finishedAt! - b.finishedAt!);
  const ranks = new Map(finished.map((p, i) => [p.id, i + 1]));
  return players.map(p => (ranks.has(p.id) ? { ...p, drawingOrder: ranks.get(p.id)! } : p));
};

// 3 points for the first drawing revealed, 2 for the second, 1 afterwards — for both guesser and drawer
export const pointsForReveal = (revealOrder: number) => Math.max(1, 3 - revealOrder);

const ok = (state: GameState): ReduceResult => ({ ok: true, state });
const fail = (error: string): ReduceResult => ({ ok: false, error });

const pickWords = (count: number, rng: () => number): string[] => {
  const picked: string[] = [];
  while (picked.length < count) {
    const w = WORD_LIST[Math.floor(rng() * WORD_LIST.length)];
    if (!picked.includes(w)) picked.push(w);
  }
  return picked;
};

const resetDrawing = (p: Player): Player => ({ ...p, hasFinishedDrawing: false, drawingOrder: 0, finishedAt: null });

const isRoundUndecided = (state: GameState) =>
  state.phase === GamePhase.PICKING ||
  state.phase === GamePhase.DRAWING ||
  (state.phase === GamePhase.GUESSING && !state.winnerId);

// Back to the lobby with scores kept. guesserId is kept so the next round rotates past this guesser.
const cancelRound = (state: GameState, notice: string): GameState => ({
  ...state,
  phase: GamePhase.LOBBY,
  players: state.players.map(p => ({ ...resetDrawing(p), isGuesser: false })),
  currentWord: null,
  winnerId: null,
  revealOrder: 0,
  selectableWords: null,
  isBoardLocked: false,
  round: state.round + 1,
  notice
});

// Marks a drawer as done at the given press time and re-ranks everyone
const finishDrawer = (state: GameState, drawerId: string, pressedAt: number): GameState => {
  // On an exactly equal press time, whoever reached the server first stays ahead
  while (state.players.some(p => p.hasFinishedDrawing && p.finishedAt === pressedAt)) {
    pressedAt += 1e-6;
  }

  // Ranks are recomputed from press times on every finish, so a press that happened earlier
  // but arrived later (slow network) still ranks ahead. GUESSING only starts once every
  // connected drawer has pressed, so all presses are in before the order is used.
  const players = rankFinishers(
    state.players.map(p => (p.id === drawerId ? { ...p, hasFinishedDrawing: true, finishedAt: pressedAt } : p))
  );
  return settleDrawing({ ...state, players });
};

const migrateHostIfNeeded = (players: Player[]): Player[] => {
  if (players.some(p => p.isHost && p.isConnected)) return players;
  const nextHost = players.find(p => p.isConnected);
  if (!nextHost) return players;
  return players.map(p => ({ ...p, isHost: p.id === nextHost.id }));
};

// After a drawer finishes or leaves: move to GUESSING when every connected drawer is done,
// otherwise lock the board once enough players have finished.
const settleDrawing = (state: GameState): GameState => {
  if (state.phase !== GamePhase.DRAWING) return state;

  const drawers = state.players.filter(p => !p.isGuesser);
  const connectedDrawers = drawers.filter(p => p.isConnected);
  const finishedCount = drawers.filter(p => p.hasFinishedDrawing).length;

  if (connectedDrawers.every(p => p.hasFinishedDrawing)) {
    return { ...state, phase: GamePhase.GUESSING };
  }

  // Normally the board locks once the second drawer finishes. With only 2 drawers (≤3 players)
  // that would never lock, letting the last drawer take as long as they like — so lock after the first.
  const activeCount = state.players.filter(p => p.isConnected).length;
  const lockAfter = activeCount <= 3 ? 0 : 1;
  if (finishedCount > lockAfter && !state.isBoardLocked) {
    return { ...state, isBoardLocked: true };
  }
  return state;
};

export const reduce = (state: GameState, action: GameAction, rng: () => number = Math.random): ReduceResult => {
  const actor = state.players.find(p => p.id === action.playerId);

  switch (action.type) {
    case 'JOIN': {
      const name = action.name.trim().slice(0, MAX_NAME_LENGTH);
      if (!action.playerId || !name) return fail('Missing player id or name');

      if (actor) {
        const players = state.players.map(p =>
          p.id === actor.id ? { ...p, name, socketId: action.socketId, isConnected: true } : p
        );
        return ok({ ...state, players: migrateHostIfNeeded(players) });
      }

      const newPlayer: Player = {
        id: action.playerId,
        name,
        score: 0,
        isHost: state.players.length === 0,
        isGuesser: false,
        hasFinishedDrawing: false,
        drawingOrder: 0,
        finishedAt: null,
        socketId: action.socketId,
        isConnected: true
      };
      return ok({ ...state, players: migrateHostIfNeeded([...state.players, newPlayer]) });
    }

    case 'DISCONNECT': {
      // Ignore stale disconnects from an old socket after the player already reconnected
      if (!actor || actor.socketId !== action.socketId) return ok(state);
      const players = migrateHostIfNeeded(state.players.map(p => (p.id === actor.id ? { ...p, isConnected: false } : p)));

      // Nobody else can pick, reroll or judge, so the round can't continue without the guesser
      if (actor.id === state.guesserId && isRoundUndecided(state)) {
        return ok(cancelRound({ ...state, players }, `${actor.name} (the guesser) left — round cancelled`));
      }
      return ok(settleDrawing({ ...state, players }));
    }

    case 'START_ROUND': {
      if (!actor?.isHost) return fail('Only the host can start a round');
      const roundOver = state.phase === GamePhase.GUESSING && !!state.winnerId;
      if (state.phase !== GamePhase.LOBBY && !roundOver) return fail('A round is already in progress');

      const candidates = [...state.players].filter(p => p.isConnected).sort((a, b) => a.id.localeCompare(b.id));
      if (candidates.length < 2) return fail('Need at least 2 players');

      // Rotate to the next connected player after the previous guesser
      const nextGuesser =
        candidates.find(p => state.guesserId !== null && p.id.localeCompare(state.guesserId) > 0) ?? candidates[0];

      return ok({
        ...state,
        phase: GamePhase.PICKING,
        players: state.players.map(p => ({ ...resetDrawing(p), isGuesser: p.id === nextGuesser.id })),
        guesserId: nextGuesser.id,
        currentWord: null,
        winnerId: null,
        revealOrder: 0,
        selectableWords: pickWords(3, rng),
        isBoardLocked: false,
        round: state.round + 1,
        notice: null
      });
    }

    case 'SKIP_ROUND': {
      if (!actor?.isHost) return fail('Only the host can skip a round');
      if (!isRoundUndecided(state)) return fail('No round in progress');
      return ok(cancelRound(state, `${actor.name} skipped the round`));
    }

    case 'FORCE_FINISH': {
      if (!actor?.isHost) return fail('Only the host can force a player to finish');
      if (state.phase !== GamePhase.DRAWING) return fail('Not drawing right now');
      // Only once the board is locked, so the host can't cut off players who are still allowed to draw
      if (!state.isBoardLocked) return fail('The board is not locked yet');
      const target = state.players.find(p => p.id === action.targetId);
      if (!target || target.isGuesser || target.hasFinishedDrawing) return fail('That player has nothing to finish');
      return ok(finishDrawer(state, target.id, action.pressedAt));
    }

    case 'SELECT_WORD': {
      if (state.phase !== GamePhase.PICKING) return fail('Not picking a word right now');
      if (action.playerId !== state.guesserId) return fail('Only the guesser can pick the word');
      const word = state.selectableWords?.[action.index];
      if (!word) return fail('Invalid word choice');
      return ok({ ...state, phase: GamePhase.DRAWING, currentWord: word, selectableWords: null });
    }

    case 'REROLL_WORD': {
      if (state.phase !== GamePhase.DRAWING) return fail('Not drawing right now');
      if (action.playerId !== state.guesserId) return fail('Only the guesser can reroll the word');

      let newWord = WORD_LIST[Math.floor(rng() * WORD_LIST.length)];
      while (newWord === state.currentWord) {
        newWord = WORD_LIST[Math.floor(rng() * WORD_LIST.length)];
      }
      return ok({
        ...state,
        currentWord: newWord,
        players: state.players.map(resetDrawing),
        isBoardLocked: false,
        revealOrder: 0,
        round: state.round + 1
      });
    }

    case 'FINISH_DRAWING': {
      if (state.phase !== GamePhase.DRAWING) return fail('Not drawing right now');
      if (!actor || actor.isGuesser) return fail('Only drawers can finish drawing');
      if (actor.hasFinishedDrawing) return fail('Already finished');
      return ok(finishDrawer(state, actor.id, action.pressedAt));
    }

    case 'GUESS': {
      if (state.phase !== GamePhase.GUESSING) return fail('Not guessing right now');
      if (action.playerId !== state.guesserId) return fail('Only the guesser can guess');
      if (state.winnerId) return fail('Round already decided');

      const sequence = revealSequence(state.players);

      if (action.correct) {
        const drawer = sequence[state.revealOrder];
        const points = pointsForReveal(state.revealOrder);
        return ok({
          ...state,
          players: state.players.map(p =>
            p.id === state.guesserId || p.id === drawer?.id ? { ...p, score: p.score + points } : p
          ),
          winnerId: state.guesserId
        });
      }

      if (state.revealOrder < sequence.length - 1) {
        return ok({ ...state, revealOrder: state.revealOrder + 1 });
      }
      return ok({ ...state, winnerId: 'NONE' });
    }
  }
};
