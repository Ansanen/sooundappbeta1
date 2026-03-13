import React, { useState, useEffect, useRef } from 'react';
import { getSocket } from '../lib/socket';
import { DEFAULT_TRACKS } from '../lib/tracks';
import { Track } from '../lib/types';
import { IconPlay, IconPause, IconNext, IconPrev, IconSearch, IconUsers, IconVolume, IconQueue, IconPlus, IconHeart, IconChevronLeft, IconShare } from './CustomIcons';
import { CircularVisualizer } from './CircularVisualizer';
import { Onboarding } from './Onboarding';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { Loader2, X, Trash2, Crown } from 'lucide-react';

interface RoomProps {
  roomId: string;
  onLeave: () => void;
}

interface Reaction {
  id: string;
  emoji: string;
  x: number;
}

const Tonearm = ({ isPlaying, progress }: { isPlaying: boolean, progress: number }) => {
  const angle = isPlaying ? 20 + (progress * 15) : 0;
  return (
    <motion.div
      className="absolute top-[-5%] right-[-10%] w-[40%] h-[85%] z-20 pointer-events-none"
      style={{ transformOrigin: '50% 12.5%' }}
      animate={{ rotate: angle }}
      transition={{ type: "spring", stiffness: 40, damping: 15 }}
    >
      <svg viewBox="0 0 100 400" className="w-full h-full drop-shadow-2xl" style={{ filter: 'drop-shadow(0px 20px 15px rgba(0,0,0,0.6))' }}>
        {/* Pivot Base */}
        <circle cx="50" cy="50" r="25" fill="#18181b" stroke="#3f3f46" strokeWidth="2" />
        <circle cx="50" cy="50" r="12" fill="#09090b" />
        <circle cx="50" cy="50" r="4" fill="#71717a" />
        
        {/* Counterweight */}
        <rect x="35" y="5" width="30" height="20" rx="4" fill="#27272a" stroke="#18181b" strokeWidth="2" />
        <rect x="38" y="10" width="24" height="10" rx="2" fill="#3f3f46" />
        
        {/* Main Arm */}
        <path d="M 50 50 L 50 280" fill="none" stroke="#e4e4e7" strokeWidth="6" strokeLinecap="round" />
        
        {/* Angle to headshell */}
        <path d="M 50 278 L 30 320" fill="none" stroke="#e4e4e7" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        
        {/* Headshell */}
        <path d="M 20 315 L 40 325 L 32 360 L 12 350 Z" fill="#18181b" stroke="#3f3f46" strokeWidth="2" strokeLinejoin="round" />
        
        {/* Stylus needle */}
        <line x1="26" y1="340" x2="22" y2="345" stroke="#a1a1aa" strokeWidth="2" strokeLinecap="round" />
        {isPlaying && (
          <circle cx="22" cy="345" r="2" fill="#fff" filter="drop-shadow(0 0 4px #fff)" />
        )}
      </svg>
    </motion.div>
  );
};

