import { useRef, useEffect, useState, useCallback } from 'react';

export type AudioStatus = 'idle' | 'loading' | 'buffering' | 'playing' | 'paused' | 'error';

interface AudioPlayerOptions {
  liveUrl: string | null;
  isPlaying: boolean;
  isHost: boolean;
  onEnded: () => void;
  onTimeUpdate: (time: number) => void;
  onLoadedMetadata: (duration: number) => void;
  onStatusChange?: (status: AudioStatus, message?: string) => void;
}

export const useAudioPlayer = ({
  liveUrl,
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

  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  const setStatus = useCallback((s: AudioStatus, msg?: string) => {
    setStatusState(s);
    onStatusChangeRef.current?.(s, msg);
  }, []);

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.play()
      .then(() => setStatus('playing'))
      .catch(e => {
        if (e.name === 'NotAllowedError') {
          setStatus('paused', 'Tap to listen');
        } else {
          setStatus('error', 'Playback failed');
        }
      });
  }, [setStatus]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setStatus('paused');
  }, [setStatus]);

  const seekTo = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    try { audio.currentTime = time; } catch {}
  }, []);

  const setVolume = useCallback((vol: number) => {
    setVolumeState(vol);
    if (audioRef.current) audioRef.current.volume = vol;
  }, []);

  // Load audio when URL changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !liveUrl) {
      setStatus('idle');
      return;
    }

    console.log('[Audio] Loading:', liveUrl);
    setStatus('loading', 'Loading track...');
    audio.src = liveUrl;
    audio.load();

    const onCanPlay = () => {
      console.log('[Audio] Ready (loaded, waiting for sync event to play)');
      setStatus('paused', 'Ready');
      // Do NOT auto-play — sync_play event will trigger play at the right moment
    };

    const onError = () => {
      console.error('[Audio] Error:', audio.error?.code, audio.error?.message);
      setStatus('error', 'Failed to load');
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

  // Time/duration/ended
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => onTimeUpdate(audio.currentTime);
    const onMeta = () => onLoadedMetadata(audio.duration);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnded);
    };
  }, [onEnded, onTimeUpdate, onLoadedMetadata]);

  return { audioRef, volume, setVolume, play, pause, seekTo, status };
};
