
import React, { useState } from 'react';
import { X, CheckCircle, HelpCircle, Pencil } from 'lucide-react';
import { Player } from '../types';

interface GuessingGridProps {
  players: Player[];
  currentRevealIndex: number; // Order index currently being shown
  isGuesser: boolean;
  onClose: () => void;
  onNextRound: () => void;
  onCorrect: () => void;
  onIncorrect: () => void;
  isGameOver: boolean;
  word: string;
  myId: string;
}

const GuessingGrid: React.FC<GuessingGridProps> = ({
  players,
  currentRevealIndex,
  isGuesser,
  onClose,
  onNextRound,
  onCorrect,
  onIncorrect,
  isGameOver,
  word,
  myId
}) => {
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);

  // Filter out the guesser and sort: Finished first (by order), then unfinished
  const drawers = players
    .filter(p => !p.isGuesser)
    .sort((a, b) => {
      if (a.hasFinishedDrawing && b.hasFinishedDrawing) return a.drawingOrder - b.drawingOrder;
      if (a.hasFinishedDrawing) return -1;
      if (b.hasFinishedDrawing) return 1;
      return 0;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 sm:p-8">
      <div className="relative w-full max-w-6xl h-full flex flex-col bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-slate-800 bg-slate-900/50">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <HelpCircle className="text-purple-400" />
              Guessing Time!
            </h2>
            <p className="text-slate-400 text-sm">
              {isGameOver
                ? `Round Finished. The word was "${word}"`
                : `Revealing drawing #${currentRevealIndex + 1} of ${drawers.length}`}
            </p>
          </div>
          <X className="text-white cursor-pointer" onClick={onClose} />
        </div>

        {/* Grid Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {drawers.map((player, idx) => {
              const isRevealed = idx <= currentRevealIndex || isGameOver;
              const isCurrent = idx === currentRevealIndex && !isGameOver;

              return (
                <div
                  key={player.id}
                  className={`group relative aspect-[4/3] rounded-xl overflow-hidden border-2 transition-all duration-500 ${isRevealed
                    ? 'border-blue-500/50 shadow-lg shadow-blue-500/10 scale-100'
                    : 'border-slate-800 bg-slate-800 grayscale scale-95 opacity-50'
                    } ${isCurrent ? 'ring-4 ring-yellow-400 ring-offset-4 ring-offset-slate-900' : ''}`}
                >
                  {isRevealed ? (
                    <>
                      {player.drawingData ? (
                        <img
                          src={player.drawingData}
                          alt={`Drawing by ${player.name}`}
                          className="w-full h-full object-cover cursor-zoom-in"
                          onClick={() => setFullscreenImage(player.drawingData)}
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-slate-800 text-slate-500">
                          <Pencil size={40} className="mb-2 opacity-20" />
                          <p className="text-xs font-black uppercase tracking-tighter">No Sketch</p>
                        </div>
                      )}
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-slate-950/80 to-transparent p-3">
                        <p className="text-sm font-bold text-white flex items-center justify-between">
                          <span>{player.name}</span>
                          <span className="text-xs bg-blue-600 px-2 py-0.5 rounded-full">#{idx + 1}</span>
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-600">
                      <div className="w-16 h-16 bg-slate-700/50 rounded-full flex items-center justify-center mb-2">
                        <HelpCircle size={32} />
                      </div>
                      <p className="text-xs font-bold uppercase tracking-widest">Locked</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer Controls */}
        <div className="p-6 border-t border-slate-800 bg-slate-900/80 backdrop-blur-sm">
          {isGuesser && !isGameOver ? (
            <div className="flex flex-col items-center gap-4">
              <p className="text-yellow-400 font-bold animate-pulse text-lg">Are you ready to guess?</p>
              <div className="flex gap-4 w-full max-w-md">
                <button
                  onClick={onIncorrect}
                  className="flex-1 py-4 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl transition-all active:scale-95 shadow-lg border-b-4 border-slate-800"
                >
                  INCORRECT
                </button>
                <button
                  onClick={onCorrect}
                  className="flex-1 py-4 bg-green-500 hover:bg-green-400 text-white font-bold rounded-xl transition-all active:scale-95 shadow-lg shadow-green-500/20 border-b-4 border-green-700"
                >
                  CORRECT!
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center">
              {isGameOver && players.find(p => p.id === myId)?.isHost ? (
                <button
                  onClick={onNextRound}
                  className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all shadow-lg"
                >
                  Close & Continue
                </button>
              ) : isGameOver ? (
                <p className="text-slate-400 italic">Waiting for the host to restart the game</p>
              ) : (
                <p className="text-slate-400 italic">Waiting for the guesser to decide...</p>
              )}
            </div>
          )}
        </div>

        {/* Fullscreen Overlay */}
        {fullscreenImage && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 p-4 cursor-zoom-out"
            onClick={() => setFullscreenImage(null)}
          >
            <img src={fullscreenImage} className="max-w-full max-h-full rounded-lg shadow-2xl" alt="Full size drawing" />
          </div>
        )}
      </div>
    </div>
  );
};

export default GuessingGrid;
