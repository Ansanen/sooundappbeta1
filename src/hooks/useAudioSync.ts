import { useRef, useCallback } from 'react';

const DRIFT_HARD = 0.3;  // seconds — hard resync
const DRIFT_SOFT = 0.05; // seconds — soft nudge via playbackRate

interface UseAudioSyncOptions {
  serverNow: () => number;
}

/**
 * Web Audio API based sync engine.
 * Uses AudioContext + AudioBufferSourceNode for sample-accurate scheduling.
 * Drift correction via playbackRate (no seeking during playback).
 */
export function useAudioSync({ serverNow }: UseAudioSyncOptions) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const startTrackPosRef = useRef<number>(0);
  const playbackStartAtRef = useRef<number | null>(null);
  const bufferCache = useRef<Map<string, AudioBuffer>>(new Map());
  const pausedPositionRef = useRef<number | null>(null);
  const isPlayingRef = useRef(false);

  function getAudioCtx(): AudioContext {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
      gainNodeRef.current = audioCtxRef.current.createGain();
      gainNodeRef.current.connect(audioCtxRef.current.destination);
    }
    return audioCtxRef.current;
  }

  const unlockAudio = useCallback(() => {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    // Play silent buffer to unlock
    const silent = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = silent;
    src.connect(ctx.destination);
    src.start(0);
  }, []);

  const loadTrack = useCallback(async (trackUrl: string): Promise<void> => {
    if (bufferCache.current.has(trackUrl)) {
      bufferRef.current = bufferCache.current.get(trackUrl)!;
      console.log('[AudioSync] Track loaded from cache');
      return;
    }
    console.log('[AudioSync] Loading track:', trackUrl);
    const res = await fetch(trackUrl);
    if (!res.ok) throw new Error(`Stream error: ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    const ctx = getAudioCtx();
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    bufferCache.current.set(trackUrl, decoded);
    bufferRef.current = decoded;
    console.log('[AudioSync] Track decoded, duration:', decoded.duration.toFixed(1) + 's');
  }, []);

  const schedulePlay = useCallback((serverStartTime: number, trackPosition: number) => {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();

    // Stop previous source
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch {}
      sourceRef.current = null;
    }

    if (!bufferRef.current) {
      console.warn('[AudioSync] No buffer loaded');
      return;
    }

    pausedPositionRef.current = null;

    const source = ctx.createBufferSource();
    source.buffer = bufferRef.current;
    source.connect(gainNodeRef.current || ctx.destination);

    const now = serverNow();
    const delayMs = serverStartTime - now;
    const startAt = delayMs > 0
      ? ctx.currentTime + delayMs / 1000
      : ctx.currentTime + 0.05;

    // If event arrived late, adjust track position forward
    const adjustedTrackPos = delayMs < 0
      ? trackPosition + Math.abs(delayMs) / 1000
      : trackPosition;

    const safePos = Math.max(0, Math.min(adjustedTrackPos, bufferRef.current.duration - 0.1));
    
    source.start(startAt, safePos);

    source.onended = () => {
      if (isPlayingRef.current) {
        isPlayingRef.current = false;
        // Track ended naturally
      }
    };

    sourceRef.current = source;
    startTrackPosRef.current = safePos;
    playbackStartAtRef.current = startAt;
    isPlayingRef.current = true;

    console.log(`[AudioSync] Scheduled play: delay=${delayMs.toFixed(0)}ms, pos=${safePos.toFixed(2)}s`);
  }, [serverNow]);

  const pause = useCallback(() => {
    if (sourceRef.current) {
      const ctx = audioCtxRef.current;
      if (ctx && playbackStartAtRef.current !== null) {
        pausedPositionRef.current =
          (startTrackPosRef.current || 0) +
          Math.max(0, ctx.currentTime - playbackStartAtRef.current);
      }
      try { sourceRef.current.stop(); } catch {}
      sourceRef.current = null;
    }
    isPlayingRef.current = false;
    console.log('[AudioSync] Paused at', pausedPositionRef.current?.toFixed(2) + 's');
  }, []);

  const getPosition = useCallback((): number | null => {
    const ctx = audioCtxRef.current;
    if (!ctx) return null;
    if (!sourceRef.current) return pausedPositionRef.current;
    if (playbackStartAtRef.current === null) return null;
    const elapsed = Math.max(0, ctx.currentTime - playbackStartAtRef.current);
    return (startTrackPosRef.current || 0) + elapsed;
  }, []);

  const getDuration = useCallback((): number => {
    return bufferRef.current?.duration || 0;
  }, []);

  const checkDrift = useCallback(({ serverTime, trackPosition }: { serverTime: number; trackPosition: number }) => {
    const ctx = audioCtxRef.current;
    const source = sourceRef.current;
    if (!ctx || !source || playbackStartAtRef.current === null) return;

    const elapsed = (serverNow() - serverTime) / 1000;
    const expectedPosition = trackPosition + elapsed;
    const actualPosition =
      (ctx.currentTime - playbackStartAtRef.current) + (startTrackPosRef.current || 0);
    const drift = expectedPosition - actualPosition;

    if (Math.abs(drift) > DRIFT_HARD) {
      console.log(`[AudioSync] Hard drift: ${drift.toFixed(3)}s → resync`);
      schedulePlay(serverNow() + 200, expectedPosition);
    } else if (Math.abs(drift) > DRIFT_SOFT) {
      const rate = drift > 0 ? 1.02 : 0.98;
      source.playbackRate.value = rate;
      console.log(`[AudioSync] Soft drift: ${(drift * 1000).toFixed(0)}ms → rate=${rate}`);
      setTimeout(() => {
        try { if (source.playbackRate) source.playbackRate.value = 1.0; } catch {}
      }, 2000);
    }
  }, [serverNow, schedulePlay]);

  const setVolume = useCallback((vol: number) => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = vol;
    }
  }, []);

  return {
    loadTrack,
    schedulePlay,
    pause,
    checkDrift,
    unlockAudio,
    getPosition,
    getDuration,
    setVolume,
    isPlayingRef,
  };
}
