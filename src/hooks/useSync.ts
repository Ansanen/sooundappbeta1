import { useEffect, useCallback } from 'react';
import { getSocket } from '../lib/socket';

interface SyncOptions {
  isHost: boolean;
  isPlaying: boolean;
  audioRef: React.RefObject<HTMLAudioElement | null>;
}

export function useSync({ isHost, isPlaying, audioRef }: SyncOptions) {
  const socket = getSocket();

  // Host: report current time for listeners' progress bars
  useEffect(() => {
    if (!isHost || !isPlaying) return;
    
    const report = () => {
      const audio = audioRef.current;
      if (!audio || audio.paused) return;
      socket.emit('live_time', {
        currentTime: audio.currentTime,
        duration: audio.duration || 0,
      });
    };
    
    const interval = setInterval(report, 1000);
    return () => clearInterval(interval);
  }, [isHost, isPlaying, audioRef, socket]);

  const forceSync = useCallback(() => {}, []);
  return { forceSync };
}
