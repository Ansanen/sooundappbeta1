/**
 * useRadioStream — Server-side streaming like internet radio
 * 
 * How it works:
 * 1. Server decodes audio and streams as chunked HTTP response
 * 2. All clients connect to same endpoint: /api/radio/{roomId}
 * 3. Server maintains one playback position for the room
 * 4. Clients just play the stream — no local seeking
 * 
 * Sync: Perfect (single source)
 * Latency: 1-3 seconds (HTTP buffering)
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { getSocket } from '../lib/socket';

export type RadioStatus = 'idle' | 'connecting' | 'buffering' | 'playing' | 'error';

interface RadioStreamOptions {
  roomId: string;
  isHost: boolean;
  onTimeUpdate: (time: number, duration: number) => void;
  onStatusChange: (status: RadioStatus, msg?: string) => void;
}

export function useRadioStream({
  roomId,
  isHost,
  onTimeUpdate,
  onStatusChange,
}: RadioStreamOptions) {
  const socket = getSocket();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [status, setStatusState] = useState<RadioStatus>('idle');
  const [volume, setVolumeState] = useState(1);
  const durationRef = useRef(0);
  const serverPositionRef = useRef(0);

  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onStatusChangeRef = useRef(onStatusChange);
  onTimeUpdateRef.current = onTimeUpdate;
  onStatusChangeRef.current = onStatusChange;

  const setStatus = useCallback((s: RadioStatus, msg?: string) => {
    setStatusState(s);
    onStatusChangeRef.current(s, msg);
  }, []);

  // Create audio element
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = 'none';
    }
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    };
  }, []);

  // Connect to radio stream
  const connect = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    setStatus('connecting', 'Connecting to stream...');
    
    // Add timestamp to prevent caching
    audio.src = `/api/radio/${roomId}?t=${Date.now()}`;
    audio.load();

    const onCanPlay = () => {
      setStatus('playing');
      audio.play().catch(() => {
        setStatus('error', 'Tap to listen');
      });
    };

    const onWaiting = () => setStatus('buffering', 'Buffering...');
    const onPlaying = () => setStatus('playing');
    const onError = () => setStatus('error', 'Stream error');

    audio.addEventListener('canplay', onCanPlay, { once: true });
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('error', onError);
    };
  }, [roomId, setStatus]);

  // Disconnect
  const disconnect = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = '';
    }
    setStatus('idle');
  }, [setStatus]);

  // Listen for server time updates (for progress bar)
  useEffect(() => {
    const handleRadioTime = (data: { currentTime: number; duration: number; isPlaying: boolean }) => {
      serverPositionRef.current = data.currentTime;
      durationRef.current = data.duration;
      onTimeUpdateRef.current(data.currentTime, data.duration);

      // Auto-connect when stream starts
      if (data.isPlaying && status === 'idle') {
        connect();
      }
      // Disconnect when stream stops
      if (!data.isPlaying && status === 'playing') {
        disconnect();
      }
    };

    socket.on('radio_time', handleRadioTime);
    return () => { socket.off('radio_time', handleRadioTime); };
  }, [socket, status, connect, disconnect]);

  // Host controls
  const play = useCallback((position?: number) => {
    socket.emit('radio_play', { position: position ?? 0 });
  }, [socket]);

  const pause = useCallback(() => {
    socket.emit('radio_pause');
  }, [socket]);

  const seekTo = useCallback((time: number) => {
    socket.emit('radio_seek', { position: time });
  }, [socket]);

  const setVolume = useCallback((vol: number) => {
    setVolumeState(vol);
    if (audioRef.current) audioRef.current.volume = vol;
  }, []);

  const unlock = useCallback(() => {
    audioRef.current?.play().catch(() => {});
  }, []);

  return {
    status,
    volume,
    setVolume,
    play,
    pause,
    seekTo,
    unlock,
    connect,
    disconnect,
    getCurrentPosition: () => serverPositionRef.current,
    duration: durationRef.current,
  };
}
