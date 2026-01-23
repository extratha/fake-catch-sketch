
import React, { useRef, useEffect, useState, useCallback } from 'react';

interface CanvasProps {
  onSave: (dataUrl: string) => void;
  disabled: boolean;
  color?: string;
  lineWidth?: number;
}

const Canvas: React.FC<CanvasProps> = ({ onSave, disabled, color = "#f8fafc", lineWidth = 4 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set initial canvas background
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const getPos = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if (disabled) return;
    setIsDrawing(true);
    lastPos.current = getPos(e);
  };

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || disabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const currentPos = getPos(e);

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(currentPos.x, currentPos.y);
    ctx.stroke();

    lastPos.current = currentPos;
  }, [isDrawing, disabled, color, lineWidth]);

  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false);
      const canvas = canvasRef.current;
      if (canvas) {
        onSave(canvas.toDataURL());
      }
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    onSave(canvas.toDataURL());
  };

  return (
    <div className="relative w-full aspect-[4/3] bg-slate-800 rounded-lg overflow-hidden border-2 border-slate-700">
      <canvas
        ref={canvasRef}
        width={800}
        height={600}
        className={`w-full h-full cursor-crosshair ${disabled ? 'opacity-80' : ''}`}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
      />
      {!disabled && (
        <button
          onClick={clearCanvas}
          className="absolute top-2 right-2 px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded transition-colors"
        >
          Clear
        </button>
      )}
      {disabled && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/20 pointer-events-none">
          <span className="bg-slate-900/80 px-4 py-2 rounded-full border border-slate-700 text-sm font-semibold">
            Canvas Locked
          </span>
        </div>
      )}
    </div>
  );
};

export default Canvas;
