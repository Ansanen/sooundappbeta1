import React, { useEffect, useCallback, useRef } from 'react';
import { getSocket } from '../lib/socket';

interface SyncOptions {
  isHost: boolean;
  isPlaying: boolean;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  onScheduledPlay?: (url: string, scheduledTime: number) => void;
  onScheduledPause?: () => void;
}

export function useSync({ isHost, isPlaying, audioRef, onScheduledPlay, onScheduledPause }: SyncOptions) {
  const socket = getSocket();
  const onScheduledPlayRef = useRef(onScheduledPlay);
  const onScheduledPauseRef = useRef(onScheduledPause);
  onScheduledPlayRef.current = onScheduledPlay;
  onScheduledPauseRef.current = onScheduledPause;

  // NTP-style time offset calculation
  const timeOffsetRef = useRef(0);

  // NTP: 10 pings, discard top/bottom 20% RTT, use median offset
  useEffect(() => {
    let pings = 0;
    const samples: { rtt: number; offset: number }[] = [];

    const doPing = () => {
      const t0 = Date.now();
      socket.emit('ntp_ping', { t0 });
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
        // Sort by RTT, discard top and bottom 20%
        samples.sort((a, b) => a.rtt - b.rtt);
        const trimmed = samples.slice(2, 8); // middle 60%
        // Average the remaining offsets
        const avgOffset = trimmed.reduce((sum, s) => sum + s.offset, 0) / trimmed.length;
        timeOffsetRef.current = avgOffset;
        console.log(`[Sync] Time offset: ${avgOffset.toFixed(0)}ms (from ${trimmed.length} samples, best RTT: ${samples[0].rtt}ms)`);
      }
    };

    socket.on('ntp_pong', handlePong);
    // Small delay before first ping to let socket stabilize
    const startTimeout = setTimeout(doPing, 200);

    // Re-sync every 20 seconds
    const interval = setInterval(() => { pings = 0; samples.length = 0; doPing(); }, 20000);

    return () => {
      socket.off('ntp_pong', handlePong);
      clearTimeout(startTimeout);
      clearInterval(interval);
    };
  }, [socket]);

  // Listen for sync_play — the key: everyone starts at the same scheduled moment
  useEffect(() => {
    const handleSyncPlay = (data: { scheduledTime: number; position: number }) => {
      const audio = audioRef.current;
      if (!audio || !audio.src) return;

      const localScheduledTime = data.scheduledTime - timeOffsetRef.current;

      const doPlay = () => {
        const now = Date.now();
        const delay = localScheduledTime - now;
        
        if (delay > 5) {
          // Pre-seek to position, then schedule precise play
          audio.currentTime = data.position;
          console.log(`[Sync] Seeking to ${data.position.toFixed(2)}s, playing in ${delay}ms`);
          
          setTimeout(() => {
            // Compensate for any drift during the wait
            const actualDelay = Date.now() - localScheduledTime;
            if (actualDelay > 0) {
              audio.currentTime = data.position + actualDelay / 1000;
            }
            audio.play().catch(() => {});
          }, delay);
        } else {
          // We're late or right on time
          const elapsed = Math.max(0, (now - localScheduledTime) / 1000);
          audio.currentTime = data.position + elapsed;
          audio.play().catch(() => {});
          console.log(`[Sync] Playing now (${elapsed > 0 ? `${(elapsed*1000).toFixed(0)}ms late` : 'on time'})`);
        }
      };

      // If audio not ready yet, wait for it
      if (audio.readyState >= 2) {
        doPlay();
      } else {
        console.log('[Sync] Waiting for audio to load...');
        audio.addEventListener('canplay', doPlay, { once: true });
      }
    };

    const handleSyncPause = (data: { position: number }) => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.pause();
      audio.currentTime = data.position;
      console.log(`[Sync] Paused at ${data.position.toFixed(2)}s`);
    };

    const handleSyncSeek = (data: { position: number; scheduledTime: number }) => {
      const audio = audioRef.current;
      if (!audio) return;
      const localTime = data.scheduledTime - timeOffsetRef.current;
      const delay = localTime - Date.now();

      setTimeout(() => {
        audio.currentTime = data.position;
        audio.play().catch(() => {});
      }, Math.max(0, delay));
    };

    socket.on('sync_play', handleSyncPlay);
    socket.on('sync_pause', handleSyncPause);
    socket.on('sync_seek', handleSyncSeek);

    return () => {
      socket.off('sync_play', handleSyncPlay);
      socket.off('sync_pause', handleSyncPause);
      socket.off('sync_seek', handleSyncSeek);
    };
  }, [audioRef, socket]);

  // Host: periodic position broadcast for late joiners
  useEffect(() => {
    if (!isHost || !isPlaying) return;
    const report = () => {
      const audio = audioRef.current;
      if (!audio || audio.paused) return;
      socket.emit('live_time', { currentTime: audio.currentTime, duration: audio.duration || 0 });
    };
    const interval = setInterval(report, 1000);
    return () => clearInterval(interval);
  }, [isHost, isPlaying, audioRef, socket]);

  // Late joiner sync: listen for live_time to correct drift
  useEffect(() => {
    if (isHost) return;
    const handleLiveTime = (data: { currentTime: number }) => {
      const audio = audioRef.current;
      if (!audio || audio.paused || !audio.duration) return;
      const drift = Math.abs(audio.currentTime - data.currentTime);
      if (drift > 0.5) {
        console.log(`[Sync] Late joiner drift ${drift.toFixed(1)}s, correcting`);
        audio.currentTime = data.currentTime;
      }
    };
    socket.on('live_time', handleLiveTime);
    return () => { socket.off('live_time', handleLiveTime); };
  }, [isHost, audioRef, socket]);

  const forceSync = useCallback(() => socket.emit('request_sync'), [socket]);
  return { forceSync, timeOffset: timeOffsetRef };
}