export const Room: React.FC<RoomProps> = ({ roomId, onLeave }) => {
  const [userCount, setUserCount] = useState(1);
  const [hostId, setHostId] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track>(DEFAULT_TRACKS[0]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [copied, setCopied] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'search' | 'queue'>('search');
  const [toast, setToast] = useState<string | null>(null);
  
  // Queue & Reactions
  const [queue, setQueue] = useState<Track[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  
  // Onboarding state
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return localStorage.getItem('soound_onboarding_completed') !== 'true';
  });
  
  const [needsInteraction, setNeedsInteraction] = useState(false);

  const [userId] = useState(() => {
    let id = localStorage.getItem('soound_user_id');
    if (!id) {
      id = Math.random().toString(36).substring(2, 15);
      localStorage.setItem('soound_user_id', id);
    }
    return id;
  });

  const audioRef = useRef<HTMLAudioElement>(null);
  const socket = getSocket();
  const isLocalChange = useRef(false);
  const searchTimeout = useRef<number>();

  const isHost = userId === hostId;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const handleConnect = () => {
      socket.emit('join_room', { roomId, userId });
    };

    socket.on('connect', handleConnect);
    
    if (socket.connected) {
      socket.emit('join_room', { roomId, userId });
    } else {
      socket.emit('join_room', { roomId, userId });
    }

    socket.on('user_count', (count: number) => {
      setUserCount(count);
    });

    socket.on('room_state', (state: any) => {
      setHostId(state.hostId);
      if (state.currentTrack) {
        setCurrentTrack(state.currentTrack);
      }
      if (state.queue) {
        setQueue(state.queue);
      }
      
      if (audioRef.current) {
        let targetTime = state.currentTime;
        if (state.isPlaying) {
          const drift = (Date.now() - state.serverTime) / 1000;
          targetTime += drift;
        }
        
        audioRef.current.currentTime = targetTime;
        setCurrentTime(targetTime);
        
        if (state.isPlaying) {
          setIsPlaying(true);
          audioRef.current.play().then(() => {
            setNeedsInteraction(false);
          }).catch(e => {
            console.log("Autoplay prevented:", e);
            setNeedsInteraction(true);
          });
        } else {
          audioRef.current.pause();
          setIsPlaying(false);
        }
      }
    });

    socket.on('host_changed', (data: { hostId: string }) => {
      setHostId(data.hostId);
      showToast("You are now the host");
    });

    socket.on('play', (data: any) => {
      if (audioRef.current && !isLocalChange.current) {
        const drift = (Date.now() - data.serverTime) / 1000;
        audioRef.current.currentTime = data.currentTime + drift;
        setIsPlaying(true);
        audioRef.current.play().then(() => {
          setNeedsInteraction(false);
        }).catch(e => {
          console.log("Autoplay prevented:", e);
          setNeedsInteraction(true);
        });
      }
    });

    socket.on('pause', (data: any) => {
      if (audioRef.current && !isLocalChange.current) {
        audioRef.current.currentTime = data.currentTime;
        audioRef.current.pause();
        setIsPlaying(false);
      }
    });

    socket.on('seek', (data: any) => {
      if (audioRef.current && !isLocalChange.current) {
        const drift = isPlaying ? (Date.now() - data.serverTime) / 1000 : 0;
        audioRef.current.currentTime = data.currentTime + drift;
        setCurrentTime(data.currentTime + drift);
      }
    });

    socket.on('track_changed', (data: any) => {
      setCurrentTrack(data.track);
      setIsPlaying(false);
      setCurrentTime(0);
    });

    socket.on('queue_updated', (data: { queue: Track[] }) => {
      setQueue(data.queue);
    });

    socket.on('reaction', (data: Reaction) => {
      setReactions(prev => [...prev, data]);
      setTimeout(() => {
        setReactions(prev => prev.filter(r => r.id !== data.id));
      }, 3000);
    });

    return () => {
      socket.off('connect', handleConnect);
      socket.off('user_count');
      socket.off('room_state');
      socket.off('host_changed');
      socket.off('play');
      socket.off('pause');
      socket.off('seek');
      socket.off('track_changed');
      socket.off('queue_updated');
      socket.off('reaction');
    };
  }, [roomId]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Search effect
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current);
    }

    searchTimeout.current = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(searchQuery)}&media=music&limit=15`);
        const data = await res.json();
        const tracks: Track[] = data.results.map((t: any) => ({
          id: t.trackId.toString(),
          title: t.trackName,
          artist: t.artistName,
          url: t.previewUrl,
          cover: t.artworkUrl100.replace('100x100', '600x600')
        })).filter((t: Track) => t.url);
        setSearchResults(tracks);
      } catch (error) {
        console.error("Search failed:", error);
      } finally {
        setIsSearching(false);
      }
    }, 500);

    return () => clearTimeout(searchTimeout.current);
  }, [searchQuery]);

  const handlePlayPause = () => {
    if (!isHost || !audioRef.current) return;
    
    isLocalChange.current = true;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      socket.emit('pause', { currentTime: audioRef.current.currentTime, userId });
    } else {
      setIsPlaying(true);
      audioRef.current.play().then(() => {
        setNeedsInteraction(false);
      }).catch(e => {
        console.log("Play prevented:", e);
        setNeedsInteraction(true);
      });
      socket.emit('play', { currentTime: audioRef.current.currentTime, userId });
    }
    
    setTimeout(() => {
      isLocalChange.current = false;
    }, 100);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isHost || !audioRef.current) return;
    
    const time = parseFloat(e.target.value);
    isLocalChange.current = true;
    audioRef.current.currentTime = time;
    setCurrentTime(time);
    
    socket.emit('seek', { currentTime: time, userId });
    
    setTimeout(() => {
      isLocalChange.current = false;
    }, 100);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current && !isLocalChange.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    if (isHost && queue.length > 0) {
      socket.emit('play_next', { userId });
    }
  };

  const playNext = () => {
    if (isHost && queue.length > 0) {
      socket.emit('play_next', { userId });
    }
  };

  const playPrev = () => {
    if (!isHost || !audioRef.current) return;
    isLocalChange.current = true;
    audioRef.current.currentTime = 0;
    setCurrentTime(0);
    socket.emit('seek', { currentTime: 0, userId });
    setTimeout(() => {
      isLocalChange.current = false;
    }, 100);
  };

  const changeTrack = (track: Track) => {
    if (!isHost) return;
    setCurrentTrack(track);
    socket.emit('change_track', { track, userId });
  };

  const handleTrackClick = (track: Track) => {
    if (isHost) {
      changeTrack(track);
    } else {
      addToQueue(track);
      showToast(`Added to queue`);
    }
  };

  const addToQueue = (track: Track) => {
    socket.emit('add_to_queue', { track });
    if (isHost) showToast(`Added to queue`);
  };

  const removeFromQueue = (index: number) => {
    socket.emit('remove_from_queue', { index });
  };

  const sendReaction = (emoji: string) => {
    socket.emit('reaction', { emoji });
  };

  const copyRoomLink = () => {
    const url = `${window.location.origin}?room=${roomId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00";
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <>
      {showOnboarding && <Onboarding onComplete={() => {
        setShowOnboarding(false);
        localStorage.setItem('soound_onboarding_completed', 'true');
      }} />}
      
      <div className="relative min-h-[100dvh] w-full overflow-hidden bg-black flex flex-col">
        {/* Autoplay Interaction Overlay */}
        <AnimatePresence>
          {needsInteraction && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md"
            >
              <button
                onClick={() => {
                  if (audioRef.current) {
                    audioRef.current.play().then(() => {
                      setNeedsInteraction(false);
                    }).catch(console.error);
                  }
                }}
                className="px-8 py-4 bg-white text-black rounded-full font-display font-bold text-xl flex items-center gap-3 hover:scale-105 active:scale-95 transition-transform shadow-[0_0_40px_rgba(255,255,255,0.3)]"
              >
                <IconVolume className="w-6 h-6" />
                Tap to Unmute
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Immersive Background */}
        <motion.div 
          className="absolute inset-0 z-0 opacity-40 transition-all duration-1000"
          animate={{
            scale: isPlaying ? 1.05 : 1,
          }}
        >
          <div 
            className="absolute inset-0 bg-cover bg-center blur-[100px] saturate-[1.5]"
            style={{ backgroundImage: `url(${currentTrack.cover})` }}
          />
          <div className="absolute inset-0 bg-black/50" />
        </motion.div>

        {/* Floating Reactions */}
        <div className="absolute inset-0 z-30 pointer-events-none overflow-hidden">
          <AnimatePresence>
            {reactions.map((reaction) => (
              <motion.div
                key={reaction.id}
                initial={{ opacity: 0, y: '100vh', x: `${reaction.x}vw`, scale: 0.5 }}
                animate={{ opacity: [0, 1, 1, 0], y: '-10vh', x: `${reaction.x + (Math.random() * 10 - 5)}vw`, scale: [0.5, 1.5, 1.5, 1] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 3, ease: "easeOut" }}
                className="absolute bottom-0 text-4xl drop-shadow-2xl"
              >
                {reaction.emoji}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Toast Notification */}
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

        {/* Top Bar */}
        <header className="relative z-20 flex items-center justify-between p-4 md:p-8">
          <button 
            onClick={onLeave}
            className="flex items-center gap-2 text-white/60 hover:text-white transition-colors p-2 -ml-2 rounded-full hover:bg-white/10 active:scale-95"
          >
            <IconChevronLeft className="w-6 h-6" />
            <span className="hidden md:block font-display font-bold uppercase tracking-widest text-xs">Leave</span>
          </button>
          
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center gap-2 text-white/70 bg-white/5 px-3 py-2 rounded-full border border-white/5">
              {isHost ? <Crown className="w-4 h-4 text-yellow-500" /> : <IconUsers className="w-4 h-4" />}
              <span className="font-display font-bold text-sm">{userCount}</span>
            </div>
            <button 
              onClick={copyRoomLink}
              className="w-10 h-10 md:w-auto md:px-5 md:py-2 rounded-full bg-white/10 hover:bg-white hover:text-black transition-all flex items-center justify-center font-display font-bold text-sm tracking-wide active:scale-95"
            >
              <IconShare className="w-4 h-4 md:hidden" />
              <span className="hidden md:inline">{copied ? 'COPIED' : 'INVITE'}</span>
            </button>
            <div className="w-px h-6 bg-white/10 mx-1 md:mx-2" />
            <button 
              onClick={() => {
                setDrawerTab('search');
                setIsDrawerOpen(true);
              }}
              className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white hover:text-black transition-all active:scale-95"
            >
              <IconSearch className="w-4 h-4 md:w-5 md:h-5" />
            </button>
            <button 
              onClick={() => {
                setDrawerTab('queue');
                setIsDrawerOpen(true);
              }}
              className="relative w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white hover:text-black transition-all active:scale-95"
            >
              <IconQueue className="w-4 h-4 md:w-5 md:h-5" />
              {queue.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-white text-black text-[10px] font-bold rounded-full flex items-center justify-center shadow-lg">
                  {queue.length}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Center Player Area */}
        <main className="relative z-10 flex-1 min-h-0 flex flex-col items-center justify-center p-4 md:p-6 w-full max-w-5xl mx-auto">
          <div className="relative w-[65vw] max-w-[300px] md:max-w-[380px] aspect-square flex items-center justify-center mb-8 md:mb-12">
            {/* Circular Visualizer behind the album art */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none scale-[1.3] md:scale-[1.2]">
              <CircularVisualizer audioElement={audioRef.current} isPlaying={isPlaying} size={600} />
            </div>
            
            {/* Album Art (Vinyl) */}
            <motion.div 
              className="relative z-10 w-full h-full rounded-full overflow-hidden shadow-[0_0_60px_rgba(0,0,0,0.8)] ring-1 ring-white/10"
              animate={{ 
                rotate: isPlaying ? 360 : 0,
                scale: isPlaying ? 1 : 0.95
              }}
              transition={{ 
                rotate: { duration: 20, repeat: Infinity, ease: "linear" },
                scale: { type: "spring", stiffness: 200, damping: 20 }
              }}
            >
              <img 
                src={currentTrack.cover} 
                alt={currentTrack.title}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 rounded-full shadow-[inset_0_0_40px_rgba(0,0,0,0.5)] pointer-events-none" />
              {/* Vinyl center hole effect */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-black/40 backdrop-blur-sm border border-white/10 flex items-center justify-center">
                  <div className="w-3 h-3 md:w-4 md:h-4 rounded-full bg-black shadow-inner" />
                </div>
              </div>
            </motion.div>

            {/* Tonearm */}
            <Tonearm isPlaying={isPlaying} progress={duration ? currentTime / duration : 0} />
          </div>

          {/* Track Info */}
          <div className="text-center max-w-2xl w-full mb-6 md:mb-12 px-4">
            <motion.h2 
              key={currentTrack.title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-3xl md:text-5xl font-display font-bold text-white mb-2 md:mb-4 tracking-tighter line-clamp-1"
            >
              {currentTrack.title}
            </motion.h2>
            <motion.p 
              key={currentTrack.artist}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-lg md:text-xl text-white/50 font-light tracking-wide line-clamp-1"
            >
              {currentTrack.artist}
            </motion.p>
          </div>

          {/* Controls Area */}
          <div className="w-full flex flex-col items-center gap-6 md:gap-8 px-2 md:px-8">
            {/* Progress Bar */}
            <div className="w-full flex items-center gap-3 md:gap-4">
              <span className="text-xs md:text-sm font-display font-medium text-white/40 w-10 md:w-12 text-right tabular-nums">
                {formatTime(currentTime)}
              </span>
              <div className="relative flex-1 h-6 md:h-4 group flex items-center">
                <input
                  type="range"
                  min={0}
                  max={duration || 100}
                  value={currentTime}
                  onChange={isHost ? handleSeek : undefined}
                  onClick={() => !isHost && showToast("Only host can seek")}
                  className={cn("absolute inset-0 w-full h-full opacity-0 z-10", isHost ? "cursor-pointer" : "cursor-default")}
                  readOnly={!isHost}
                />
                <div className="absolute inset-y-2 md:inset-y-1 left-0 right-0 bg-white/10 rounded-full overflow-hidden">
                  <div 
                    className="absolute inset-y-0 left-0 bg-white rounded-full transition-all duration-100 ease-linear"
                    style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
                  />
                </div>
              </div>
              <span className="text-xs md:text-sm font-display font-medium text-white/40 w-10 md:w-12 tabular-nums">
                {formatTime(duration)}
              </span>
            </div>

            {/* Main Controls */}
            <div className="w-full grid grid-cols-3 items-center">
              <div className="flex justify-start">
                <div className="hidden md:flex items-center gap-4 w-32 opacity-0 md:opacity-100 group">
                  <IconVolume className="w-5 h-5 text-white/40 group-hover:text-white/80 transition-colors" />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={volume}
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-white/10 rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full cursor-pointer"
                  />
                </div>
              </div>

              <div className="flex items-center justify-center">
                <div className="flex items-center justify-center gap-4 md:gap-8">
                  <button 
                    onClick={() => isHost ? playPrev() : showToast("Only host can control playback")}
                    className="p-2 md:p-3 text-white/40 hover:text-white transition-colors active:scale-90"
                  >
                    <IconPrev className="w-7 h-7 md:w-8 md:h-8" />
                  </button>
                  <button 
                    onClick={() => isHost ? handlePlayPause() : showToast("Only host can control playback")}
                    className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-[0_0_30px_rgba(255,255,255,0.2)]"
                  >
                    {isPlaying ? <IconPause className="w-7 h-7 md:w-8 md:h-8" /> : <IconPlay className="w-7 h-7 md:w-8 md:h-8 ml-1" />}
                  </button>
                  <button 
                    onClick={() => isHost ? playNext() : showToast("Only host can control playback")}
                    className={cn("p-2 md:p-3 transition-colors active:scale-90", queue.length > 0 ? "text-white hover:text-white/80 drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]" : "text-white/40 hover:text-white")}
                  >
                    <IconNext className="w-7 h-7 md:w-8 md:h-8" />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-1 md:gap-3">
                <button onClick={() => sendReaction('🔥')} className="p-2 text-xl md:text-2xl hover:scale-125 active:scale-90 transition-transform bg-white/5 rounded-full md:bg-transparent">🔥</button>
                <button onClick={() => sendReaction('❤️')} className="p-2 text-xl md:text-2xl hover:scale-125 active:scale-90 transition-transform bg-white/5 rounded-full md:bg-transparent">❤️</button>
                <button onClick={() => sendReaction('🎉')} className="p-2 text-xl md:text-2xl hover:scale-125 active:scale-90 transition-transform bg-white/5 rounded-full md:bg-transparent">🎉</button>
              </div>
            </div>
          </div>
        </main>

        {/* Search / Playlist Drawer */}
        <AnimatePresence>
          {isDrawerOpen && (
            <>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsDrawerOpen(false)}
                className="absolute inset-0 z-40 bg-black/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
                className="absolute bottom-0 left-0 right-0 z-50 h-[85dvh] md:h-auto md:top-0 md:bottom-0 md:left-auto md:w-[420px] bg-[#0a0a0a] md:border-l border-white/10 rounded-t-3xl md:rounded-none flex flex-col shadow-[0_-20px_40px_rgba(0,0,0,0.5)] md:shadow-2xl"
              >
                {/* Drag handle for mobile */}
                <div className="w-full flex justify-center pt-4 pb-2 md:hidden" onClick={() => setIsDrawerOpen(false)}>
                  <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                </div>

                <div className="px-6 pb-4 pt-2 md:pt-8 flex items-center justify-between border-b border-white/5">
                  <div className="flex gap-6">
                    <button 
                      onClick={() => setDrawerTab('search')}
                      className={cn("font-display font-bold text-xl transition-colors", drawerTab === 'search' ? "text-white" : "text-white/40 hover:text-white/80")}
                    >
                      Search
                    </button>
                    <button 
                      onClick={() => setDrawerTab('queue')}
                      className={cn("font-display font-bold text-xl transition-colors flex items-center gap-2", drawerTab === 'queue' ? "text-white" : "text-white/40 hover:text-white/80")}
                    >
                      Queue
                      {queue.length > 0 && (
                        <span className="w-5 h-5 bg-white/20 text-white text-xs rounded-full flex items-center justify-center">
                          {queue.length}
                        </span>
                      )}
                    </button>
                  </div>
                  <button onClick={() => setIsDrawerOpen(false)} className="text-white/50 hover:text-white p-2 -mr-2 rounded-full hover:bg-white/10 transition-colors">
                    <X className="w-6 h-6" />
                  </button>
                </div>

                {drawerTab === 'search' ? (
                  <>
                    <div className="p-4 md:p-6">
                      <div className="relative">
                        <IconSearch className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                        <input
                          type="text"
                          placeholder="Search iTunes..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full bg-white/5 border border-white/10 rounded-2xl pl-12 pr-4 py-3.5 md:py-4 text-base focus:outline-none focus:border-white/30 transition-colors placeholder:text-white/30 text-white font-display"
                        />
                        {isSearching && (
                          <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 animate-spin" />
                        )}
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-4 pb-6 custom-scrollbar">
                      {searchQuery ? (
                        searchResults.length > 0 ? (
                          <div className="space-y-2">
                            {searchResults.map((track) => (
                              <div
                                key={track.id}
                                className="w-full flex items-center gap-3 md:gap-4 p-2 md:p-3 rounded-2xl hover:bg-white/5 transition-colors group active:bg-white/10"
                              >
                                <div className="relative w-12 h-12 md:w-14 md:h-14 shrink-0 cursor-pointer" onClick={() => handleTrackClick(track)}>
                                  <img 
                                    src={track.cover} 
                                    alt={track.title} 
                                    className="w-full h-full rounded-xl object-cover"
                                    referrerPolicy="no-referrer"
                                  />
                                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-xl transition-opacity">
                                    {isHost ? <IconPlay className="w-5 h-5 md:w-6 md:h-6 text-white" /> : <IconPlus className="w-5 h-5 md:w-6 md:h-6 text-white" />}
                                  </div>
                                </div>
                                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleTrackClick(track)}>
                                  <p className="text-sm md:text-base font-display font-bold text-white/90 group-hover:text-white truncate">
                                    {track.title}
                                  </p>
                                  <p className="text-xs md:text-sm text-white/40 truncate">{track.artist}</p>
                                </div>
                                <button 
                                  onClick={() => addToQueue(track)}
                                  className="p-2 md:w-10 md:h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white hover:text-black transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100 active:scale-95 shrink-0"
                                >
                                  <IconPlus className="w-5 h-5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : !isSearching ? (
                          <div className="h-full flex flex-col items-center justify-center text-white/30 space-y-4">
                            <IconSearch className="w-12 h-12 opacity-20" />
                            <p className="font-display">No results found</p>
                          </div>
                        ) : null
                      ) : (
                        <div className="space-y-6">
                          <h4 className="px-2 text-xs font-display font-bold tracking-widest text-white/30 uppercase">
                            Featured
                          </h4>
                          <div className="space-y-2">
                            {DEFAULT_TRACKS.map((track) => (
                              <div
                                key={track.id}
                                className={cn(
                                  "w-full flex items-center gap-3 md:gap-4 p-2 md:p-3 rounded-2xl transition-all group active:bg-white/10",
                                  currentTrack.id === track.id
                                    ? "bg-white/10" 
                                    : "hover:bg-white/5"
                                )}
                              >
                                <div className="relative w-12 h-12 md:w-14 md:h-14 shrink-0 cursor-pointer" onClick={() => handleTrackClick(track)}>
                                  <img 
                                    src={track.cover} 
                                    alt={track.title} 
                                    className="w-full h-full rounded-xl object-cover"
                                    referrerPolicy="no-referrer"
                                  />
                                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-xl transition-opacity">
                                    {isHost ? <IconPlay className="w-5 h-5 md:w-6 md:h-6 text-white" /> : <IconPlus className="w-5 h-5 md:w-6 md:h-6 text-white" />}
                                  </div>
                                </div>
                                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleTrackClick(track)}>
                                  <p className={cn(
                                    "text-sm md:text-base font-display font-bold truncate transition-colors",
                                    currentTrack.id === track.id ? "text-white" : "text-white/70 group-hover:text-white"
                                  )}>
                                    {track.title}
                                  </p>
                                  <p className="text-xs md:text-sm text-white/40 truncate">{track.artist}</p>
                                </div>
                                {currentTrack.id === track.id && isPlaying ? (
                                  <div className="flex gap-1 h-4 items-end pr-3 md:pr-2 shrink-0">
                                    <motion.div animate={{ height: ["4px", "16px", "4px"] }} transition={{ repeat: Infinity, duration: 0.8 }} className="w-1 bg-white rounded-full" />
                                    <motion.div animate={{ height: ["8px", "4px", "8px"] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.2 }} className="w-1 bg-white rounded-full" />
                                    <motion.div animate={{ height: ["4px", "12px", "4px"] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.4 }} className="w-1 bg-white rounded-full" />
                                  </div>
                                ) : (
                                  <button 
                                    onClick={() => addToQueue(track)}
                                    className="p-2 md:w-10 md:h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white hover:text-black transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100 active:scale-95 shrink-0"
                                  >
                                    <IconPlus className="w-5 h-5" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 overflow-y-auto px-4 py-6 custom-scrollbar">
                    {queue.length > 0 ? (
                      <div className="space-y-2">
                        {queue.map((track, index) => (
                          <div
                            key={`${track.id}-${index}`}
                            className="w-full flex items-center gap-3 md:gap-4 p-2 md:p-3 rounded-2xl bg-white/5 hover:bg-white/10 transition-colors group"
                          >
                            <span className="text-white/30 font-display font-bold w-4 text-center text-sm">{index + 1}</span>
                            <img 
                              src={track.cover} 
                              alt={track.title} 
                              className="w-12 h-12 md:w-14 md:h-14 rounded-xl object-cover shrink-0"
                              referrerPolicy="no-referrer"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm md:text-base font-display font-bold text-white/90 truncate">
                                {track.title}
                              </p>
                              <p className="text-xs md:text-sm text-white/40 truncate">{track.artist}</p>
                            </div>
                            <button 
                              onClick={() => removeFromQueue(index)}
                              className="p-2 md:w-10 md:h-10 rounded-full flex items-center justify-center text-white/40 hover:text-red-400 hover:bg-red-400/10 transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100 active:scale-95 shrink-0"
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-white/30 space-y-4">
                        <IconQueue className="w-12 h-12 opacity-20" />
                        <p className="font-display text-sm md:text-base">Queue is empty</p>
                        <button 
                          onClick={() => setDrawerTab('search')}
                          className="px-6 py-2 rounded-full border border-white/20 hover:bg-white hover:text-black transition-colors text-sm font-display font-bold mt-4 active:scale-95"
                        >
                          Add Songs
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Hidden Audio Element */}
        <audio
          ref={audioRef}
          src={currentTrack.url}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
          crossOrigin="anonymous"
        />
      </div>
    </>
  );
};
