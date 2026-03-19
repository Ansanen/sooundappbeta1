import React from 'react';
import { motion } from 'motion/react';
import type { SyncedAudioStats } from '../hooks/useSyncedAudio';

interface SyncIndicatorProps {
  stats: SyncedAudioStats;
  compact?: boolean;
}

export const SyncIndicator: React.FC<SyncIndicatorProps> = ({ stats, compact = false }) => {
  const { driftMs, rttMs, confidence } = stats;
  
  // Determine sync quality
  const absrift = Math.abs(driftMs);
  let color = '#22c55e'; // green
  let label = 'Perfect';
  let icon = '🟢';
  
  if (absrift > 50) {
    color = '#ef4444'; // red
    label = 'Poor';
    icon = '🔴';
  } else if (absrift > 10) {
    color = '#eab308'; // yellow
    label = 'Good';
    icon = '🟡';
  }
  
  if (compact) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/40 backdrop-blur-sm"
        title={`Drift: ${driftMs.toFixed(1)}ms | RTT: ${rttMs.toFixed(0)}ms`}
      >
        <div 
          className="w-2 h-2 rounded-full animate-pulse"
          style={{ backgroundColor: color }}
        />
        <span className="text-[10px] text-white/60 font-mono">
          {absrift < 1 ? '<1' : absrift.toFixed(0)}ms
        </span>
      </motion.div>
    );
  }
  
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 px-4 py-2 rounded-xl bg-black/40 backdrop-blur-md border border-white/10"
    >
      {/* Sync status */}
      <div className="flex items-center gap-2">
        <div 
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: color, boxShadow: `0 0 10px ${color}` }}
        />
        <div className="flex flex-col">
          <span className="text-xs font-medium text-white">{label} Sync</span>
          <span className="text-[10px] text-white/50 font-mono">
            {driftMs >= 0 ? '+' : ''}{driftMs.toFixed(1)}ms drift
          </span>
        </div>
      </div>
      
      {/* Separator */}
      <div className="w-px h-8 bg-white/10" />
      
      {/* RTT */}
      <div className="flex flex-col">
        <span className="text-xs font-medium text-white/80">RTT</span>
        <span className="text-[10px] text-white/50 font-mono">{rttMs.toFixed(0)}ms</span>
      </div>
      
      {/* Confidence */}
      <div className="flex flex-col">
        <span className="text-xs font-medium text-white/80">Conf</span>
        <span className="text-[10px] text-white/50 font-mono">{(confidence * 100).toFixed(0)}%</span>
      </div>
    </motion.div>
  );
};
