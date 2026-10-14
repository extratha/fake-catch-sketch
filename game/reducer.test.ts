import { describe, it, expect } from 'vitest';
import { reduce, createInitialState, revealSequence, GameAction } from './reducer';
import { GamePhase, GameState } from '../types';

// Deterministic sequence so word picking terminates and is reproducible
let seed = 0;
const rng = () => (seed = (seed + 0.137) % 1);

const apply = (state: GameState, ...actions: GameAction[]): GameState =>
  actions.reduce((s, action) => {
    const result = reduce(s, action, rng);
    if (!result.ok) throw new Error(`${action.type} rejected: ${result.error}`);
    return result.state;
  }, state);

const join = (playerId: string): GameAction => ({ type: 'JOIN', playerId, name: playerId.toUpperCase(), socketId: `sock-${playerId}` });

const roomWith = (...ids: string[]) => apply(createInitialState('room'), ...ids.map(join));

// Room in DRAWING phase; with ids sorted, the first id becomes the guesser
const drawingRoom = (...ids: string[]) =>
  apply(roomWith(...ids), { type: 'START_ROUND', playerId: ids[0] }, { type: 'SELECT_WORD', playerId: ids[0], index: 0 });

// Presses are 100ms apart by default unless a time is given
let clock = 0;
const finish = (playerId: string, pressedAt = (clock += 100)): GameAction => ({ type: 'FINISH_DRAWING', playerId, pressedAt });

const score = (state: GameState, id: string) => state.players.find(p => p.id === id)!.score;

describe('JOIN', () => {
  it('makes the first player host and keeps others as non-host', () => {
    const state = roomWith('a', 'b');
    expect(state.players.map(p => p.isHost)).toEqual([true, false]);
  });

  it('reconnects an existing player instead of duplicating them', () => {
    const state = apply(roomWith('a'), { type: 'JOIN', playerId: 'a', name: 'A2', socketId: 'new-sock' });
    expect(state.players).toHaveLength(1);
    expect(state.players[0]).toMatchObject({ name: 'A2', socketId: 'new-sock', isConnected: true });
  });

  it('rejects joins without a player id', () => {
    expect(reduce(createInitialState('room'), { type: 'JOIN', playerId: '', name: 'x', socketId: 's' }).ok).toBe(false);
  });
});

describe('permissions', () => {
  it('only the host can start a round', () => {
    expect(reduce(roomWith('a', 'b'), { type: 'START_ROUND', playerId: 'b' }).ok).toBe(false);
  });

  it('only the guesser can pick the word', () => {
    const state = apply(roomWith('a', 'b'), { type: 'START_ROUND', playerId: 'a' });
    expect(state.guesserId).toBe('a');
    expect(reduce(state, { type: 'SELECT_WORD', playerId: 'b', index: 0 }).ok).toBe(false);
  });

  it('only the guesser can guess', () => {
    const state = apply(drawingRoom('a', 'b'), finish('b'));
    expect(state.phase).toBe(GamePhase.GUESSING);
    expect(reduce(state, { type: 'GUESS', playerId: 'b', correct: true }).ok).toBe(false);
  });
});

