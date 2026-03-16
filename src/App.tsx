import React, { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Room } from './components/Room';
import { motion, AnimatePresence } from 'motion/react';
import { IconPlay, IconLink } from './components/CustomIcons';
import { SooundLogo } from './components/SooundLogo';
import { AnimatedWaves } from './components/AnimatedWaves';
import { ArrowLeft, User, ChevronDown, Radio, Share2, Headphones, Globe, Lock } from 'lucide-react';
import { cn } from './lib/utils';

const AVATARS = ['🎵', '🎸', '🎹', '🎷', '🥁', '🎤', '🎧', '🎺', '🎻', '🪗', '🎶', '🪘', '🎼', '🪕', '🫐', '🦊', '🐱', '🐼', '🦄', '🐸'];

function useInView(ref: React.RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { threshold: 0.2 });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [ref]);
  return visible;
}

function getAvatarForName(name: string) {
  if (!name) return AVATARS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return AVATARS[Math.abs(hash) % AVATARS.length];
}

const PILLS = ['Real-time sync', 'YouTube Music', 'Free forever'];

const STEPS = [
  { icon: <Radio className="w-7 h-7" />, title: 'Create Room', desc: 'Start a room with one tap' },
  { icon: <Share2 className="w-7 h-7" />, title: 'Share Code', desc: 'Send the 6-letter code to friends' },
  { icon: <Headphones className="w-7 h-7" />, title: 'Listen Together', desc: 'Everyone hears the same thing, in sync' },
];

