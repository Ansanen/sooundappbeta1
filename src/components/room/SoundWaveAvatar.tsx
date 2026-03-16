import React, { useRef, useEffect } from 'react';
import { cn } from '../../lib/utils';

interface SoundWaveAvatarProps {
  trackId: string;
  trackTitle: string;
  cover?: string;
  isPlaying: boolean;
  className?: string;
}

function hashString(str: string): number[] {
  const bytes: number[] = [];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    bytes.push(Math.abs(hash % 256));
  }
  while (bytes.length < 32) {
    hash = ((hash << 5) - hash + bytes.length) | 0;
    bytes.push(Math.abs(hash % 256));
  }
  return bytes;
}

export const SoundWaveAvatar: React.FC<SoundWaveAvatarProps> = ({
  trackId,
  trackTitle,
  cover,
  isPlaying,
  className,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = 400;
    canvas.width = size;
    canvas.height = size;
    ctx.clearRect(0, 0, size, size);

    const seed = hashString(trackId + trackTitle);
    const cx = size / 2;
    const cy = size / 2;

    const colors = [
      'rgba(255,255,255,',
      'rgba(147,197,253,',
      'rgba(196,181,253,',
      'rgba(249,168,212,',
      'rgba(165,180,252,',
    ];

    // Draw 5-8 ring segments
    const ringCount = 5 + (seed[0] % 4);
    for (let i = 0; i < ringCount; i++) {
      const s = seed[i * 3 % seed.length];
      const s2 = seed[(i * 3 + 1) % seed.length];
      const s3 = seed[(i * 3 + 2) % seed.length];

      const radius = 40 + (s / 255) * 120;
      const arcLen = (60 + (s2 / 255) * 240) * (Math.PI / 180);
      const rotOffset = (s3 / 255) * Math.PI * 2;
      const color = colors[i % colors.length];
      const opacity = 0.3 + (s / 255) * 0.5;
      const lineWidth = 1 + (s2 / 255) * 2;

      ctx.beginPath();
      ctx.arc(cx, cy, radius, rotOffset, rotOffset + arcLen);
      ctx.strokeStyle = color + opacity + ')';
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Draw 3-5 dots
    const dotCount = 3 + (seed[10] % 3);
    for (let i = 0; i < dotCount; i++) {
      const s = seed[(i * 4 + 12) % seed.length];
      const s2 = seed[(i * 4 + 13) % seed.length];
      const angle = (s / 255) * Math.PI * 2;
      const r = 40 + (s2 / 255) * 120;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;

      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.4 + (s / 255) * 0.4})`;
      ctx.fill();
    }

    // Draw 1-2 connecting lines
    const lineCount = 1 + (seed[20] % 2);
    for (let i = 0; i < lineCount; i++) {
      const a1 = (seed[21 + i * 2] / 255) * Math.PI * 2;
      const r1 = 40 + (seed[22 + i * 2] / 255) * 120;
      const a2 = (seed[23 + i * 2] / 255) * Math.PI * 2;
      const r2 = 40 + (seed[24 + i * 2] / 255) * 120;

      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1);
      ctx.lineTo(cx + Math.cos(a2) * r2, cy + Math.sin(a2) * r2);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }, [trackId, trackTitle]);

  return (
    <div
      className={cn(
        'w-[75vw] max-w-[340px] aspect-square rounded-3xl overflow-hidden ring-1 ring-white/10 shadow-2xl relative flex-shrink-0',
        isPlaying && 'shadow-[0_0_60px_rgba(255,255,255,0.08)]',
        className,
      )}
      style={isPlaying ? { animation: 'sound-wave-pulse 4s ease-in-out infinite' } : undefined}
    >
      {/* Base layer */}
      {cover ? (
        <img
          src={cover}
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-60"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="absolute inset-0 bg-white/5" />
      )}

      {/* Generative overlay */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={isPlaying ? { animation: 'sound-wave-rotate 20s linear infinite' } : undefined}
      >
        <canvas
          ref={canvasRef}
          className="w-full h-full"
        />
      </div>

      {/* Liquid glass overlay — inner highlight */}
      <div className="absolute inset-0 pointer-events-none rounded-3xl"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, transparent 50%, rgba(255,255,255,0.03) 100%)',
          boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.1)',
        }}
      />
    </div>
  );
};
