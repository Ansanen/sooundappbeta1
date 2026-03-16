import { useRef, useEffect, useState, useCallback } from 'react';

export type AudioStatus = 'idle' | 'loading' | 'buffering' | 'playing' | 'paused' | 'error';

interface AudioPlayerOptions {
  liveUrl: string | null;
  initialSeekTo?: number;     // Seek to this position after loading (for late joiners)
  isPlaying: boolean;
  isHost: boolean;
  onEnded: () => void;
  onTimeUpdate: (time: number) => void;
  onLoadedMetadata: (duration: number) => void;
  onStatusChange?: (status: AudioStatus, message?: string) => void;
}

export const useAudioPlayer = ({
  liveUrl,
  initialSeekTo,
  isPlaying,
  isHost,
  onEnded,
  onTimeUpdate,
  onLoadedMetadata,
  onStatusChange,
}: AudioPlayerOptions) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [volume, setVolumeState] = useState(1);
  const [status, setStatusState] = useState<AudioStatus>('idle');
  const isLocalAction = useRef(false);
  const initialSeekRef = useRef(initialSeekTo);
  initialSeekRef.current = initialSeekTo;

  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  const setStatus = useCallback((s: AudioStatus, msg?: string) => {
    setStatusState(s);
    onStatusChangeRef.current?.(s, msg);
  }, []);

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    isLocalAction.current = true;
    audio.play()
      .then(() => { setStatus('playing'); })
      .catch(e => {
        if (e.name === 'NotAllowedError') {
          setStatus('paused', 'Tap play to listen');
        } else {
          setStatus('error', 'Playback failed');
        }
      })
      .finally(() => { setTimeout(() => { isLocalAction.current = false; }, 200); });
  }, [setStatus]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    isLocalAction.current = true;
    audio.pause();
    setStatus('paused');
    setTimeout(() => { isLocalAction.current = false; }, 200);
  }, [setStatus]);

  const seekTo = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    isLocalAction.current = true;
    audio.currentTime = time;
    setTimeout(() => { isLocalAction.current = false; }, 200);
  }, []);

  const setVolume = useCallback((vol: number) => {
    setVolumeState(vol);
    if (audioRef.current) audioRef.current.volume = vol;
  }, []);

  // === Live stream loading ===
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !liveUrl) {
      setStatus('idle');
      return;
    }

    console.log('[Audio] Loading live stream:', liveUrl);
    setStatus('loading', 'Connecting to stream...');

    audio.src = liveUrl;
    audio.load();

    const onCanPlay = () => {
      console.log('[Audio] Live stream ready');
      // Seek to current position for late joiners
      const seekPos = initialSeekRef.current;
      if (seekPos && seekPos > 1) {
        console.log(`[Audio] Seeking to ${seekPos.toFixed(1)}s`);
        audio.currentTime = seekPos;
      }
      audio.play()
        .then(() => setStatus('playing'))
        .catch(e => {
          if (e.name === 'NotAllowedError') {
            setStatus('paused', 'Tap play to listen');
          } else {
            setStatus('error', 'Playback failed');
          }
        });
    };

    const onError = (e: Event) => {
      const mediaErr = audio.error;
      console.error('[Audio] Stream error:', mediaErr?.code, mediaErr?.message);
      setStatus('error', 'Stream error — try again');
    };

    const onWaiting = () => setStatus('buffering', 'Buffering...');
    const onPlaying = () => setStatus('playing');

    audio.addEventListener('canplay', onCanPlay, { once: true });
    audio.addEventListener('error', onError);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);

    return () => {
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
    };
  }, [liveUrl, setStatus]);

  // === Audio element event listeners (time, duration, ended) ===
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => onTimeUpdate(audio.currentTime);
    const handleLoaded = () => onLoadedMetadata(audio.duration);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoaded);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoaded);
      audio.removeEventListener('ended', onEnded);
    };
  }, [onEnded, onTimeUpdate, onLoadedMetadata]);

  return {
    audioRef,
    volume,
    setVolume,
    play,
    pause,
    seekTo,
    status,
  };
};
