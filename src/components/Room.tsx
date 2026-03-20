import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import useRoom from '../hooks/useRoom';
import { useClockOffset } from '../hooks/useClockOffset';
import { useAudioSync } from '../hooks/useAudioSync';
import { getSocket } from '../lib/socket';
import { Onboarding } from './Onboarding';
import { RoomHeader } from './room/RoomHeader';
import { PlayerSection } from './room/PlayerSection';
import { DrawerPanel } from './room/DrawerPanel';
import { ShareModal } from './room/ShareModal';
import { ShareCard } from './room/ShareCard';
import { Track } from '../lib/types';
import { MoodBackground } from './room/MoodBackground';

// Maps reaction IDs (from PlayerSection REACTIONS) to mood types
const REACTION_TO_MOOD: Record<string, string> = {
  'fire': 'fire',
  'heart': 'heart',
  'clap': 'clap',
  'music': 'music',
  'spark': 'spark',
};

const REACTION_EMOJI: Record<string, string> = {
  'fire': '🔥',
  'heart': '❤️',
  'clap': '⭐',
  'music': '🎵',
  'spark': '✨',
};

const REACTION_COLORS: Record<string, string> = {
  'fire': '#FF6B35',
  'heart': '#FF2D78',
  'clap': '#FFD700',
  'music': '#7B68EE',
  'spark': '#00D4FF',
};

interface RoomProps {
  roomId: string;
  userName: string;
  onLeave: () => void;
  roomType?: 'public' | 'private';
  roomPassword?: string;
  initialAllowGuestQueue?: boolean;
}

