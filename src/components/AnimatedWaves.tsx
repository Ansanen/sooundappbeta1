import React, { useEffect, useRef } from 'react';

interface AnimatedWavesProps {
  className?: string;
}

export const AnimatedWaves: React.FC<AnimatedWavesProps> = ({ className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    let w = 0, h = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
    };

    resize();
    window.addEventListener('resize', resize);

    // Generate flowing diagonal curves
    // Each line flows from top-left area to bottom-right
    // Two clusters: top-left corner and bottom-right corner
    const LINE_COUNT = 20;
    const lines = Array.from({ length: LINE_COUNT }, (_, i) => {
      const isTopLeft = i < LINE_COUNT / 2;
      const localIdx = isTopLeft ? i : i - LINE_COUNT / 2;
      const clusterSize = LINE_COUNT / 2;
      return {
        // Top-left cluster: offset -0.5 to 0.15, Bottom-right: 0.65 to 1.3
        offset: isTopLeft
          ? -0.5 + (localIdx / clusterSize) * 0.65
          : 0.65 + (localIdx / clusterSize) * 0.65,
        curvature: 0.15 + Math.random() * 0.25,
        wobble: 0.02 + Math.random() * 0.04,
        wobbleFreq: 1.5 + Math.random() * 2,
        speed: 0.08 + Math.random() * 0.12,
        phase: Math.random() * Math.PI * 2,
        opacity: 0.05 + Math.random() * 0.07,
        thickness: 0.8,
      };
    });

    const draw = (time: number) => {
      ctx.clearRect(0, 0, w, h);
      const t = time * 0.001;

      for (const line of lines) {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(255, 255, 255, ${line.opacity})`;
        ctx.lineWidth = line.thickness;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        const steps = 80;
        for (let s = 0; s <= steps; s++) {
          const p = s / steps; // 0 to 1 along the line

          // Base diagonal path: top-left to bottom-right
          // x goes from left edge to right edge
          // y goes from top to bottom with a curve
          const baseX = p * (w + h * 0.6) - h * 0.3;
          const baseY = p * h;

          // Add the characteristic S-curve of the original waves
          const curveOffset = Math.sin(p * Math.PI * 2 * line.curvature + line.phase) * (w * 0.15);
          
          // Animated wobble
          const wobbleOffset = Math.sin(p * Math.PI * line.wobbleFreq + t * line.speed + line.phase) * (w * line.wobble);

          // Shift based on line offset to spread them out
          const spreadX = line.offset * w;
          const spreadY = -line.offset * h * 0.3;

          const x = baseX + curveOffset + wobbleOffset + spreadX;
          const y = baseY + spreadY;

          if (s === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }

        ctx.stroke();
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 w-full h-full pointer-events-none ${className}`}
    />
  );
};
