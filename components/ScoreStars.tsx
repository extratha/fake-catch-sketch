
import React from 'react';
import { Star } from 'lucide-react';
import { MAX_STARS } from '../constants';

interface ScoreStarsProps {
  score: number;
}

const ScoreStars: React.FC<ScoreStarsProps> = ({ score }) => {
  return (
    <div className="flex gap-1 justify-center py-2 bg-slate-800/50 rounded-t-lg border-b border-slate-700">
      {Array.from({ length: MAX_STARS }).map((_, i) => (
        <Star
          key={i}
          size={16}
          className={`${
            i < score ? 'fill-yellow-400 text-yellow-400' : 'text-slate-600'
          } transition-all duration-300`}
        />
      ))}
    </div>
  );
};

export default ScoreStars;