export const Room: React.FC<RoomProps> = ({ roomId, userName, onLeave, roomType, roomPassword, initialAllowGuestQueue }) => {
  const [userId] = useState(() => {
    let id = localStorage.getItem('soound_user_id');
    if (!id) {
      id = Math.random().toString(36).substring(2, 15);
      localStorage.setItem('soound_user_id', id);
    }
    return id;
  });

  const {
    isHost,
    userCount,
    users,
    currentTrack,
    isPlaying,
    queue,
    toast,
    reactions,
    messages,
    allowGuestQueue,
    emit,
    showToast,
    liveStatus,
    liveUrl,
    liveError,
    liveCurrentTime,
  } = useRoom(roomId, userId, userName, {
    isPrivate: roomType === 'private',
    password: roomPassword,
    allowGuestQueue: initialAllowGuestQueue,
  });

  const [isLoading, setIsLoading] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return localStorage.getItem('soound_onboarding_completed') !== 'true';
  });

  const [showShareModal, setShowShareModal] = useState(false);
  const [showShareCard, setShowShareCard] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'search' | 'queue' | 'users' | 'chat'>('search');
  
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [trackNotification, setTrackNotification] = useState<string | null>(null);
  const [moodScores, setMoodScores] = useState<Record<string, number>>({});
  const prevReactionsLen = useRef(0);

  // Track reactions → mood scores
  useEffect(() => {
    if (reactions.length > prevReactionsLen.current) {
      const newReactions = reactions.slice(prevReactionsLen.current);
      setMoodScores(prev => {
        const next = { ...prev };
        for (const r of newReactions) {
          const mood = REACTION_TO_MOOD[r.emoji];
          if (mood) next[mood] = (next[mood] || 0) + 1;
        }
        return next;
      });
    }
    prevReactionsLen.current = reactions.length;
  }, [reactions]);

  // Decay mood scores
  useEffect(() => {
    const interval = setInterval(() => {
      setMoodScores(prev => {
        const next: Record<string, number> = {};
        let hasValue = false;
        for (const [k, v] of Object.entries(prev) as [string, number][]) {
          const decayed = v * 0.85;
          if (decayed > 0.1) { next[k] = decayed; hasValue = true; }
        }
        return hasValue ? next : prev;
      });
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const hasMood = (Object.values(moodScores) as number[]).reduce((a, b) => a + b, 0) > 1;

  const handleEnded = useCallback(() => {
    if (isHost) {
      emit.playNext();
    }
  }, [isHost, emit]);

  // === New sync engine: NTP clock + Web Audio API ===
  const { sync: syncClock, serverNow } = useClockOffset();
  const {
    loadTrack, schedulePlay, pause: audioPause, checkDrift,
    unlockAudio, getPosition, getDuration, setVolume, isPlayingRef: audioIsPlayingRef,
  } = useAudioSync({ serverNow });

  const [syncStatus, setSyncStatus] = useState<string>('idle');
  const [audioStatus, setAudioStatus] = useState<string>('idle');
  const [audioStatusMsg, setAudioStatusMsg] = useState<string | undefined>();
  const [volume, setVolumeState] = useState(1);
  const trackLoadedRef = useRef(false);
  const positionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync clock on mount
  useEffect(() => {
    syncClock().catch(console.error);
  }, [syncClock]);

  // Position tracking interval
  useEffect(() => {
    positionIntervalRef.current = setInterval(() => {
      const pos = getPosition();
      const dur = getDuration();
      if (pos !== null) {
        setCurrentTime(pos);
        setDuration(dur);
      }
    }, 250);
    return () => { if (positionIntervalRef.current) clearInterval(positionIntervalRef.current); };
  }, [getPosition, getDuration]);

  // Load track when liveUrl changes
  useEffect(() => {
    if (!liveUrl) {
      setSyncStatus('idle');
      trackLoadedRef.current = false;
      return;
    }

    setSyncStatus('loading');
    setAudioStatus('loading');
    trackLoadedRef.current = false;

    loadTrack(liveUrl).then(() => {
      trackLoadedRef.current = true;
      setSyncStatus('ready');
      setAudioStatus('ready');
      console.log('[Room] Track loaded and decoded');
    }).catch(err => {
      console.error('[Room] Track load error:', err);
      setSyncStatus('error');
      setAudioStatus('error');
      setAudioStatusMsg(err.message);
    });
  }, [liveUrl, loadTrack]);

  // Socket events for sync
  useEffect(() => {
    const socket = getSocket();

    const handleScheduledPlay = (data: { position: number; serverStartTime: number; serverTime: number }) => {
      console.log('[Room] scheduled_play:', data);
      if (!trackLoadedRef.current) {
        console.warn('[Room] Track not loaded yet, ignoring play');
        return;
      }
      schedulePlay(data.serverStartTime, data.position);
      setSyncStatus('playing');
      setAudioStatus('playing');
    };

    const handleScheduledPause = (data: { position: number; serverTime: number }) => {
      console.log('[Room] scheduled_pause:', data);
      audioPause();
      setSyncStatus('paused');
      setAudioStatus('paused');
    };

    const handleScheduledSeek = (data: { position: number; serverStartTime: number; serverTime: number }) => {
      console.log('[Room] scheduled_seek:', data);
      if (audioIsPlayingRef.current && trackLoadedRef.current) {
        schedulePlay(data.serverStartTime, data.position);
      }
    };

    const handleHeartbeat = (data: { serverTime: number; trackPosition: number }) => {
      if (audioIsPlayingRef.current) {
        checkDrift({ serverTime: data.serverTime, trackPosition: data.trackPosition });
      }
    };

    // Also handle legacy sync_play for late joiners
    const handleSyncPlay = (data: { scheduledTime: number; position: number }) => {
      console.log('[Room] sync_play (late join):', data);
      if (!trackLoadedRef.current) return;
      schedulePlay(data.scheduledTime, data.position);
      setSyncStatus('playing');
      setAudioStatus('playing');
    };

    socket.on('scheduled_play', handleScheduledPlay);
    socket.on('scheduled_pause', handleScheduledPause);
    socket.on('scheduled_seek', handleScheduledSeek);
    socket.on('heartbeat', handleHeartbeat);
    socket.on('sync_play', handleSyncPlay);

    return () => {
      socket.off('scheduled_play', handleScheduledPlay);
      socket.off('scheduled_pause', handleScheduledPause);
      socket.off('scheduled_seek', handleScheduledSeek);
      socket.off('heartbeat', handleHeartbeat);
      socket.off('sync_play', handleSyncPlay);
    };
  }, [schedulePlay, audioPause, checkDrift, audioIsPlayingRef]);

  // Dummy audioRef for components that need it
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (currentTrack) {
        setIsLoading(false);
        setTrackNotification(currentTrack.title);
        const t = setTimeout(() => setTrackNotification(null), 3000);
        return () => clearTimeout(t);
    }
  }, [currentTrack]);

  // Auto-play when track is ready (for host)
  useEffect(() => {
    console.log('[Room] Auto-play check - isHost:', isHost, 'syncStatus:', syncStatus, 'currentTrack:', !!currentTrack, 'liveUrl:', !!liveUrl);
    
    if (isHost && currentTrack && syncStatus === 'ready' && liveUrl && trackLoadedRef.current) {
      console.log('[Room] Auto-playing track for host...');
      const timer = setTimeout(() => {
        const socket = getSocket();
        socket.emit('simple_play', { position: 0 });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isHost, currentTrack, syncStatus, liveUrl]);

  // Track listener's local audio state
  const [localAudioBlocked, setLocalAudioBlocked] = useState(false);
  const [localPlaying, setLocalPlaying] = useState(false);

  // Detect autoplay failures
  useEffect(() => {
    // Detect if AudioContext is suspended (autoplay blocked)
    if (!isHost && syncStatus === 'ready' && isPlaying) {
      setLocalAudioBlocked(true);
    }
    if (syncStatus === 'playing') {
      setLocalAudioBlocked(false);
      setLocalPlaying(true);
    } else {
      setLocalPlaying(false);
    }
  }, [isHost, syncStatus, isPlaying]);

  // MediaSession API — show track info on lock screen / notification area
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: 'Soound',
      artwork: currentTrack.cover ? [
        { src: currentTrack.cover, sizes: '512x512', type: 'image/jpeg' },
      ] : [],
    });

    if (isHost) {
      navigator.mediaSession.setActionHandler('play', () => {
        getSocket().emit('simple_play', { position: getPosition() || 0 });
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        getSocket().emit('simple_pause', { position: getPosition() || 0 });
      });
      navigator.mediaSession.setActionHandler('nexttrack', queue.length > 0 ? () => emit.playNext() : null);
      navigator.mediaSession.setActionHandler('previoustrack', () => getSocket().emit('simple_seek', { position: 0 }));
    }

    return () => {
      try {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
      } catch {}
    };
  }, [currentTrack, isHost, queue.length]);

  // Sync is now handled by scheduledTime in useSync (sync_play/sync_pause events)
  // No need for isPlaying-based audio control here

  const handlePlayPause = () => {
    console.log('[Room] handlePlayPause - isHost:', isHost, 'syncStatus:', syncStatus, 'audioPlaying:', audioIsPlayingRef.current);
    
    // Unlock AudioContext on user gesture (mobile requirement)
    unlockAudio();
    
    if (!isHost) {
      // Listener can't control playback — but can unlock audio
      if (localAudioBlocked) {
        setLocalAudioBlocked(false);
        // Request sync to get current position
        getSocket().emit('request_sync');
      }
      return;
    }
    
    // Host: toggle play/pause
    const socket = getSocket();
    if (audioIsPlayingRef.current) {
      const pos = getPosition() || 0;
      socket.emit('simple_pause', { position: pos });
    } else {
      const pos = getPosition() || 0;
      socket.emit('simple_play', { position: pos });
    }
  };

  // Keyboard shortcuts (space = play/pause, arrow keys = seek)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.code === 'Space') {
        e.preventDefault();
        handlePlayPause();
      } else if (e.code === 'ArrowRight' && isHost) {
        e.preventDefault();
        const pos = getPosition() || 0;
        getSocket().emit('simple_seek', { position: Math.min(pos + 10, duration || 0) });
      } else if (e.code === 'ArrowLeft' && isHost) {
        e.preventDefault();
        const pos = getPosition() || 0;
        getSocket().emit('simple_seek', { position: Math.max(pos - 10, 0) });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isHost, isPlaying, liveUrl]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (isHost) {
      const socket = getSocket();
      socket.emit('simple_seek', { position: time });
    }
  };

  // Resolve Spotify track to YouTube videoId
  const resolveSpotifyTrack = async (trackData: any): Promise<string | null> => {
    if (trackData.youtubeId) return trackData.youtubeId;
    if (!trackData.spotifyId) return trackData.id;

    try {
      const params = new URLSearchParams({
        artist: trackData.artist || '',
        title: trackData.title || '',
        duration: String(trackData.durationMs || trackData.duration * 1000 || 0),
      });
      const res = await fetch(`/api/resolve-spotify?${params}`);
      if (!res.ok) throw new Error('Resolve failed');
      const data = await res.json();
      return data.videoId;
    } catch (e) {
      console.error('Failed to resolve Spotify track:', e);
      return null;
    }
  };

  const handleSelectTrack = async (trackData: any) => {
    showToast(`Loading: ${trackData.title}...`);
    
    const videoId = await resolveSpotifyTrack(trackData);
    if (!videoId) {
      showToast("Failed to find track on YouTube");
      return;
    }

    const newTrack: Track = {
      id: videoId,
      title: trackData.title,
      artist: trackData.artist,
      url: `/api/stream/${videoId}`,
      cover: trackData.cover,
      duration: trackData.duration || 0,
      source: trackData.spotifyId ? 'spotify' : 'youtube',
      youtubeId: videoId,
      spotifyId: trackData.spotifyId,
    };

    if (isHost) {
      emit.changeTrack(newTrack);
      showToast(`Now playing: ${newTrack.title}`);
    } else {
      emit.addToQueue(newTrack);
      showToast("Added to queue");
    }
    setIsDrawerOpen(false);
  };
  
  const handleAddToQueue = async (trackData: any) => {
    showToast(`Resolving: ${trackData.title}...`);
    
    const videoId = await resolveSpotifyTrack(trackData);
    if (!videoId) {
      showToast("Failed to find track");
      return;
    }

    const newTrack: Track = {
      id: videoId,
      title: trackData.title,
      artist: trackData.artist,
      url: `/api/stream/${videoId}`,
      cover: trackData.cover,
      duration: trackData.duration || 0,
      source: trackData.spotifyId ? 'spotify' : 'youtube',
      youtubeId: videoId,
      spotifyId: trackData.spotifyId,
    };
    emit.addToQueue(newTrack);
    showToast("Added to queue");
  };

  const openDrawer = (tab: 'search' | 'queue' | 'users' | 'chat') => {
    setDrawerTab(tab);
    setIsDrawerOpen(true);
  };

  return (
    <>
      {showOnboarding && <Onboarding onComplete={() => {
        setShowOnboarding(false);
        localStorage.setItem('soound_onboarding_completed', 'true');
      }} />}

      <div className="fixed inset-0 bg-black flex flex-col overflow-hidden">
        <AnimatePresence>
          {isLoading && !currentTrack && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            >
              <div className="flex flex-col items-center gap-6">
                <div className="w-48 h-48 rounded-full skeleton" />
                <div className="w-40 h-6 rounded-full skeleton" />
                <div className="w-24 h-4 rounded-full skeleton" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <MoodBackground moodScores={moodScores} />
        <div className="absolute inset-0 z-[1] transition-opacity duration-1000" style={{ opacity: hasMood ? 0.15 : 0.3 }}>
          {currentTrack?.cover && (
            <div
              className="absolute inset-0 bg-cover bg-center blur-[80px] saturate-150 will-change-auto"
              style={{ backgroundImage: `url(${currentTrack.cover})` }}
            />
          )}
          <div className="absolute inset-0 bg-black/60" />
        </div>

        <div className="absolute bottom-24 left-0 right-0 h-40 z-20 pointer-events-none overflow-hidden">
          <AnimatePresence>
            {reactions.map((reaction) => (
              <motion.div
                key={reaction.id}
                initial={{ opacity: 0, y: 80, scale: 0.5 }}
                animate={{ opacity: [0, 1, 0], y: -80, scale: 1.2 }}
                transition={{ duration: 2, ease: "easeOut" }}
                className="absolute text-2xl"
                style={{ left: `${reaction.x}%`, color: REACTION_COLORS[reaction.emoji] || '#fff' }}
              >
                {REACTION_EMOJI[reaction.emoji] || reaction.emoji}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="absolute top-24 left-1/2 -translate-x-1/2 z-50 bg-white text-black px-6 py-3 rounded-full font-display font-bold text-sm shadow-2xl"
            >
              {toast}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {trackNotification && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="absolute top-1/3 left-1/2 -translate-x-1/2 z-50 bg-black/80 backdrop-blur-md text-white px-8 py-4 rounded-2xl font-display font-bold text-lg shadow-2xl border border-white/10 text-center max-w-[80vw] pointer-events-none"
            >
              🎵 {trackNotification}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Unified listener overlay — shows status progression */}
        <AnimatePresence>
          {!isHost && (liveStatus === 'loading' || liveStatus === 'error' || audioStatus === 'loading' || audioStatus === 'buffering' || localAudioBlocked) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm"
              onClick={() => {
                // Always try to play when user taps the overlay
                handlePlayPause();
              }}
            >
              <motion.div
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                className="flex flex-col items-center gap-5"
              >
                {/* Status icon — spinner or play button */}
                {(liveStatus === 'loading' || audioStatus === 'loading' || audioStatus === 'buffering') ? (
                  <div className="w-20 h-20 rounded-full glass-panel flex items-center justify-center">
                    <div className="w-10 h-10 border-3 border-white/10 border-t-white/60 rounded-full animate-spin" />
                  </div>
                ) : liveStatus === 'error' ? (
                  <div className="w-20 h-20 rounded-full glass-panel flex items-center justify-center">
                    <svg viewBox="0 0 24 24" className="w-8 h-8 text-red-400"><path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>
                  </div>
                ) : (
                  <div className="w-20 h-20 rounded-full glass-play-btn flex items-center justify-center shadow-[0_0_40px_rgba(255,255,255,0.2)] btn-press">
                    <svg viewBox="0 0 24 24" className="w-8 h-8 text-black ml-1"><path d="M6 4L20 12L6 20V4Z" fill="currentColor"/></svg>
                  </div>
                )}

                {/* Status text */}
                <div className="text-center">
                  {liveStatus === 'loading' && (
                    <>
                      <p className="font-display font-bold text-white/50 text-lg">Loading track...</p>
                      <p className="text-white/30 text-sm mt-1">Preparing the stream</p>
                    </>
                  )}
                  {liveStatus === 'error' && (
                    <>
                      <p className="font-display font-bold text-red-300 text-lg">Failed to load</p>
                      <p className="text-white/30 text-sm mt-1">{liveError || 'Try another track'}</p>
                    </>
                  )}
                  {liveStatus !== 'loading' && liveStatus !== 'error' && (audioStatus === 'loading' || audioStatus === 'buffering') && (
                    <>
                      <p className="font-display font-bold text-white/50 text-lg">Connecting...</p>
                      <p className="text-white/30 text-sm mt-1">{audioStatusMsg || 'Buffering stream'}</p>
                    </>
                  )}
                  {liveStatus !== 'loading' && liveStatus !== 'error' && audioStatus !== 'loading' && audioStatus !== 'buffering' && localAudioBlocked && (
                    <>
                      <p className="font-display font-bold text-white text-lg">Tap to Listen</p>
                      <p className="text-white/40 text-sm mt-1">Music is ready to play</p>

                    </>
                  )}
                </div>

                {/* Progress dots */}
                <div className="flex gap-2 mt-2">
                  <div className={`w-2 h-2 rounded-full transition-colors duration-500 ${liveStatus !== 'idle' ? 'bg-white' : 'bg-white/20'}`} />
                  <div className={`w-2 h-2 rounded-full transition-colors duration-500 ${liveStatus === 'ready' || liveStatus === 'playing' || audioStatus === 'loading' || audioStatus === 'buffering' || audioStatus === 'playing' || audioStatus === 'paused' ? 'bg-white' : 'bg-white/20'}`} />
                  <div className={`w-2 h-2 rounded-full transition-colors duration-500 ${audioStatus === 'playing' || audioStatus === 'paused' || localAudioBlocked ? 'bg-white' : 'bg-white/20'}`} />
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Host loading overlay */}
        <AnimatePresence>
          {isHost && liveStatus === 'loading' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            >
              <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="flex flex-col items-center gap-4">
                <div className="w-16 h-16 border-4 border-white/10 border-t-white/60 rounded-full animate-spin" />
                <p className="font-display font-bold text-white text-lg">Loading track...</p>
                <p className="text-white/40 text-sm">Converting for streaming</p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <RoomHeader
          roomId={roomId}
          userCount={userCount}
          queueCount={queue.length}
          isHost={isHost}
          onLeave={onLeave}
          onOpenDrawer={openDrawer}
          onOpenShare={() => setShowShareModal(true)}
          onOpenShareCard={() => setShowShareCard(true)}
        />

        {/* Web Audio sync — no mode switcher needed */}

        <PlayerSection
          currentTrack={currentTrack}
          isPlaying={syncStatus === 'playing'}
          currentTime={isHost ? currentTime : liveCurrentTime}
          duration={duration}
          volume={volume}
          isHost={isHost}
          queueCount={queue.length}
          audioElement={audioRef.current}
          onPlayPause={handlePlayPause}
          onSeek={handleSeek}
          onVolumeChange={(e) => { const v = parseFloat(e.target.value); setVolumeState(v); setVolume(v); }}
          onPlayNext={() => emit.playNext()}
          onPlayPrev={() => getSocket().emit('simple_seek', { position: 0 })}
          onShowToast={showToast}
          onSendReaction={(emoji) => emit.reaction(emoji)}
          onOpenSearch={() => openDrawer('search')}
          audioStatus={audioStatus}
          audioStatusMsg={audioStatusMsg}
        />

        <ShareModal isOpen={showShareModal} onClose={() => setShowShareModal(false)} roomId={roomId} />
        <ShareCard
          isOpen={showShareCard}
          onClose={() => setShowShareCard(false)}
          currentTrack={currentTrack}
          roomId={roomId}
          userName={userName}
          userCount={userCount}
          moodLabel={(() => {
            const labels: Record<string, string> = { fire: '🔥 On Fire', heart: '💗 Lovely', clap: '⭐ Stellar', music: '🎵 Vibing', spark: '✨ Electric' };
            let top = '', topScore = 0;
            for (const [k, v] of Object.entries(moodScores) as [string, number][]) {
              if (v > topScore && v > 3) { top = k; topScore = v; }
            }
            return top ? labels[top] : undefined;
          })()}
        />

        <DrawerPanel
            isOpen={isDrawerOpen}
            onClose={() => setIsDrawerOpen(false)}
            initialTab={drawerTab}
            isHost={isHost}
            queue={queue}
            users={users}
            userCount={userCount}
            messages={messages}
            currentUserId={userId}
            onSelectTrack={handleSelectTrack}
            onAddToQueue={handleAddToQueue}
            onRemoveFromQueue={(index) => emit.removeFromQueue(index)}
            onSendMessage={(text) => emit.sendMessage(text)}
            allowGuestQueue={allowGuestQueue}
            onToggleGuestQueue={() => emit.toggleGuestQueue()}
        />
        
        {/* Web Audio API — no <audio> element needed */}
      </div>
    </>
  );
};
