import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import useRoom from '../hooks/useRoom';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useSync } from '../hooks/useSync';
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
  const [drawerTab, setDrawerTab] = useState<'search' | 'queue' | 'users'>('search');
  
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
        for (const [k, v] of Object.entries(prev)) {
          const decayed = v * 0.85;
          if (decayed > 0.1) { next[k] = decayed; hasValue = true; }
        }
        return hasValue ? next : prev;
      });
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const hasMood = Object.values(moodScores).reduce((a, b) => a + b, 0) > 1;

  const handleEnded = useCallback(() => {
    if (isHost) {
      emit.playNext();
    }
  }, [isHost, emit]);

  const [audioStatus, setAudioStatus] = useState<string>('idle');
  const [audioStatusMsg, setAudioStatusMsg] = useState<string | undefined>();

  const { audioRef, volume, setVolume, play, pause, seekTo, status } = useAudioPlayer({
    liveUrl,
    initialSeekTo: isHost ? undefined : liveCurrentTime,
    isPlaying,
    isHost,
    onEnded: handleEnded,
    onTimeUpdate: setCurrentTime,
    onLoadedMetadata: setDuration,
    onStatusChange: (s, msg) => { setAudioStatus(s); setAudioStatusMsg(msg); },
  });

  useEffect(() => {
    if (currentTrack) {
        setIsLoading(false);
        setTrackNotification(currentTrack.title);
        const t = setTimeout(() => setTrackNotification(null), 3000);
        return () => clearTimeout(t);
    }
  }, [currentTrack]);

  // Direct sync: host broadcasts position, listeners correct
  const { forceSync } = useSync({
    isHost,
    isPlaying,
    audioRef,
  });

  // Track listener's local audio state
  const [localAudioBlocked, setLocalAudioBlocked] = useState(false);
  const [localPlaying, setLocalPlaying] = useState(false);

  // Detect autoplay failures
  useEffect(() => {
    if (!isHost && isPlaying && currentTrack && audioRef.current?.paused) {
      // Audio should be playing but is paused → likely autoplay blocked
      const timer = setTimeout(() => {
        if (audioRef.current?.paused && isPlaying) {
          setLocalAudioBlocked(true);
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
    if (!isPlaying || !currentTrack) {
      setLocalAudioBlocked(false);
    }
  }, [isHost, isPlaying, currentTrack]);

  // Track local audio element play/pause for UI
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setLocalPlaying(true);
    const onPause = () => setLocalPlaying(false);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, [audioRef.current]);

  const [debugInfo, setDebugInfo] = useState('');
  
  const handlePlayPause = () => {
    if (!isHost) {
      const audio = audioRef.current;
      if (!audio) { setDebugInfo('No audio element'); return; }
      
      const info = `src:${audio.src ? 'yes' : 'no'} ready:${audio.readyState} paused:${audio.paused} err:${audio.error?.code ?? 'none'} liveUrl:${liveUrl ? 'yes' : 'no'}`;
      setDebugInfo(info);
      console.log('[Play]', info);
      
      // If no src set, set it now from liveUrl
      if ((!audio.src || audio.src === window.location.href) && liveUrl) {
        audio.src = liveUrl;
        audio.load();
        audio.oncanplay = () => {
          audio.oncanplay = null;
          audio.play().then(() => {
            setLocalAudioBlocked(false);
            setDebugInfo('Playing!');
          }).catch((e) => {
            setDebugInfo(`play failed after load: ${e.name}: ${e.message}`);
          });
        };
        return;
      }
      
      if (audio.paused) {
        audio.play().then(() => {
          setLocalAudioBlocked(false);
          setDebugInfo('Playing!');
        }).catch((e) => {
          setDebugInfo(`play err: ${e.name}: ${e.message}`);
        });
      } else {
        audio.pause();
      }
      return;
    }
    // Host: control room AND local
    if (isPlaying) {
      emit.livePause();
      pause();
    } else {
      emit.livePlay(audioRef.current?.currentTime);
      play();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (isHost) {
      seekTo(time);
      emit.liveSeek(time);
    }
  };

  const handleSelectTrack = (trackData: any) => {
    const newTrack: Track = {
      id: trackData.youtubeId || trackData.id,
      title: trackData.title,
      artist: trackData.artist,
      url: `/api/stream/${trackData.youtubeId || trackData.id}`,
      cover: trackData.cover,
      duration: trackData.duration || 0,
      source: 'youtube',
      youtubeId: trackData.youtubeId || trackData.id,
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
  
  const handleAddToQueue = (trackData: any) => {
    const newTrack: Track = {
      id: trackData.youtubeId || trackData.id,
      title: trackData.title,
      artist: trackData.artist,
      url: `/api/stream/${trackData.youtubeId || trackData.id}`,
      cover: trackData.cover,
      duration: trackData.duration || 0,
      source: 'youtube',
      youtubeId: trackData.youtubeId || trackData.id,
    };
    emit.addToQueue(newTrack);
    showToast("Added to queue");
  };

  const openDrawer = (tab: 'search' | 'queue' | 'users') => {
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
                      {debugInfo && <p className="text-yellow-400 text-xs mt-2 max-w-[80vw] break-all">{debugInfo}</p>}
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

        <PlayerSection
          currentTrack={currentTrack}
          isPlaying={isHost ? isPlaying : localPlaying}
          currentTime={isHost ? currentTime : liveCurrentTime}
          duration={duration}
          volume={volume}
          isHost={isHost}
          queueCount={queue.length}
          audioElement={audioRef.current}
          onPlayPause={handlePlayPause}
          onSeek={handleSeek}
          onVolumeChange={(e) => setVolume(parseFloat(e.target.value))}
          onPlayNext={() => emit.playNext()}
          onPlayPrev={() => seekTo(0)}
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
            for (const [k, v] of Object.entries(moodScores)) {
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
            onSelectTrack={handleSelectTrack}
            onAddToQueue={handleAddToQueue}
            onRemoveFromQueue={(index) => emit.removeFromQueue(index)}
            allowGuestQueue={allowGuestQueue}
            onToggleGuestQueue={() => emit.toggleGuestQueue()}
        />
        
        <audio
          ref={audioRef}
          preload="auto"
          playsInline
        />
      </div>
    </>
  );
};
