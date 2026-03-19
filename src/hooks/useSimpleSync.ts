/**
 * useSimpleSync — Dead simple audio sync
 * 
 * Host is the source of truth. Host broadcasts position every 500ms.
 * Listeners seek to that position. That's it.
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { getSocket } from '../lib/socket';

export type SyncStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'error';

interface SimpleSyncOptions {
  roomId: string;
  trackUrl: string | null;
  isHost: boolean;
  onTimeUpdate: (time: number, duration: number) => void;
  onEnded: () => void;
  onStatusChange: (status: SyncStatus, msg?: string) => void;
}

export function useSimpleSync({
  roomId,
  trackUrl,
  isHost,
  onTimeUpdate,
  onEnded,
  onStatusChange,
}: SimpleSyncOptions) {
  const socket = getSocket();
  
  const [status, setStatusState] = useState<SyncStatus>('idle');
  const [volume, setVolumeState] = useState(1);
  
  // Audio element — simple HTML5 audio
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);
  const lastSyncRef = useRef(0);
  
  // Callback refs
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onEndedRef = useRef(onEnded);
  const onStatusChangeRef = useRef(onStatusChange);
  onTimeUpdateRef.current = onTimeUpdate;
  onEndedRef.current = onEnded;
  onStatusChangeRef.current = onStatusChange;

  const setStatus = useCallback((s: SyncStatus, msg?: string) => {
    setStatusState(s);
    onStatusChangeRef.current(s, msg);
  }, []);

  // === Create audio element ===
  useEffect(() => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.crossOrigin = 'anonymous';
      
      // iOS: allow playback in silent mode
      (audio as any).playsInline = true;
      (audio as any).webkitPlaysInline = true;
      
      audioRef.current = audio;
    }
    
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    };
  }, []);

  // === Load track ===
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !trackUrl) {
      setStatus('idle');
      return;
    }

    setStatus('loading', 'Loading track...');
    
    audio.src = trackUrl;
    audio.load();

    const onCanPlay = () => {
      console.log('[SimpleSync] Track ready');
      setStatus('ready');
    };

    const onError = (e: Event) => {
      console.error('[SimpleSync] Load error:', e);
      setStatus('error', 'Failed to load track');
    };

    const onEnded = () => {
      console.log('[SimpleSync] Track ended');
      isPlayingRef.current = false;
      setStatus('ready');
      onEndedRef.current();
    };

    const onTimeUpdateEvent = () => {
      if (audio) {
        onTimeUpdateRef.current(audio.currentTime, audio.duration || 0);
      }
    };

    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('error', onError);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('timeupdate', onTimeUpdateEvent);

    return () => {
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('timeupdate', onTimeUpdateEvent);
    };
  }, [trackUrl, setStatus]);

  // === Host: broadcast position every 500ms ===
  useEffect(() => {
    if (!isHost) return;

    const interval = setInterval(() => {
      const audio = audioRef.current;
      if (!audio || !isPlayingRef.current) return;
      
      socket.emit('host_time', {
        position: audio.currentTime,
        duration: audio.duration || 0,
        isPlaying: isPlayingRef.current,
      });
    }, 500);

    return () => clearInterval(interval);
  }, [isHost, socket]);

  // === Listener: receive host position and sync ===
  useEffect(() => {
    if (isHost) return;

    const handleHostTime = (data: { position: number; duration: number; isPlaying: boolean }) => {
      const audio = audioRef.current;
      if (!audio) return;

      // Update playing state
      if (data.isPlaying && !isPlayingRef.current) {
        audio.play().catch(() => {});
        isPlayingRef.current = true;
        setStatus('playing');
      } else if (!data.isPlaying && isPlayingRef.current) {
        audio.pause();
        isPlayingRef.current = false;
        setStatus('paused');
      }

      // Sync position if drifted more than 0.5s
      const drift = Math.abs(audio.currentTime - data.position);
      if (drift > 0.5 && data.isPlaying) {
        // Add small buffer to compensate for network latency
        const targetPos = data.position + 0.2;
        console.log(`[SimpleSync] Drift ${drift.toFixed(2)}s, seeking to ${targetPos.toFixed(2)}`);
        audio.currentTime = Math.min(targetPos, audio.duration || targetPos);
        lastSyncRef.current = Date.now();
      }
    };

    // Also handle play/pause commands directly
    const handleSimplePlay = (data: { position: number }) => {
      const audio = audioRef.current;
      if (!audio) return;
      
      audio.currentTime = data.position;
      audio.play().then(() => {
        isPlayingRef.current = true;
        setStatus('playing');
      }).catch((e) => {
        console.log('[SimpleSync] Play blocked, need user gesture');
        setStatus('ready', 'Tap to play');
      });
    };

    const handleSimplePause = (data: { position: number }) => {
      const audio = audioRef.current;
      if (!audio) return;
      
      audio.pause();
      audio.currentTime = data.position;
      isPlayingRef.current = false;
      setStatus('paused');
    };

    const handleSimpleSeek = (data: { position: number }) => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = data.position;
    };

    socket.on('host_time', handleHostTime);
    socket.on('simple_play', handleSimplePlay);
    socket.on('simple_pause', handleSimplePause);
    socket.on('simple_seek', handleSimpleSeek);

    return () => {
      socket.off('host_time', handleHostTime);
      socket.off('simple_play', handleSimplePlay);
      socket.off('simple_pause', handleSimplePause);
      socket.off('simple_seek', handleSimpleSeek);
    };
  }, [isHost, socket, setStatus]);

  // === Public API ===
  const play = useCallback((position?: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    if (position !== undefined) {
      audio.currentTime = position;
    }

    audio.play().then(() => {
      isPlayingRef.current = true;
      setStatus('playing');
      
      if (isHost) {
        socket.emit('simple_play', { position: audio.currentTime });
      }
    }).catch((e) => {
      console.log('[SimpleSync] Play failed:', e);
      setStatus('ready', 'Tap to play');
    });
  }, [isHost, socket, setStatus]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.pause();
    isPlayingRef.current = false;
    setStatus('paused');

    if (isHost) {
      socket.emit('simple_pause', { position: audio.currentTime });
    }
  }, [isHost, socket, setStatus]);

  const seekTo = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.currentTime = time;

    if (isHost) {
      socket.emit('simple_seek', { position: time });
    }
  }, [isHost, socket]);

  const setVolume = useCallback((vol: number) => {
    setVolumeState(vol);
    if (audioRef.current) audioRef.current.volume = vol;
  }, []);

  const unlock = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      // Play and immediately pause to unlock
      audio.play().then(() => audio.pause()).catch(() => {});
    }
  }, []);

  const getCurrentPosition = useCallback(() => {
    return audioRef.current?.currentTime || 0;
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
    duration: audioRef.current?.duration || 0,
    isPlaying: isPlayingRef.current,
    audioElement: audioRef.current,
  };
}
