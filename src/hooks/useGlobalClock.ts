/**
 * useGlobalClock — React hook for clock synchronization
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { globalClock, SyncState } from '../lib/sync/clock';

export interface UseGlobalClockResult {
  // Sync state
  offset: number;
  rtt: number;
  confidence: number;
  connected: boolean;
  
  // Methods
  getServerTime: () => number;
  getLocalTime: () => number;
  toLocalTime: (serverTime: number) => number;
  toServerTime: (localTime: number) => number;
  forceSync: () => void;
  
  // Quality indicator
  syncQuality: 'excellent' | 'good' | 'fair' | 'poor' | 'disconnected';
}

export function useGlobalClock(socketUrl?: string): UseGlobalClockResult {
  const [state, setState] = useState<SyncState>(() => globalClock.getState());
  const startedRef = useRef(false);
  
  // Start clock sync on mount
  useEffect(() => {
    if (socketUrl && !startedRef.current) {
      startedRef.current = true;
      globalClock.start(socketUrl);
    }
    
    // Subscribe to updates
    const unsubscribe = globalClock.subscribe((newState) => {
      setState(newState);
    });
    
    return () => {
      unsubscribe();
    };
  }, [socketUrl]);
  
  // Memoized methods
  const getServerTime = useCallback(() => globalClock.getServerTime(), []);
  const getLocalTime = useCallback(() => globalClock.getLocalTime(), []);
  const toLocalTime = useCallback((serverTime: number) => globalClock.toLocalTime(serverTime), []);
  const toServerTime = useCallback((localTime: number) => globalClock.toServerTime(localTime), []);
  const forceSync = useCallback(() => globalClock.forceSync(), []);
  
  // Calculate sync quality
  const syncQuality = calculateSyncQuality(state);
  
  return {
    offset: state.offset,
    rtt: state.rtt,
    confidence: state.confidence,
    connected: state.connected,
    getServerTime,
    getLocalTime,
    toLocalTime,
    toServerTime,
    forceSync,
    syncQuality,
  };
}

function calculateSyncQuality(state: SyncState): UseGlobalClockResult['syncQuality'] {
  if (!state.connected) return 'disconnected';
  if (state.confidence >= 0.8 && state.rtt < 50) return 'excellent';
  if (state.confidence >= 0.6 && state.rtt < 100) return 'good';
  if (state.confidence >= 0.3 && state.rtt < 200) return 'fair';
  return 'poor';
}

/**
 * useSyncedTime — Get continuously updating server time
 */
export function useSyncedTime(updateInterval = 100): number {
  const [time, setTime] = useState(() => globalClock.getServerTime());
  
  useEffect(() => {
    const interval = setInterval(() => {
      setTime(globalClock.getServerTime());
    }, updateInterval);
    
    return () => clearInterval(interval);
  }, [updateInterval]);
  
  return time;
}
