/**
 * useWebAudioSync — Sample-accurate synchronized playback
 * 
 * Architecture:
 * 1. All clients download the same MP3 file via HTTP
 * 2. Decode to AudioBuffer using Web Audio API
 * 3. NTP-style sync establishes server↔client time mapping
 * 4. Server broadcasts "play at serverTime X, from position Y"
 * 5. Client maps serverTime to AudioContext.currentTime
 * 6. Calls source.start(exactAudioTime, position) — SAMPLE ACCURATE
 * 
 * Key insight: AudioContext.currentTime is a hardware clock (~0.001ms precision)
 * vs Date.now() (~15ms precision). By mapping between them, we get
 * sub-millisecond sync across devices.
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { getSocket } from '../lib/socket';

export type SyncStatus = 'idle' | 'loading' | 'decoding' | 'ready' | 'playing' | 'paused' | 'error';

interface WebAudioSyncOptions {
  trackUrl: string | null;
  isHost: boolean;
  onTimeUpdate: (currentTime: number, duration: number) => void;
  onEnded: () => void;
  onStatusChange: (status: SyncStatus, msg?: string) => void;
}

// Relationship between Date.now() and AudioContext.currentTime
interface TimeMapping {
  dateNow: number;        // Date.now() at calibration moment
  audioCtxTime: number;   // AudioContext.currentTime at same moment
}

export function useWebAudioSync({
  trackUrl,
  isHost,
  onTimeUpdate,
  onEnded,
  onStatusChange,
}: WebAudioSyncOptions) {
  const socket = getSocket();
  
  // Core audio
  const audioCtxRef = useRef<AudioContext | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  
  // Timing
  const serverOffsetRef = useRef(0);          // server_time - local_date_now
  const timeMappingRef = useRef<TimeMapping>({ dateNow: 0, audioCtxTime: 0 });
  const playStartAudioTimeRef = useRef(0);    // AudioContext.currentTime when play started
  const playStartPositionRef = useRef(0);     // Track position when play started
  
  // State
  const [volume, setVolumeState] = useState(1);
  const [status, setStatusInternal] = useState<SyncStatus>('idle');
  const isPlayingRef = useRef(false);
  const trackDurationRef = useRef(0);
  const animFrameRef = useRef(0);

  // Stable refs for callbacks
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onEndedRef = useRef(onEnded);
  const onStatusChangeRef = useRef(onStatusChange);
  onTimeUpdateRef.current = onTimeUpdate;
  onEndedRef.current = onEnded;
  onStatusChangeRef.current = onStatusChange;

  const setStatus = useCallback((s: SyncStatus, msg?: string) => {
    setStatusInternal(s);
    onStatusChangeRef.current(s, msg);
  }, []);

  // === Initialize AudioContext ===
  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext();
      gainRef.current = audioCtxRef.current.createGain();
      gainRef.current.connect(audioCtxRef.current.destination);
    }
    // Resume if suspended (mobile autoplay policy)
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  // === Calibrate time mapping ===
  const calibrateTimeMapping = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    timeMappingRef.current = {
      dateNow: Date.now(),
      audioCtxTime: ctx.currentTime,
    };
  }, []);

  // Convert server timestamp to AudioContext.currentTime
  const serverTimeToAudioTime = useCallback((serverTime: number): number => {
    const localDateNow = serverTime - serverOffsetRef.current;
    const elapsed = (localDateNow - timeMappingRef.current.dateNow) / 1000;
    return timeMappingRef.current.audioCtxTime + elapsed;
  }, []);

  // Get current track position
  const getCurrentPosition = useCallback((): number => {
    if (!isPlayingRef.current || !audioCtxRef.current) return playStartPositionRef.current;
    const elapsed = audioCtxRef.current.currentTime - playStartAudioTimeRef.current;
    return playStartPositionRef.current + elapsed;
  }, []);

  // === NTP Sync ===
  useEffect(() => {
    let pings = 0;
    const samples: { rtt: number; offset: number }[] = [];

    const doPing = () => {
      socket.emit('ntp_ping', { t0: Date.now() });
    };

    const handlePong = (data: { t0: number; serverTime: number }) => {
      const t3 = Date.now();
      const rtt = t3 - data.t0;
      const offset = data.serverTime - (data.t0 + rtt / 2);
      samples.push({ rtt, offset });
      pings++;

      if (pings < 10) {
        setTimeout(doPing, 50);
      } else {
        samples.sort((a, b) => a.rtt - b.rtt);
        // Use only the 4 lowest-RTT samples for best accuracy
        const best = samples.slice(0, 4);
        serverOffsetRef.current = best.reduce((s, x) => s + x.offset, 0) / best.length;
        calibrateTimeMapping();
        console.log(`[Sync] Server offset: ${serverOffsetRef.current.toFixed(1)}ms (best RTT: ${samples[0].rtt}ms)`);
      }
    };

    socket.on('ntp_pong', handlePong);
    const startTimeout = setTimeout(doPing, 300);
    const interval = setInterval(() => {
      pings = 0;
      samples.length = 0;
      calibrateTimeMapping();
      doPing();
    }, 15000);

    return () => {
      socket.off('ntp_pong', handlePong);
      clearTimeout(startTimeout);
      clearInterval(interval);
    };
  }, [socket, calibrateTimeMapping]);

  // === Load & Decode Track ===
  useEffect(() => {
    if (!trackUrl) {
      bufferRef.current = null;
      setStatus('idle');
      return;
    }

    const ctx = getAudioCtx();
    setStatus('loading', 'Downloading track...');

    const controller = new AbortController();

    fetch(trackUrl, { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setStatus('decoding', 'Preparing audio...');
        return res.arrayBuffer();
      })
      .then(data => ctx.decodeAudioData(data))
      .then(audioBuffer => {
        bufferRef.current = audioBuffer;
        trackDurationRef.current = audioBuffer.duration;
        setStatus('ready', 'Ready');
        console.log(`[Audio] Decoded: ${audioBuffer.duration.toFixed(1)}s, ${audioBuffer.sampleRate}Hz`);
      })
      .catch(e => {
        if (e.name !== 'AbortError') {
          console.error('[Audio] Load error:', e);
          setStatus('error', 'Failed to load track');
        }
      });

    return () => controller.abort();
  }, [trackUrl, getAudioCtx, setStatus]);

  // === Core: Start playback at exact time ===
  const startPlaybackAt = useCallback((position: number, atAudioTime?: number) => {
    const ctx = audioCtxRef.current;
    const buffer = bufferRef.current;
    if (!ctx || !buffer) return;

    // Stop any existing source
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch {}
      sourceRef.current.disconnect();
    }

    // Create new source
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gainRef.current!);
    sourceRef.current = source;

    // Clamp position
    const pos = Math.max(0, Math.min(position, buffer.duration - 0.1));

    // Schedule or play now
    const startTime = atAudioTime ?? ctx.currentTime;
    const delay = startTime - ctx.currentTime;

    if (delay > 0) {
      source.start(startTime, pos);
      console.log(`[Play] Scheduled start in ${(delay * 1000).toFixed(0)}ms at position ${pos.toFixed(2)}s`);
    } else {
      // Compensate for being late
      const lateBy = -delay;
      source.start(0, pos + lateBy);
      console.log(`[Play] Starting now (${(lateBy * 1000).toFixed(0)}ms late), position ${(pos + lateBy).toFixed(2)}s`);
    }

    playStartAudioTimeRef.current = Math.max(startTime, ctx.currentTime);
    playStartPositionRef.current = pos;
    isPlayingRef.current = true;
    setStatus('playing');

    // Handle track end
    source.onended = () => {
      if (isPlayingRef.current) {
        isPlayingRef.current = false;
        setStatus('ready');
        onEndedRef.current();
      }
    };
  }, [setStatus]);

  // === Stop playback ===
  const stopPlayback = useCallback((updatePosition = true) => {
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch {}
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (updatePosition) {
      playStartPositionRef.current = getCurrentPosition();
    }
    isPlayingRef.current = false;
  }, [getCurrentPosition]);

  // === Time update loop (requestAnimationFrame for smooth progress) ===
  useEffect(() => {
    const tick = () => {
      if (isPlayingRef.current) {
        const pos = getCurrentPosition();
        onTimeUpdateRef.current(pos, trackDurationRef.current);
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [getCurrentPosition]);

  // === Socket sync events ===
  useEffect(() => {
    const handleSyncPlay = (data: { scheduledTime: number; position: number }) => {
      const ctx = audioCtxRef.current;
      if (!ctx || !bufferRef.current) {
        // Not ready yet — wait for buffer
        console.log('[Sync] Received sync_play but audio not ready, waiting...');
        const waitForReady = () => {
          if (bufferRef.current) {
            calibrateTimeMapping();
            const audioTime = serverTimeToAudioTime(data.scheduledTime);
            startPlaybackAt(data.position, audioTime);
          } else {
            setTimeout(waitForReady, 100);
          }
        };
        waitForReady();
        return;
      }

      calibrateTimeMapping();
      const audioTime = serverTimeToAudioTime(data.scheduledTime);
      startPlaybackAt(data.position, audioTime);
    };

    const handleSyncPause = (data: { position: number }) => {
      stopPlayback(false);
      playStartPositionRef.current = data.position;
      setStatus('paused');
      console.log(`[Sync] Paused at ${data.position.toFixed(2)}s`);
    };

    const handleSyncSeek = (data: { scheduledTime: number; position: number }) => {
      if (!audioCtxRef.current || !bufferRef.current) return;
      calibrateTimeMapping();
      const audioTime = serverTimeToAudioTime(data.scheduledTime);
      stopPlayback(false);
      startPlaybackAt(data.position, audioTime);
    };

    // Late joiner: host broadcasts position for progress bar + drift correction
    const handleLiveTime = (data: { currentTime: number }) => {
      if (isHost) return;
      if (!isPlayingRef.current || !audioCtxRef.current) return;
      
      const myPos = getCurrentPosition();
      const drift = Math.abs(myPos - data.currentTime);
      
      if (drift > 0.3) {
        console.log(`[Sync] Drift correction: ${drift.toFixed(2)}s`);
        stopPlayback(false);
        startPlaybackAt(data.currentTime);
      }
    };

    socket.on('sync_play', handleSyncPlay);
    socket.on('sync_pause', handleSyncPause);
    socket.on('sync_seek', handleSyncSeek);
    socket.on('live_time', handleLiveTime);

    return () => {
      socket.off('sync_play', handleSyncPlay);
      socket.off('sync_pause', handleSyncPause);
      socket.off('sync_seek', handleSyncSeek);
      socket.off('live_time', handleLiveTime);
    };
  }, [socket, isHost, startPlaybackAt, stopPlayback, calibrateTimeMapping, serverTimeToAudioTime, getCurrentPosition, setStatus]);

  // === Host: broadcast position ===
  useEffect(() => {
    if (!isHost) return;
    const interval = setInterval(() => {
      if (!isPlayingRef.current) return;
      socket.emit('live_time', {
        currentTime: getCurrentPosition(),
        duration: trackDurationRef.current,
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isHost, socket, getCurrentPosition]);

  // === Public API ===
  const play = useCallback((position?: number) => {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const pos = position ?? getCurrentPosition();
    startPlaybackAt(pos);
  }, [getAudioCtx, getCurrentPosition, startPlaybackAt]);

  const pause = useCallback(() => {
    stopPlayback();
    setStatus('paused');
  }, [stopPlayback, setStatus]);

  const seekTo = useCallback((time: number) => {
    if (isPlayingRef.current) {
      stopPlayback(false);
      startPlaybackAt(time);
    } else {
      playStartPositionRef.current = time;
    }
  }, [stopPlayback, startPlaybackAt]);

  const setVolume = useCallback((vol: number) => {
    setVolumeState(vol);
    if (gainRef.current) gainRef.current.gain.value = vol;
  }, []);

  // User interaction unlock (mobile)
  const unlock = useCallback(() => {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => console.log('[Audio] Context resumed'));
    }
  }, [getAudioCtx]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (sourceRef.current) {
        try { sourceRef.current.stop(); } catch {}
      }
      // Don't close AudioContext — reuse it
    };
  }, []);

  return {
    status,
    volume,
    setVolume,
    play,
    pause,
    seekTo,
    unlock,
    getCurrentPosition,
    duration: trackDurationRef.current,
  };
}
