
import React from 'react';
import { User, Crown, Eye } from 'lucide-react';
import { Player } from '../types';

interface PlayerBoardProps {
  players: Player[];
  myId: string;
}

const PlayerBoard: React.FC<PlayerBoardProps> = ({ players, myId }) => {
  return (
    <div className="flex flex-col h-full bg-slate-800 rounded-xl border border-slate-700 shadow-xl overflow-hidden">
      <div className="p-4 border-b border-slate-700 bg-slate-800/50">
        <h3 className="font-bold text-lg flex items-center gap-2">
          <User size={20} className="text-blue-400" />
          Players ({players.length})
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {players.sort((a, b) => b.score - a.score).map((p) => (
          <div
            key={p.id}
            className={`flex items-center gap-3 p-3 rounded-lg transition-all ${p.id === myId ? 'bg-blue-600/20 ring-1 ring-blue-500/50' : 'bg-slate-700/50'
              }`}
          >
            <div className="relative">
              <div className="w-10 h-10 bg-slate-600 rounded-full flex items-center justify-center font-bold text-slate-200">
                {p.name.charAt(0).toUpperCase()}
              </div>
              {p.isHost && (
                <div className="absolute -top-1 -right-1 bg-yellow-500 rounded-full p-0.5 shadow-lg border border-slate-900">
                  <Crown size={12} className="text-white fill-white" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                <p className="font-medium  text-slate-200">
                  {p.name} {p.id === myId && <span className="text-sm text-blue-400 font-bold ml-1">(You)</span>}
                </p>
                {p.isGuesser && <Eye size={14} className="text-purple-400" />}
              </div>
              <p className="text-xs text-slate-400 font-semibold">{p.score} Stars</p>
            </div>
            {p.hasFinishedDrawing && (
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default PlayerBoard;