export default function App() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [joinId, setJoinId] = useState('');
  const [view, setView] = useState<'main' | 'join' | 'name' | 'create'>('main');
  const [roomType, setRoomType] = useState<'public' | 'private'>('public');
  const [roomPassword, setRoomPassword] = useState('');
  const [allowGuestQueue, setAllowGuestQueue] = useState(true);
  const [pendingRoomId, setPendingRoomId] = useState<string | null>(null);
  const howRef = useRef<HTMLDivElement | null>(null);
  const howVisible = useInView(howRef);

  const [userName, setUserName] = useState(() => {
    return localStorage.getItem('soound_user_name') || '';
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room')?.toUpperCase();
    if (room) {
      setPendingRoomId(room);
      if (userName) {
        setRoomId(room);
      } else {
        setView('name');
      }
    }
  }, []);

  const startRoom = (id: string) => {
    window.history.pushState({}, '', `?room=${id}`);
    setRoomId(id);
  };

  const handleCreateRoom = () => {
    const newRoomId = uuidv4().substring(0, 6).toUpperCase();
    setPendingRoomId(newRoomId);
    setView('create');
  };

  const handleConfirmCreate = () => {
    if (!pendingRoomId) return;
    if (userName) {
      startRoom(pendingRoomId);
    } else {
      setView('name');
    }
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const id = joinId.trim().toUpperCase();
    if (!id) return;
    if (userName) {
      startRoom(id);
    } else {
      setPendingRoomId(id);
      setView('name');
    }
  };

  const handleSetName = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim()) return;
    const name = userName.trim();
    localStorage.setItem('soound_user_name', name);
    setUserName(name);
    if (pendingRoomId) {
      startRoom(pendingRoomId);
    }
  };

  const leaveRoom = () => {
    window.history.pushState({}, '', '/');
    setRoomId(null);
    setView('main');
    setPendingRoomId(null);
    setJoinId('');
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-white/30 overflow-hidden font-sans">
      <AnimatePresence mode="wait">
        {roomId ? (
          <Room key="room" roomId={roomId} userName={userName} onLeave={leaveRoom} roomType={roomType} roomPassword={roomPassword} initialAllowGuestQueue={allowGuestQueue} />
        ) : (
          <motion.div
            key="landing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.05, filter: 'blur(10px)' }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="relative min-h-screen flex flex-col"
          >
            <AnimatedWaves />

            {/* Floating gradient orbs */}
            <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
              <div className="absolute top-[20%] left-[15%] w-[400px] h-[400px] rounded-full bg-white/[0.04] blur-[120px]" style={{ animation: 'float-orb-1 20s ease-in-out infinite' }} />
              <div className="absolute top-[50%] right-[10%] w-[350px] h-[350px] rounded-full bg-white/[0.03] blur-[100px]" style={{ animation: 'float-orb-2 25s ease-in-out infinite' }} />
              <div className="absolute bottom-[10%] left-[40%] w-[300px] h-[300px] rounded-full bg-white/[0.035] blur-[110px]" style={{ animation: 'float-orb-3 18s ease-in-out infinite' }} />
            </div>

            {/* Hero section */}
            <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-4 min-h-screen">
              <div className="w-full max-w-2xl flex flex-col items-center">
                {/* Feature pills */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.8, duration: 1 }}
                  className="flex flex-wrap gap-2 justify-center mb-8"
                >
                  {PILLS.map((pill, i) => (
                    <motion.span
                      key={pill}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 1 + i * 0.15, duration: 0.5 }}
                      className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-white/50 text-xs font-display tracking-wide"
                    >
                      {pill}
                    </motion.span>
                  ))}
                </motion.div>

                <motion.div
                  initial={{ y: 40, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 1, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className="mb-8"
                >
                  <SooundLogo width={400} className="text-white mx-auto max-w-[80vw]" />
                </motion.div>

                <motion.p
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 1, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  className="text-xl md:text-2xl text-gray-400 font-light tracking-wide mb-16 text-center"
                >
                  Listen together. Anywhere.
                </motion.p>

                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 1, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
                  className="w-full max-w-md relative"
                >
                  <AnimatePresence mode="wait">
                    {view === 'main' && (
                      <motion.div
                        key="buttons"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.3 }}
                        className="flex flex-col gap-4"
                      >
                        {userName && (
                          <p className="text-center text-white/40 text-sm font-display mb-2">
                            Hey, <span className="text-white/70">{userName}</span> 👋
                          </p>
                        )}
                        <button
                          onClick={handleCreateRoom}
                          className="w-full group relative overflow-hidden rounded-2xl bg-white text-black py-5 px-8 flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300"
                        >
                          <div className="absolute inset-0 bg-gradient-to-r from-gray-200 to-white opacity-0 group-hover:opacity-100 transition-opacity" />
                          <IconPlay className="w-6 h-6 relative z-10" />
                          <span className="font-display font-bold text-lg relative z-10">Create Room</span>
                        </button>

                        <button
                          onClick={() => setView('join')}
                          className="w-full group relative overflow-hidden rounded-2xl bg-white/10 border border-white/20 text-white py-5 px-8 flex items-center justify-center gap-3 hover:bg-white/20 active:scale-[0.98] transition-all duration-300"
                        >
                          <IconLink className="w-6 h-6 relative z-10" />
                          <span className="font-display font-bold text-lg relative z-10">Join Room</span>
                        </button>

                        {userName && (
                          <button
                            onClick={() => {
                              localStorage.removeItem('soound_user_name');
                              setUserName('');
                            }}
                            className="text-white/30 text-xs font-display hover:text-white/60 transition-colors mt-2"
                          >
                            Change name
                          </button>
                        )}
                      </motion.div>
                    )}

                    {view === 'join' && (
                      <motion.form
                        key="form"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        transition={{ duration: 0.3 }}
                        onSubmit={handleJoinRoom}
                        className="flex flex-col gap-4"
                      >
                        <div className="relative group">
                          <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none">
                            <IconLink className="w-5 h-5 text-gray-500 group-focus-within:text-white transition-colors" />
                          </div>
                          {/* Character pop input */}
                          <input
                            type="text"
                            placeholder="Room Code (e.g. A1B2C3)"
                            value={joinId}
                            onChange={(e) => setJoinId(e.target.value.toUpperCase())}
                            autoFocus
                            maxLength={6}
                            className="w-full bg-white/5 border border-white/10 rounded-2xl pl-14 pr-6 py-5 text-lg text-center tracking-[0.3em] focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all placeholder:text-gray-600 placeholder:tracking-normal text-white font-display font-bold uppercase"
                          />
                          {/* Character overlay with pop animation */}
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="flex gap-1 tracking-[0.3em] text-lg font-display font-bold">
                              {joinId.split('').map((ch, i) => (
                                <span key={`${i}-${ch}`} className="inline-block text-transparent" style={{ animation: 'pop-in 0.25s ease-out forwards' }}>{ch}</span>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <button
                            type="button"
                            onClick={() => setView('main')}
                            className="flex-1 py-4 rounded-2xl bg-white/10 text-white font-display font-semibold hover:bg-white/20 transition-colors flex items-center justify-center gap-2"
                          >
                            <ArrowLeft className="w-5 h-5" />
                            Back
                          </button>
                          <button
                            type="submit"
                            disabled={joinId.trim().length < 4}
                            className="flex-[2] py-4 rounded-2xl bg-white text-black font-display font-semibold hover:bg-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            Join
                          </button>
                        </div>
                      </motion.form>
                    )}

                    {view === 'create' && (
                      <motion.div
                        key="create"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        transition={{ duration: 0.3 }}
                        className="flex flex-col gap-5"
                      >
                        <h2 className="font-display font-bold text-2xl text-center">Create Room</h2>

                        {/* Room type cards */}
                        <div className="grid grid-cols-2 gap-3">
                          <button
                            onClick={() => setRoomType('public')}
                            className={cn(
                              "flex flex-col items-center gap-2 p-5 rounded-2xl border transition-all btn-press",
                              roomType === 'public'
                                ? "border-white/30 bg-white/10"
                                : "border-white/10 bg-white/5 hover:bg-white/10"
                            )}
                          >
                            <Globe className="w-7 h-7 text-white/70" />
                            <span className="font-display font-bold text-sm">Public</span>
                            <span className="text-xs text-white/40">Anyone can join</span>
                          </button>
                          <button
                            onClick={() => setRoomType('private')}
                            className={cn(
                              "flex flex-col items-center gap-2 p-5 rounded-2xl border transition-all btn-press",
                              roomType === 'private'
                                ? "border-white/30 bg-white/10"
                                : "border-white/10 bg-white/5 hover:bg-white/10"
                            )}
                          >
                            <Lock className="w-7 h-7 text-white/70" />
                            <span className="font-display font-bold text-sm">Private</span>
                            <span className="text-xs text-white/40">Invite only</span>
                          </button>
                        </div>

                        {/* Password input for private */}
                        <AnimatePresence>
                          {roomType === 'private' && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <input
                                type="text"
                                placeholder="Room password (optional)"
                                value={roomPassword}
                                onChange={(e) => setRoomPassword(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-base focus:outline-none focus:border-white/30 transition-all placeholder:text-white/30 text-white font-display"
                              />
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {/* Guest queue toggle */}
                        <div className="flex items-center justify-between px-1">
                          <span className="text-sm font-display text-white/70">Guests can add songs</span>
                          <button
                            onClick={() => setAllowGuestQueue(!allowGuestQueue)}
                            className={cn(
                              "relative w-11 h-6 rounded-full transition-colors btn-press",
                              allowGuestQueue ? "bg-white/30" : "bg-white/10"
                            )}
                          >
                            <div
                              className={cn(
                                "absolute top-1 w-4 h-4 rounded-full bg-white transition-transform",
                                allowGuestQueue ? "left-6" : "left-1"
                              )}
                            />
                          </button>
                        </div>

                        {/* Buttons */}
                        <div className="flex gap-3">
                          <button
                            type="button"
                            onClick={() => setView('main')}
                            className="flex-1 py-4 rounded-2xl bg-white/10 text-white font-display font-semibold hover:bg-white/20 transition-colors flex items-center justify-center gap-2 btn-press"
                          >
                            <ArrowLeft className="w-5 h-5" />
                            Back
                          </button>
                          <button
                            onClick={handleConfirmCreate}
                            className="flex-[2] py-4 rounded-2xl bg-white text-black font-display font-bold text-lg hover:bg-gray-200 transition-colors btn-press"
                          >
                            Create
                          </button>
                        </div>
                      </motion.div>
                    )}

                    {view === 'name' && (
                      <motion.form
                        key="name"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.3 }}
                        onSubmit={handleSetName}
                        className="flex flex-col gap-4 items-center"
                      >
                        {/* Avatar preview */}
                        <motion.div
                          key={getAvatarForName(userName)}
                          initial={{ scale: 0.5, rotate: -20 }}
                          animate={{ scale: 1, rotate: 0 }}
                          transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                          className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-4xl mb-2"
                        >
                          {getAvatarForName(userName)}
                        </motion.div>
                        <p className="text-center text-white/60 font-display text-lg mb-2">
                          What's your name?
                        </p>
                        <div className="relative group w-full">
                          <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none">
                            <User className="w-5 h-5 text-gray-500 group-focus-within:text-white transition-colors" />
                          </div>
                          <input
                            type="text"
                            placeholder="Your name"
                            value={userName}
                            onChange={(e) => setUserName(e.target.value)}
                            autoFocus
                            maxLength={20}
                            className="w-full bg-white/5 border border-white/10 rounded-2xl pl-14 pr-6 py-5 text-lg focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all placeholder:text-gray-600 text-white font-display"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={!userName.trim()}
                          className="w-full py-4 rounded-2xl bg-white text-black font-display font-bold text-lg hover:bg-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          Let's Go
                        </button>
                      </motion.form>
                    )}
                  </AnimatePresence>
                </motion.div>
              </div>

              {/* Scroll chevron */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.5 }}
                className="absolute bottom-8"
                style={{ animation: 'bounce-chevron 2s ease-in-out infinite' }}
              >
                <ChevronDown className="w-6 h-6 text-white/30" />
              </motion.div>
            </div>

            {/* How it works */}
            <div ref={howRef} className="relative z-10 py-24 px-4">
              <div className="max-w-3xl mx-auto">
                <motion.h2
                  initial={{ opacity: 0, y: 20 }}
                  animate={howVisible ? { opacity: 1, y: 0 } : {}}
                  transition={{ duration: 0.6 }}
                  className="text-center text-2xl md:text-3xl font-display font-bold text-white/90 mb-16"
                >
                  How it works
                </motion.h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  {STEPS.map((step, i) => (
                    <motion.div
                      key={step.title}
                      initial={{ opacity: 0, y: 30 }}
                      animate={howVisible ? { opacity: 1, y: 0 } : {}}
                      transition={{ duration: 0.5, delay: 0.15 * i }}
                      className="flex flex-col items-center text-center gap-4"
                    >
                      <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/70">
                        {step.icon}
                      </div>
                      <div>
                        <span className="text-white/30 text-xs font-display block mb-1">Step {i + 1}</span>
                        <h3 className="font-display font-semibold text-lg text-white/90">{step.title}</h3>
                        <p className="text-white/40 text-sm mt-1">{step.desc}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <footer className="relative z-10 py-8 text-center">
              <p className="text-white/20 text-xs font-display">
                Built with ❤️ &nbsp;·&nbsp; <span className="bg-white/5 px-2 py-0.5 rounded-full">v0.1.0-beta</span>
              </p>
            </footer>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
