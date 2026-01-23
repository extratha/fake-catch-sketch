
import React, { useRef, useEffect, useState, useCallback } from 'react';

interface CanvasProps {
  onSave: (dataUrl: string) => void;
  disabled: boolean;
  color?: string;
  lineWidth?: number;
}

const Canvas: React.FC<CanvasProps> = ({ onSave, disabled, color = "#f8fafc", lineWidth = 3 }) => {
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
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

    // Calculate scale factor between internal canvas size and display size
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if (disabled) return;
    if ('touches' in e && e.cancelable) e.preventDefault();
    setIsDrawing(true);
    lastPos.current = getPos(e);
  };

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || disabled) return;
    if ('touches' in e && e.cancelable) e.preventDefault();
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

  const pencilCursor = `url("data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8cGF0aCBkPSJNMTggMkwyMiA2TDcgMjFMMiAyMkwzIDE3TDE4IDJaIiBmaWxsPSIjRkFDQzE1IiBzdHJva2U9IiMxRTI5M0IiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+CiAgPHBhdGggZD0iTTE4IDJMMjIgNkwyMCA4TDE2IDRMMTggMloiIGZpbGw9IiNGREE0QUYiIHN0cm9rZT0iIzFFMjkzQiIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KICA8cGF0aCBkPSJNMiAyMkw1IDIxTDMgMTlMMiAyMloiIGZpbGw9IiM0NzU1NjkiLz4KPC9zdmc+") 2 22, crosshair`;

  return (
    <div className="relative w-full aspect-[4/3] bg-slate-800 rounded-lg overflow-hidden border-2 border-slate-700">
      <canvas
        ref={canvasRef}
        width={800}
        height={600}
        style={{
          cursor: disabled ? 'default' : pencilCursor,
          touchAction: 'none'
        }}
        className={`w-full h-full ${disabled ? 'opacity-80' : ''}`}
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
