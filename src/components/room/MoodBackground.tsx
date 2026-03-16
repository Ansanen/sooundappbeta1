import React, { useMemo } from 'react';

interface MoodBackgroundProps {
  moodScores: Record<string, number>;
}

const MOOD_COLORS: Record<string, string> = {
  fire: '#FF6B35',
  heart: '#FF2D78',
  clap: '#FFD700',
  music: '#7B68EE',
  spark: '#00D4FF',
};

const MOOD_LABELS: Record<string, string> = {
  fire: '🔥 On Fire',
  heart: '💗 Lovely',
  clap: '⭐ Stellar',
  music: '🎵 Vibing',
  spark: '✨ Electric',
};

const NEUTRAL = 'rgba(255,255,255,0.05)';

function blendMoodColor(scores: Record<string, number>): { color: string; intensity: number; dominant: string | null } {
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  if (total < 0.5) return { color: NEUTRAL, intensity: 0, dominant: null };

  let r = 0, g = 0, b = 0;
  let maxKey: string | null = null;
  let maxVal = 0;

  for (const [key, val] of Object.entries(scores)) {
    const hex = MOOD_COLORS[key];
    if (!hex || val <= 0) continue;
    const weight = val / total;
    const pr = parseInt(hex.slice(1, 3), 16);
    const pg = parseInt(hex.slice(3, 5), 16);
    const pb = parseInt(hex.slice(5, 7), 16);
    r += pr * weight;
    g += pg * weight;
    b += pb * weight;
    if (val > maxVal) { maxVal = val; maxKey = key; }
  }

  // Intensity ramps up: clamp total to 0..20 → 0..1
  const intensity = Math.min(total / 20, 1);

  const cr = Math.round(r);
  const cg = Math.round(g);
  const cb = Math.round(b);
  const color = `rgba(${cr},${cg},${cb},${(0.15 + intensity * 0.35).toFixed(2)})`;

  return { color, intensity, dominant: maxKey };
}

export const MoodBackground: React.FC<MoodBackgroundProps> = React.memo(({ moodScores }) => {
  const { color, intensity, dominant } = useMemo(() => blendMoodColor(moodScores), [moodScores]);

  const dominantScore = dominant ? (moodScores[dominant] ?? 0) : 0;
  const showIndicator = dominant && dominantScore > 3;

  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
      {/* Orb 1 — top left */}
      <div
        className="absolute -top-1/4 -left-1/4 w-[80vw] h-[80vw] rounded-full blur-[120px]"
        style={{
          backgroundColor: color,
          '--tx': '5%',
          '--ty': '3%',
          animation: 'mood-breathe 8s ease-in-out infinite',
          transition: 'background-color 3000ms ease',
        } as React.CSSProperties}
      />
      {/* Orb 2 — bottom right */}
      <div
        className="absolute -bottom-1/4 -right-1/4 w-[70vw] h-[70vw] rounded-full blur-[100px]"
        style={{
          backgroundColor: color,
          '--tx': '-4%',
          '--ty': '-5%',
          animation: 'mood-breathe 10s ease-in-out infinite 2s',
          transition: 'background-color 3000ms ease',
        } as React.CSSProperties}
      />
      {/* Orb 3 — center, subtler */}
      <div
        className="absolute top-1/3 left-1/3 w-[50vw] h-[50vw] rounded-full blur-[140px]"
        style={{
          backgroundColor: color,
          '--tx': '2%',
          '--ty': '-3%',
          animation: 'mood-breathe 12s ease-in-out infinite 4s',
          transition: 'background-color 3000ms ease',
          opacity: intensity * 0.6,
        } as React.CSSProperties}
      />

      {/* Mood indicator pill */}
      <div
        className="absolute top-4 right-4 z-10 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/10 font-display text-xs text-white/80 transition-opacity duration-700"
        style={{ opacity: showIndicator ? 1 : 0 }}
      >
        {dominant && MOOD_LABELS[dominant]}
      </div>
    </div>
  );
});

MoodBackground.displayName = 'MoodBackground';