describe('FINISH_DRAWING', () => {
  it('rejects a second finish from the same player (spamming has no effect)', () => {
    const state = apply(drawingRoom('a', 'b', 'c'), finish('b'));
    expect(reduce(state, finish('b')).ok).toBe(false);
  });

  it('records finish order and locks the board after the first finish with 3 players', () => {
    const state = apply(drawingRoom('a', 'b', 'c'), finish('c'));
    expect(state.isBoardLocked).toBe(true);
    expect(state.players.find(p => p.id === 'c')!.drawingOrder).toBe(1);
    expect(state.round).toBe(1);
    expect(state.phase).toBe(GamePhase.DRAWING);
  });

  it('locks the board only after the second finish with 4+ players', () => {
    const one = apply(drawingRoom('a', 'b', 'c', 'd'), finish('b'));
    expect(one.isBoardLocked).toBe(false);
    expect(apply(one, finish('c')).isBoardLocked).toBe(true);
  });

  it('moves to GUESSING when every connected drawer has finished', () => {
    const state = apply(drawingRoom('a', 'b', 'c'), finish('c'), finish('b'));
    expect(state.phase).toBe(GamePhase.GUESSING);
    expect(revealSequence(state.players).map(p => p.id)).toEqual(['c', 'b']);
  });

  it('moves to GUESSING when the last unfinished drawer disconnects', () => {
    const state = apply(drawingRoom('a', 'b', 'c'), finish('b'), { type: 'DISCONNECT', playerId: 'c', socketId: 'sock-c' });
    expect(state.phase).toBe(GamePhase.GUESSING);
  });

  it('does not mutate the previous state', () => {
    const before = drawingRoom('a', 'b', 'c');
    const snapshot = JSON.stringify(before);
    apply(before, finish('b'));
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('press-time ordering', () => {
  it('ranks by press time, not by arrival order (slow network pressed first)', () => {
    // c's message arrives first but b pressed 30ms earlier
    const state = apply(drawingRoom('a', 'b', 'c', 'd'), finish('c', 1000), finish('b', 970), finish('d', 1200));
    expect(revealSequence(state.players).map(p => p.id)).toEqual(['b', 'c', 'd']);
    expect(state.players.map(p => p.drawingOrder)).toEqual([0, 1, 2, 3]);
  });

  it('distinguishes presses less than 1ms apart — there are no ties', () => {
    const state = apply(drawingRoom('a', 'b', 'c', 'd'), finish('c', 1000.4), finish('b', 1000), finish('d', 1000.9));
    expect(revealSequence(state.players).map(p => p.id)).toEqual(['b', 'c', 'd']);
    expect(new Set(state.players.filter(p => p.hasFinishedDrawing).map(p => p.drawingOrder)).size).toBe(3);
  });

  it('breaks an exactly equal press time in favour of whoever arrived first', () => {
    const state = apply(drawingRoom('a', 'b', 'c', 'd'), finish('c', 1000), finish('b', 1000));
    expect(revealSequence(state.players).map(p => p.id).slice(0, 2)).toEqual(['c', 'b']);
    expect(state.players.find(p => p.id === 'c')!.drawingOrder).toBe(1);
    expect(state.players.find(p => p.id === 'b')!.drawingOrder).toBe(2);
  });

  it('awards points by reveal position even for near-simultaneous presses', () => {
    const state = apply(drawingRoom('a', 'b', 'c'), finish('b', 1000), finish('c', 1003),
      { type: 'GUESS', playerId: 'a', correct: false }, { type: 'GUESS', playerId: 'a', correct: true });
    expect([score(state, 'b'), score(state, 'c')]).toEqual([0, 2]);
  });
});

describe('GUESS scoring', () => {
  it('awards 3 points to guesser and first drawer on a first-reveal correct guess', () => {
    const state = apply(drawingRoom('a', 'b', 'c'), finish('c'), finish('b'), { type: 'GUESS', playerId: 'a', correct: true });
    expect([score(state, 'a'), score(state, 'b'), score(state, 'c')]).toEqual([3, 0, 3]);
    expect(state.winnerId).toBe('a');
  });

  it('awards the drawer actually shown when an unfinished drawer exists', () => {
    // b and c finish, d disconnects without finishing → reveal order is b, c, d
    let state = apply(drawingRoom('a', 'b', 'c', 'd', 'e'), finish('b'), finish('c'), finish('e'),
      { type: 'DISCONNECT', playerId: 'd', socketId: 'sock-d' });
    expect(state.phase).toBe(GamePhase.GUESSING);
    expect(revealSequence(state.players).map(p => p.id)).toEqual(['b', 'c', 'e', 'd']);

    state = apply(state, { type: 'GUESS', playerId: 'a', correct: false }, { type: 'GUESS', playerId: 'a', correct: true });
    // Second reveal (c) is worth 2 points; the unfinished d gets nothing
    expect([score(state, 'a'), score(state, 'b'), score(state, 'c'), score(state, 'd')]).toEqual([2, 0, 2, 0]);
  });

  it('ends the round with no winner after every drawing is rejected', () => {
    const state = apply(drawingRoom('a', 'b', 'c'), finish('b'), finish('c'),
      { type: 'GUESS', playerId: 'a', correct: false }, { type: 'GUESS', playerId: 'a', correct: false });
    expect(state.winnerId).toBe('NONE');
    expect(reduce(state, { type: 'GUESS', playerId: 'a', correct: true }).ok).toBe(false);
  });
});

describe('rounds and connections', () => {
  it('rotates the guesser and skips disconnected players', () => {
    let state = apply(drawingRoom('a', 'b', 'c'), finish('b'), finish('c'), { type: 'GUESS', playerId: 'a', correct: true });
    state = apply(state, { type: 'DISCONNECT', playerId: 'b', socketId: 'sock-b' }, { type: 'START_ROUND', playerId: 'a' });
    expect(state.guesserId).toBe('c');
    expect(state.players.every(p => !p.hasFinishedDrawing && p.finishedAt === null)).toBe(true);
  });

  it('migrates host when the host disconnects', () => {
    const state = apply(roomWith('a', 'b'), { type: 'DISCONNECT', playerId: 'a', socketId: 'sock-a' });
    expect(state.players.find(p => p.isHost)!.id).toBe('b');
  });

  it('ignores a stale disconnect from an old socket after reconnecting', () => {
    const state = apply(roomWith('a', 'b'),
      { type: 'JOIN', playerId: 'a', name: 'A', socketId: 'sock-a-2' },
      { type: 'DISCONNECT', playerId: 'a', socketId: 'sock-a' });
    expect(state.players.find(p => p.id === 'a')!.isConnected).toBe(true);
  });

  it('reroll clears drawings and unlocks the board', () => {
    const state = apply(drawingRoom('a', 'b', 'c'), finish('b'), { type: 'REROLL_WORD', playerId: 'a' });
    expect(state.isBoardLocked).toBe(false);
    expect(state.players.every(p => !p.hasFinishedDrawing)).toBe(true);
    // New round id so clients drop drawings from before the reroll
    expect(state.round).toBe(2);
  });
});

describe('guesser leaving', () => {
  const dc = (playerId: string): GameAction => ({ type: 'DISCONNECT', playerId, socketId: `sock-${playerId}` });

  it.each([
    ['PICKING', (s: GameState) => s],
    ['DRAWING', (s: GameState) => apply(s, { type: 'SELECT_WORD', playerId: 'a', index: 0 })],
    ['GUESSING', (s: GameState) => apply(s, { type: 'SELECT_WORD', playerId: 'a', index: 0 }, finish('b'), finish('c'))],
  ])('cancels the round back to the lobby during %s, keeping scores', (_, advance) => {
    const scored = apply(roomWith('a', 'b', 'c'), { type: 'START_ROUND', playerId: 'a' });
    const before = advance({ ...scored, players: scored.players.map(p => ({ ...p, score: 5 })) });
    const state = apply(before, dc('a'));
    expect(state.phase).toBe(GamePhase.LOBBY);
    expect(state.notice).toMatch(/left/);
    expect(state.players.every(p => p.score === 5 && !p.isGuesser && !p.hasFinishedDrawing)).toBe(true);
    expect(state.round).toBe(before.round + 1);
    // Host moved to b; the next round rotates past the departed guesser
    expect(apply(state, { type: 'START_ROUND', playerId: 'b' }).guesserId).toBe('b');
  });

  it('does not cancel a round that was already decided', () => {
    const decided = apply(drawingRoom('a', 'b', 'c'), finish('b'), finish('c'), { type: 'GUESS', playerId: 'a', correct: true });
    const state = apply(decided, dc('a'));
    expect(state.phase).toBe(GamePhase.GUESSING);
    expect(state.notice).toBeNull();
  });
});

describe('host controls', () => {
  it('lets only the host skip a round in progress', () => {
    const state = drawingRoom('a', 'b', 'c');
    expect(reduce(state, { type: 'SKIP_ROUND', playerId: 'b' }).ok).toBe(false);
    const skipped = apply(state, { type: 'SKIP_ROUND', playerId: 'a' });
    expect(skipped.phase).toBe(GamePhase.LOBBY);
    expect(skipped.notice).toMatch(/skipped/);
    expect(reduce(skipped, { type: 'SKIP_ROUND', playerId: 'a' }).ok).toBe(false);
  });

  it('clears the notice when the next round starts', () => {
    const skipped = apply(drawingRoom('a', 'b', 'c'), { type: 'SKIP_ROUND', playerId: 'a' });
    expect(apply(skipped, { type: 'START_ROUND', playerId: 'a' }).notice).toBeNull();
  });

  it('only allows forcing a player done once the board is locked', () => {
    const force = (targetId: string, pressedAt = 5000): GameAction => ({ type: 'FORCE_FINISH', playerId: 'a', targetId, pressedAt });
    const unlocked = drawingRoom('a', 'b', 'c', 'd');
    expect(reduce(unlocked, force('b')).ok).toBe(false);

    const locked = apply(unlocked, finish('b', 1000), finish('c', 1100));
    expect(locked.isBoardLocked).toBe(true);
    expect(reduce(locked, { type: 'FORCE_FINISH', playerId: 'b', targetId: 'd', pressedAt: 5000 }).ok).toBe(false);
    expect(reduce(locked, force('b')).ok).toBe(false);

    const state = apply(locked, force('d'));
    expect(state.phase).toBe(GamePhase.GUESSING);
    expect(revealSequence(state.players).map(p => p.id)).toEqual(['b', 'c', 'd']);
  });
});
