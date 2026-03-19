/**
 * LatencyCalibration — Manual latency offset calibration component
 * 
 * Allows users to adjust audio playback timing for devices with
 * incorrect or variable output latency.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Volume2, Play, RotateCcw, Check } from 'lucide-react';

interface LatencyCalibrationProps {
  isOpen: boolean;
  currentOffset: number;  // Current offset in ms
  onSave: (offset: number) => void;
  onClose: () => void;
}

export function LatencyCalibration({
  isOpen,
  currentOffset,
  onSave,
  onClose
}: LatencyCalibrationProps) {
  if (!isOpen) return null;
  const [offset, setOffset] = useState(currentOffset);
  const [isPlaying, setIsPlaying] = useState(false);
  const [tapTimes, setTapTimes] = useState<number[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Create AudioContext on first interaction
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    return audioContextRef.current;
  }, []);
  
  // Play a click sound
  const playClick = useCallback(() => {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.frequency.value = 1000;
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.05);
  }, [getAudioContext]);
  
  // Start click track (1 click per second)
  const startClickTrack = useCallback(() => {
    setIsPlaying(true);
    setTapTimes([]);
    
    playClick();
    intervalRef.current = setInterval(() => {
      playClick();
    }, 1000);
  }, [playClick]);
  
  // Stop click track
  const stopClickTrack = useCallback(() => {
    setIsPlaying(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);
  
  // Handle tap for calibration
  const handleTap = useCallback(() => {
    if (!isPlaying) return;
    
    const now = performance.now();
    setTapTimes(prev => [...prev, now]);
  }, [isPlaying]);
  
  // Calculate suggested offset from taps
  const calculateSuggestedOffset = useCallback((): number | null => {
    if (tapTimes.length < 3) return null;
    
    // Calculate average interval between taps
    const intervals: number[] = [];
    for (let i = 1; i < tapTimes.length; i++) {
      intervals.push(tapTimes[i] - tapTimes[i - 1]);
    }
    
    // Filter out outliers (more than 20% off from 1000ms)
    const validIntervals = intervals.filter(i => i > 800 && i < 1200);
    if (validIntervals.length < 2) return null;
    
    const avgInterval = validIntervals.reduce((a, b) => a + b, 0) / validIntervals.length;
    
    // The difference from 1000ms is the perceived latency
    const suggestedOffset = 1000 - avgInterval;
    
    return Math.round(suggestedOffset);
  }, [tapTimes]);
  
  // Cleanup
  useEffect(() => {
    return () => {
      stopClickTrack();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [stopClickTrack]);
  
  const suggestedOffset = calculateSuggestedOffset();
  
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-neutral-900 rounded-2xl p-6 max-w-md w-full space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Audio Calibration</h2>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>
        
        {/* Description */}
        <p className="text-neutral-400 text-sm">
          Adjust the audio timing if you notice the sound is ahead or behind other devices.
        </p>
        
        {/* Manual Slider */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-400">Manual Offset</span>
            <span className="text-white font-mono">{offset > 0 ? '+' : ''}{offset}ms</span>
          </div>
          
          <input
            type="range"
            min="-100"
            max="100"
            step="5"
            value={offset}
            onChange={(e) => setOffset(Number(e.target.value))}
            className="w-full h-2 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-green-500"
          />
          
          <div className="flex justify-between text-xs text-neutral-500">
            <span>Earlier</span>
            <span>Later</span>
          </div>
        </div>
        
        {/* Tap Calibration */}
        <div className="border-t border-neutral-800 pt-6 space-y-4">
          <h3 className="text-sm font-medium text-white">Tap Calibration (optional)</h3>
          <p className="text-xs text-neutral-500">
            Press Start, then tap the button in sync with the clicks you hear.
          </p>
          
          <div className="flex gap-3">
            {!isPlaying ? (
              <button
                onClick={startClickTrack}
                className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 text-white py-3 rounded-xl transition-colors"
              >
                <Play size={20} />
                Start
              </button>
            ) : (
              <>
                <button
                  onClick={handleTap}
                  className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl transition-colors"
                >
                  <Volume2 size={20} />
                  TAP ({tapTimes.length})
                </button>
                <button
                  onClick={stopClickTrack}
                  className="px-4 bg-neutral-700 hover:bg-neutral-600 text-white rounded-xl transition-colors"
                >
                  Stop
                </button>
              </>
            )}
          </div>
          
          {suggestedOffset !== null && (
            <div className="bg-neutral-800 rounded-xl p-4 space-y-2">
              <p className="text-sm text-neutral-300">
                Suggested offset: <span className="font-mono text-green-400">{suggestedOffset}ms</span>
              </p>
              <button
                onClick={() => setOffset(suggestedOffset)}
                className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
              >
                Apply suggestion
              </button>
            </div>
          )}
        </div>
        
        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={() => setOffset(0)}
            className="flex-1 flex items-center justify-center gap-2 bg-neutral-700 hover:bg-neutral-600 text-white py-3 rounded-xl transition-colors"
          >
            <RotateCcw size={18} />
            Reset
          </button>
          <button
            onClick={() => {
              onSave(offset);
              onClose();
            }}
            className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 text-white py-3 rounded-xl transition-colors"
          >
            <Check size={18} />
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * SyncIndicator — Shows current sync quality
 */
export function SyncIndicator({ driftMs, rttMs }: { driftMs: number; rttMs: number }) {
  const getColor = () => {
    const absDrift = Math.abs(driftMs);
    if (absDrift < 10) return 'bg-green-500';
    if (absDrift < 50) return 'bg-yellow-500';
    return 'bg-red-500';
  };
  
  const getLabel = () => {
    const absDrift = Math.abs(driftMs);
    if (absDrift < 10) return 'In Sync';
    if (absDrift < 50) return 'Slight Drift';
    return 'Out of Sync';
  };
  
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className={`w-2 h-2 rounded-full ${getColor()}`} />
      <span className="text-neutral-400">{getLabel()}</span>
      <span className="text-neutral-600 font-mono">
        {driftMs > 0 ? '+' : ''}{driftMs.toFixed(0)}ms
      </span>
    </div>
  );
}
