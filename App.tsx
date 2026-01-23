
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { WORD_LIST, MAX_STARS } from './constants';
import { GamePhase, GameState, Player } from './types';
import MockSocket from './services/mockSocket';
import ScoreStars from './components/ScoreStars';
import PlayerBoard from './components/PlayerBoard';
import Canvas from './components/Canvas';
import GuessingGrid from './components/GuessingGrid';
import { Pencil, Trophy, Send, Users, LogOut, Info } from 'lucide-react';

// Utils
const generateId = () => Math.random().toString(36).substring(2, 9);

const App: React.FC = () => {
  // Persistence
  const [userId] = useState(() => {
    const saved = localStorage.getItem('sketch_userId');
    if (saved) return saved;
    const fresh = generateId();
    localStorage.setItem('sketch_userId', fresh);
    return fresh;
  });

  const [userName, setUserName] = useState(() => localStorage.getItem('sketch_userName') || '');
  const [showNameModal, setShowNameModal] = useState(!userName);

  // Router State
  const [roomPath, setRoomPath] = useState(() => window.location.hash.replace('#/rooms/', '') || '');

  // Game State
  const [gameState, setGameState] = useState<GameState>({
    roomId: '',
    phase: GamePhase.LOBBY,
    players: [],
    currentWord: null,
    guesserId: null,
    winnerId: null,
    revealOrder: 0
  });

  const [currentDrawing, setCurrentDrawing] = useState<string | null>(null);
  const [randomWords, setRandomWords] = useState<string[]>([]);

  // Socket setup
  const socket = useMemo(() => new MockSocket(userId), [userId]);

  // Sync logic (In real app, this would be handled by a server emitting to rooms)
  const syncState = useCallback((newState: GameState) => {
    setGameState(newState);
    socket.emit('state_update', newState);
  }, [socket]);

  useEffect(() => {
    socket.on('state_update', (receivedState: GameState) => {
      setGameState(receivedState);
    });

    socket.on('player_joined', (player: Player) => {
      setGameState(prev => {
        if (prev.players.find(p => p.id === player.id)) return prev;
        const updated = { ...prev, players: [...prev.players, player] };
        return updated;
      });
    });

    // Handle initial routing if hash changes
    const handleHash = () => {
      const hash = window.location.hash.replace('#/rooms/', '');
      setRoomPath(hash);
      if (hash && !userName) setShowNameModal(true);
    };

    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, [socket, userName]);

  // Actions
  const handleSetName = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setUserName(trimmed);
    localStorage.setItem('sketch_userName', trimmed);
    setShowNameModal(false);

    // If we're already in a room join sequence
    if (roomPath) {
      joinRoom(roomPath, trimmed);
    }
  };

  const createRoom = () => {
    if (!userName) return setShowNameModal(true);
    const newRoomId = generateId();
    const host: Player = {
      id: userId,
      name: userName,
      score: 0,
      isHost: true,
      isGuesser: false,
      hasFinishedDrawing: false,
      drawingOrder: 0,
      drawingData: null
    };
    const newState: GameState = {
      roomId: newRoomId,
      phase: GamePhase.LOBBY,
      players: [host],
      currentWord: null,
      guesserId: null,
      winnerId: null,
      revealOrder: 0
    };
    setGameState(newState);
    setRoomPath(newRoomId);
    window.location.hash = `#/rooms/${newRoomId}`;
    socket.emit('state_update', newState);
  };

  const joinRoom = (rId: string, name: string) => {
    const newPlayer: Player = {
      id: userId,
      name,
      score: 0,
      isHost: false,
      isGuesser: false,
      hasFinishedDrawing: false,
      drawingOrder: 0,
      drawingData: null
    };
    socket.emit('player_joined', newPlayer);
    setRoomPath(rId);
    window.location.hash = `#/rooms/${rId}`;
  };

  const startGame = () => {
    const players = [...gameState.players];
    // Pick guesser - if it's the first time, pick host, otherwise pick next
    let guesserIdx = players.findIndex(p => p.id === gameState.guesserId);
    guesserIdx = (guesserIdx + 1) % players.length;
    
    const updatedPlayers = players.map((p, idx) => ({
      ...p,
      isGuesser: idx === guesserIdx,
      hasFinishedDrawing: false,
      drawingOrder: 0,
      drawingData: null
    }));

    syncState({
      ...gameState,
      phase: GamePhase.PICKING,
      players: updatedPlayers,
      guesserId: updatedPlayers[guesserIdx].id,
      currentWord: null,
      revealOrder: 0
    });

    // Generate random words
    const picked: string[] = [];
    while (picked.length < 3) {
      const w = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
      if (!picked.includes(w)) picked.push(w);
    }
    setRandomWords(picked);
  };

  const selectWord = (word: string) => {
    syncState({
      ...gameState,
      phase: GamePhase.DRAWING,
      currentWord: word
    });
  };

  const finishDrawing = () => {
    const players = [...gameState.players];
    const finishedCount = players.filter(p => p.hasFinishedDrawing).length;
    const myIdx = players.findIndex(p => p.id === userId);
    
    if (myIdx === -1) return;

    players[myIdx].hasFinishedDrawing = true;
    players[myIdx].drawingOrder = finishedCount + 1;
    players[myIdx].drawingData = currentDrawing;

    // Check if everyone except guesser is done
    const totalDrawers = players.filter(p => !p.isGuesser).length;
    const everyoneDone = players.filter(p => p.hasFinishedDrawing).length >= totalDrawers;

    syncState({
      ...gameState,
      phase: everyoneDone ? GamePhase.GUESSING : GamePhase.DRAWING,
      players
    });
  };

  const handleGuess = (correct: boolean) => {
    if (correct) {
      // Points logic
      // RevealOrder is the index (0, 1, 2...)
      // points = 3 if revealedOrder = 0
      // points = 2 if revealedOrder = 1
      // points = 1 if revealedOrder >= 2
      const points = Math.max(1, 3 - gameState.revealOrder);
      const players = [...gameState.players];
      
      // Give points to guesser
      const gIdx = players.findIndex(p => p.id === gameState.guesserId);
      if (gIdx !== -1) players[gIdx].score += points;

      // Give points to the drawer currently revealed
      const currentDrawer = players
        .filter(p => !p.isGuesser)
        .sort((a, b) => a.drawingOrder - b.drawingOrder)[gameState.revealOrder];
      
      if (currentDrawer) {
        const dIdx = players.findIndex(p => p.id === currentDrawer.id);
        if (dIdx !== -1) players[dIdx].score += points;
      }

      syncState({
        ...gameState,
        players,
        winnerId: gameState.guesserId,
        phase: GamePhase.GUESSING, // Stay here to show the winner dialog
        revealOrder: gameState.revealOrder // Keep index
      });
      // A small delay or wait for "Next Round" click is better
    } else {
      // Next reveal or Game Over
      const drawersCount = gameState.players.filter(p => !p.isGuesser).length;
      if (gameState.revealOrder < drawersCount - 1) {
        syncState({
          ...gameState,
          revealOrder: gameState.revealOrder + 1
        });
      } else {
        // All revealed, no one guessed
        syncState({
          ...gameState,
          winnerId: 'NONE'
        });
      }
    }
  };

  const nextRound = () => {
    startGame();
  };

  const leaveRoom = () => {
    const players = gameState.players.filter(p => p.id !== userId);
    // Host migration
    if (players.length > 0 && gameState.players.find(p => p.id === userId)?.isHost) {
      players[0].isHost = true;
    }
    syncState({ ...gameState, players });
    setRoomPath('');
    window.location.hash = '';
  };

  // UI Components
  if (!roomPath) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-blue-900/20 via-slate-900 to-slate-950">
        <div className="w-full max-w-md bg-slate-800 rounded-3xl p-8 border border-slate-700 shadow-2xl space-y-8">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-500 rounded-2xl mb-4 rotate-3 shadow-lg shadow-blue-500/20">
              <Pencil size={40} className="text-white -rotate-12" />
            </div>
            <h1 className="text-4xl font-black text-white tracking-tight">Cat Sketch</h1>
            <p className="text-slate-400 font-medium">Draw faster, guess better!</p>
          </div>

          <div className="space-y-4">
            <button 
              onClick={createRoom}
              className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-2xl transition-all active:scale-95 shadow-lg shadow-blue-600/20 border-b-4 border-blue-800"
            >
              CREATE NEW ROOM
            </button>
            <div className="relative">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-700"></span></div>
              <div className="relative flex justify-center text-xs uppercase"><span className="bg-slate-800 px-2 text-slate-500 font-bold">OR JOIN BY URL</span></div>
            </div>
            <p className="text-center text-sm text-slate-500">Share a link with friends to play together.</p>
          </div>

          <div className="pt-4 border-t border-slate-700/50 flex items-center justify-center gap-2 text-slate-400 text-sm">
            <Info size={16} />
            <span>Multiplayer requires sharing the URL.</span>
          </div>
        </div>

        {/* Name Modal */}
        {showNameModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-2xl">
              <h2 className="text-xl font-bold mb-4">What's your artist name?</h2>
              <input 
                type="text" 
                maxLength={15}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 text-white mb-6"
                placeholder="Enter name..."
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                autoFocus
              />
              <button 
                onClick={() => handleSetName(userName)}
                className="w-full py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-xl transition-all shadow-lg"
              >
                SAVE & CONTINUE
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Room View
  const me = gameState.players.find(p => p.id === userId);
  const totalStars = me?.score || 0;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="max-w-7xl mx-auto w-full flex flex-col md:flex-row justify-between items-center gap-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="bg-blue-600 p-2 rounded-lg rotate-3">
            <Pencil size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black">ROOM: {gameState.roomId}</h1>
            <p className="text-xs text-slate-500 uppercase font-bold tracking-widest flex items-center gap-1">
              <Users size={12} /> {gameState.players.length} Players
            </p>
          </div>
        </div>
        
        <div className="flex gap-2">
          <button 
            onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              alert('Link copied to clipboard!');
            }}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm font-bold border border-slate-700 transition-all"
          >
            <Send size={16} className="text-blue-400" />
            Copy Link
          </button>
          <button 
            onClick={leaveRoom}
            className="flex items-center gap-2 px-4 py-2 bg-red-900/20 hover:bg-red-900/40 text-red-400 rounded-lg text-sm font-bold border border-red-800/30 transition-all"
          >
            <LogOut size={16} />
            Leave
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto w-full flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Board Area */}
        <div className="lg:col-span-3 flex flex-col gap-4">
          <div className="bg-slate-800 rounded-xl overflow-hidden shadow-2xl border border-slate-700">
            <ScoreStars score={totalStars % MAX_STARS || (totalStars > 0 ? MAX_STARS : 0)} />
            
            <div className="relative">
              {gameState.phase === GamePhase.LOBBY && (
                <div className="aspect-[4/3] flex flex-col items-center justify-center bg-slate-900/50 p-8 text-center">
                  <div className="w-24 h-24 bg-blue-600/10 rounded-full flex items-center justify-center mb-6 border-4 border-dashed border-blue-500/30">
                    <Users size={40} className="text-blue-500" />
                  </div>
                  <h2 className="text-2xl font-bold mb-2">Welcome to the Lobby</h2>
                  <p className="text-slate-400 mb-8 max-w-md">Wait for more players to join or start the round if you're the host.</p>
                  
                  {me?.isHost ? (
                    <button 
                      onClick={startGame}
                      disabled={gameState.players.length < 2}
                      className={`px-12 py-4 rounded-2xl font-black text-xl transition-all shadow-xl ${
                        gameState.players.length < 2 
                          ? 'bg-slate-700 text-slate-500 cursor-not-allowed' 
                          : 'bg-green-600 hover:bg-green-500 text-white border-b-4 border-green-800 active:translate-y-1'
                      }`}
                    >
                      {gameState.players.length < 2 ? 'WAITING FOR PLAYERS...' : 'START ROUND!'}
                    </button>
                  ) : (
                    <p className="bg-blue-900/30 text-blue-400 px-6 py-3 rounded-full font-bold border border-blue-800/50">
                      WAITING FOR HOST TO START...
                    </p>
                  )}
                </div>
              )}

              {gameState.phase === GamePhase.PICKING && (
                <div className="aspect-[4/3] flex flex-col items-center justify-center bg-slate-900/50 p-8 text-center">
                  {me?.isGuesser ? (
                    <>
                      <h2 className="text-2xl font-black mb-6 flex items-center gap-3">
                        <span className="text-yellow-400">PICK A WORD</span>
                      </h2>
                      <div className="flex flex-wrap justify-center gap-4">
                        {randomWords.map((word) => (
                          <button
                            key={word}
                            onClick={() => selectWord(word)}
                            className="px-8 py-4 bg-slate-800 hover:bg-blue-600 text-white font-bold rounded-2xl border border-slate-700 hover:border-blue-400 transition-all shadow-lg text-lg capitalize"
                          >
                            {word}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="space-y-4">
                      <div className="animate-bounce">
                        <Users size={48} className="text-blue-500 mx-auto" />
                      </div>
                      <p className="text-xl font-bold text-slate-400">
                        Waiting for <span className="text-white">{gameState.players.find(p => p.isGuesser)?.name}</span> to pick a word...
                      </p>
                    </div>
                  )}
                </div>
              )}

              {gameState.phase === GamePhase.DRAWING && (
                <div className="p-4 bg-slate-900/50">
                  <div className="mb-4 flex justify-between items-center bg-slate-800 p-4 rounded-xl border border-slate-700">
                    <div>
                      <span className="text-xs font-bold text-slate-500 uppercase block">Topic to Draw</span>
                      <p className="text-2xl font-black text-yellow-400 capitalize">{gameState.currentWord}</p>
                    </div>
                    {me?.isGuesser ? (
                      <div className="text-right">
                        <span className="text-xs font-bold text-slate-500 uppercase block">Status</span>
                        <p className="text-blue-400 font-bold">You are Guessing!</p>
                      </div>
                    ) : (
                      <div className="text-right">
                         <span className="text-xs font-bold text-slate-500 uppercase block">Progress</span>
                         <p className="font-bold">{gameState.players.filter(p => p.hasFinishedDrawing).length} / {gameState.players.length - 1} Finished</p>
                      </div>
                    )}
                  </div>
                  
                  <Canvas 
                    disabled={me?.isGuesser || me?.hasFinishedDrawing || false} 
                    onSave={setCurrentDrawing} 
                  />

                  {!me?.isGuesser && !me?.hasFinishedDrawing && (
                    <div className="mt-4 flex justify-center">
                      <button 
                        onClick={finishDrawing}
                        className="px-12 py-4 bg-green-600 hover:bg-green-500 text-white font-black text-xl rounded-2xl shadow-lg shadow-green-600/20 transition-all border-b-4 border-green-800 active:translate-y-1"
                      >
                        I'M DONE!
                      </button>
                    </div>
                  )}
                  {me?.hasFinishedDrawing && !me.isGuesser && (
                    <div className="mt-4 text-center">
                      <p className="text-green-400 font-bold bg-green-400/10 px-6 py-3 rounded-full border border-green-500/30 inline-block">
                        Waiting for others to finish...
                      </p>
                    </div>
                  )}
                </div>
              )}

              {gameState.phase === GamePhase.GUESSING && (
                <GuessingGrid 
                  players={gameState.players}
                  currentRevealIndex={gameState.revealOrder}
                  isGuesser={userId === gameState.guesserId}
                  word={gameState.currentWord || ''}
                  onClose={nextRound}
                  onCorrect={() => handleGuess(true)}
                  onIncorrect={() => handleGuess(false)}
                  isGameOver={!!gameState.winnerId}
                />
              )}
            </div>
          </div>
        </div>

        {/* Player List */}
        <div className="lg:col-span-1 min-h-[400px]">
          <PlayerBoard players={gameState.players} myId={userId} />
        </div>
      </div>

      {/* Footer Info */}
      <div className="max-w-7xl mx-auto w-full mt-6 py-4 flex flex-col sm:flex-row justify-between items-center text-slate-500 text-xs font-bold gap-4">
        <p>&copy; 2024 CAT SKETCH MULTIPLAYER</p>
        <div className="flex gap-6">
          <span className="flex items-center gap-1"><Trophy size={14} className="text-yellow-500" /> Collect Stars</span>
          <span className="flex items-center gap-1"><Pencil size={14} className="text-blue-500" /> Draw Sequences</span>
        </div>
      </div>

      {/* Name Modal for rejoin/URL join */}
      {showNameModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-2xl">
            <h2 className="text-xl font-bold mb-4">Set your display name</h2>
            <input 
              type="text" 
              maxLength={15}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 text-white mb-6"
              placeholder="Artist Name..."
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              autoFocus
            />
            <button 
              onClick={() => handleSetName(userName)}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all shadow-lg"
            >
              START SKETCHING
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
