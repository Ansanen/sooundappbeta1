/**
 * useSyncedAudio — Main React hook for phase-coherent audio playback
 * 
 * Combines:
 * - Global clock synchronization
 * - Audio transport (WebTransport/WebSocket)
 * - Ring buffer for decoded audio
 * - AudioWorklet for real-time playback with drift correction
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { getSocket } from '../lib/socket';
import { globalClock } from '../lib/sync/clock';
import { RingBuffer } from '../lib/audio/ring-buffer';
import { DriftCalculator } from '../lib/sync/drift-calculator';

export type SyncedAudioStatus = 
  | 'idle'
  | 'initializing'
  | 'buffering'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'error';

export interface SyncedAudioStats {
  driftMs: number;
  rttMs: number;
  bufferedSeconds: number;
  correctionRatio: number;
  confidence: number;
}

export interface UseSyncedAudioOptions {
  roomId: string;
  isHost: boolean;
  trackUrl: string | null;
  onTimeUpdate?: (time: number, duration: number) => void;
  onEnded?: () => void;
  onError?: (error: string) => void;
}

export function useSyncedAudio(options: UseSyncedAudioOptions) {
  const { roomId, isHost, trackUrl, onTimeUpdate, onEnded, onError } = options;
  
  const [status, setStatus] = useState<SyncedAudioStatus>('idle');
  const [volume, setVolumeState] = useState(1);
  const [stats, setStats] = useState<SyncedAudioStats>({
    driftMs: 0,
    rttMs: 0,
    bufferedSeconds: 0,
    correctionRatio: 1,
    confidence: 0
  });
  
  // Refs for audio components
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const ringBufferRef = useRef<RingBuffer | null>(null);
  const driftCalculatorRef = useRef<DriftCalculator | null>(null);
  
  // Refs for state
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const isPlayingRef = useRef(false);
  const startTimeRef = useRef(0);  // Server time when playback should start
  
  // Callbacks refs
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onEndedRef = useRef(onEnded);
  const onErrorRef = useRef(onError);
  
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
    onEndedRef.current = onEnded;
    onErrorRef.current = onError;
  }, [onTimeUpdate, onEnded, onError]);
  
  // Initialize audio system
  const initialize = useCallback(async () => {
    if (audioContextRef.current) return;
    
    setStatus('initializing');
    
    try {
      // Create AudioContext
      const ctx = new AudioContext({ sampleRate: 48000 });
      audioContextRef.current = ctx;
      
      // Create gain node for volume control
      const gainNode = ctx.createGain();
      gainNode.connect(ctx.destination);
      gainNodeRef.current = gainNode;
      
      // Create ring buffer (5 seconds)
      const ringBuffer = new RingBuffer({
        sampleRate: 48000,
        channels: 2,
        durationSeconds: 5
      });
      ringBufferRef.current = ringBuffer;
      
      // Create drift calculator
      driftCalculatorRef.current = new DriftCalculator({
        deadbandMs: 5,
        maxDriftMs: 100,
        maxCorrectionRatio: 0.03
      });
      
      // Load and register AudioWorklet
      await ctx.audioWorklet.addModule(
        new URL('../worklets/sync-processor.ts', import.meta.url)
      );
      
      // Create worklet node
      const workletNode = new AudioWorkletNode(ctx, 'sync-processor', {
        processorOptions: {
          sharedBuffer: ringBuffer.getSharedBuffer(),
          sampleRate: 48000,
          channels: 2
        }
      });
      
      workletNode.connect(gainNode);
      workletNodeRef.current = workletNode;
      
      // Handle messages from worklet
      workletNode.port.onmessage = (event) => {
        const msg = event.data;
        
        switch (msg.type) {
          case 'ready':
            console.log('[SyncedAudio] Worklet ready');
            break;
            
          case 'stats':
            setStats(prev => ({
              ...prev,
              driftMs: msg.drift,
              correctionRatio: msg.ratio,
              bufferedSeconds: msg.buffered
            }));
            break;
            
          case 'underrun':
            console.warn('[SyncedAudio] Buffer underrun');
            break;
            
          case 'hard_reset':
            console.warn('[SyncedAudio] Hard reset, drift was:', msg.drift, 'ms');
            break;
        }
      };
      
      setStatus('ready');
      
    } catch (error) {
      console.error('[SyncedAudio] Init error:', error);
      setStatus('error');
      onErrorRef.current?.((error as Error).message);
    }
  }, []);
  
  // Load track
  const loadTrack = useCallback(async (url: string) => {
    if (!audioContextRef.current || !ringBufferRef.current) {
      await initialize();
    }
    
    setStatus('buffering');
    
    try {
      const ctx = audioContextRef.current!;
      const ringBuffer = ringBufferRef.current!;
      
      // Fetch and decode audio
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      
      durationRef.current = audioBuffer.duration;
      
      // Convert to interleaved Float32Array
      const channels = audioBuffer.numberOfChannels;
      const length = audioBuffer.length;
      const samples = new Float32Array(length * 2);
      
      const left = audioBuffer.getChannelData(0);
      const right = channels > 1 ? audioBuffer.getChannelData(1) : left;
      
      for (let i = 0; i < length; i++) {
        samples[i * 2] = left[i];
        samples[i * 2 + 1] = right[i];
      }
      
      // Write to ring buffer
      ringBuffer.clear();
      ringBuffer.write(samples);
      
      setStatus('ready');
      
    } catch (error) {
      console.error('[SyncedAudio] Load error:', error);
      setStatus('error');
      onErrorRef.current?.((error as Error).message);
    }
  }, [initialize]);
  
  // Start synchronized playback
  const play = useCallback(async (position: number = 0) => {
    if (!workletNodeRef.current || !audioContextRef.current) {
      return;
    }
    
    const ctx = audioContextRef.current;
    
    // Resume AudioContext if suspended
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    
    const clock = globalClock.getState();
    const now = performance.timeOrigin + performance.now();
    
    // Send start command to worklet
    workletNodeRef.current.port.postMessage({
      type: 'start',
      globalStartTime: startTimeRef.current,
      localStartTime: globalClock.toLocalTime(startTimeRef.current),
      startPosition: position,
      manualOffset: getStoredLatencyOffset(),
      outputLatency: ctx.outputLatency * 1000 || 0
    });
    
    isPlayingRef.current = true;
    setStatus('playing');
  }, []);
  
  // Pause playback
  const pause = useCallback(() => {
    if (!workletNodeRef.current) return;
    
    workletNodeRef.current.port.postMessage({ type: 'stop' });
    isPlayingRef.current = false;
    setStatus('paused');
  }, []);
  
  // Seek to position
  const seek = useCallback((position: number) => {
    if (!workletNodeRef.current) return;
    
    currentTimeRef.current = position;
    workletNodeRef.current.port.postMessage({ type: 'seek', position });
  }, []);
  
  // Set volume
  const setVolume = useCallback((vol: number) => {
    setVolumeState(vol);
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = vol;
    }
  }, []);
  
  // Set manual latency offset
  const setLatencyOffset = useCallback((offsetMs: number) => {
    localStorage.setItem('soound_latency_offset', String(offsetMs));
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ type: 'set_offset', offset: offsetMs });
    }
  }, []);
  
  // Socket event handlers
  useEffect(() => {
    const socket = getSocket();
    
    // Handle synchronized play command from server
    const handleSyncPlay = (data: { scheduledTime: number; position: number }) => {
      console.log('[SyncedAudio] Received sync_play:', data);
      startTimeRef.current = data.scheduledTime;
      
      // Schedule play at the specified server time
      const localStartTime = globalClock.toLocalTime(data.scheduledTime);
      const now = performance.timeOrigin + performance.now();
      const delay = localStartTime - now;
      
      if (delay > 0) {
        setTimeout(() => {
          play(data.position);
        }, delay);
      } else {
        play(data.position);
      }
    };
    
    const handleSyncPause = (data: { position: number }) => {
      console.log('[SyncedAudio] Received sync_pause');
      pause();
    };
    
    const handleSyncSeek = (data: { scheduledTime: number; position: number }) => {
      console.log('[SyncedAudio] Received sync_seek:', data);
      seek(data.position);
    };
    
    socket.on('sync_play', handleSyncPlay);
    socket.on('sync_pause', handleSyncPause);
    socket.on('sync_seek', handleSyncSeek);
    
    return () => {
      socket.off('sync_play', handleSyncPlay);
      socket.off('sync_pause', handleSyncPause);
      socket.off('sync_seek', handleSyncSeek);
    };
  }, [play, pause, seek]);
  
  // Initialize clock sync
  useEffect(() => {
    globalClock.start(window.location.origin);
    
    const unsubscribe = globalClock.subscribe((state) => {
      setStats(prev => ({
        ...prev,
        rttMs: state.rtt,
        confidence: state.confidence
      }));
    });
    
    return () => {
      unsubscribe();
    };
  }, []);
  
  // Load track when URL changes
  useEffect(() => {
    if (trackUrl) {
      loadTrack(trackUrl);
    }
  }, [trackUrl, loadTrack]);
  
  // Cleanup
  useEffect(() => {
    return () => {
      if (workletNodeRef.current) {
        workletNodeRef.current.disconnect();
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);
  
  return {
    status,
    stats,
    volume,
    duration: durationRef.current,
    currentTime: currentTimeRef.current,
    
    // Methods
    play,
    pause,
    seek,
    setVolume,
    setLatencyOffset,
    initialize,
    
    // For host
    emitPlay: useCallback((position: number = 0) => {
      const socket = getSocket();
      socket.emit('live_play', { position });
    }, []),
    
    emitPause: useCallback(() => {
      const socket = getSocket();
      socket.emit('live_pause');
    }, []),
    
    emitSeek: useCallback((position: number) => {
      const socket = getSocket();
      socket.emit('live_seek', { position });
    }, []),
  };
}

// Helper to get stored latency offset
function getStoredLatencyOffset(): number {
  const stored = localStorage.getItem('soound_latency_offset');
  return stored ? parseFloat(stored) : 0;
}
