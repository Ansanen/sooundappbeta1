import React, { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Room } from './components/Room';
import { motion, AnimatePresence } from 'motion/react';
import { IconPlay, IconLink } from './components/CustomIcons';
import { ArrowLeft } from 'lucide-react';

export default function App() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [joinId, setJoinId] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
      setRoomId(room);
    }
  }, []);

  const createRoom = () => {
    const newRoomId = uuidv4().substring(0, 8);
    window.history.pushState({}, '', `?room=${newRoomId}`);
    setRoomId(newRoomId);
  };

  const joinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (joinId.trim()) {
      window.history.pushState({}, '', `?room=${joinId.trim()}`);
      setRoomId(joinId.trim());
    }
  };

  const leaveRoom = () => {
    window.history.pushState({}, '', '/');
    setRoomId(null);
    setIsJoining(false);
    setJoinId('');
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-white/30 overflow-hidden font-sans">
      <AnimatePresence mode="wait">
        {roomId ? (
          <Room key="room" roomId={roomId} onLeave={leaveRoom} />
        ) : (
          <motion.div 
            key="landing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.05, filter: 'blur(10px)' }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="relative min-h-screen flex flex-col items-center justify-center p-4"
          >
            {/* Cinematic Background */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              <motion.div 
                animate={{ 
                  rotate: [0, 360],
                  scale: [1, 1.2, 1]
                }}
                transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
                className="absolute top-[-20%] left-[-10%] w-[70vw] h-[70vw] rounded-full bg-white/5 blur-[120px]" 
              />
              <motion.div 
                animate={{ 
                  rotate: [360, 0],
                  scale: [1, 1.5, 1]
                }}
                transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
                className="absolute bottom-[-20%] right-[-10%] w-[60vw] h-[60vw] rounded-full bg-white/5 blur-[100px]" 
              />
            </div>

            <div className="relative z-10 w-full max-w-2xl flex flex-col items-center">
              <motion.h1 
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 1, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="text-[15vw] md:text-[120px] font-display font-bold leading-none tracking-tighter mb-6 text-transparent bg-clip-text bg-gradient-to-b from-white to-white/40"
              >
                SOOUND
              </motion.h1>
              
              <motion.p 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 1, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="text-xl md:text-2xl text-gray-400 font-light tracking-wide mb-16 text-center"
              >
                Synchronized playback. Infinite library.
              </motion.p>

              <motion.div 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 1, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="w-full max-w-md h-[150px] relative"
              >
                <AnimatePresence mode="wait">
                  {!isJoining ? (
                    <motion.div
                      key="buttons"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.3 }}
                      className="absolute inset-0 flex flex-col gap-4"
                    >
                      <button
                        onClick={createRoom}
                        className="w-full group relative overflow-hidden rounded-full bg-white text-black py-5 px-8 flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300"
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-gray-200 to-white opacity-0 group-hover:opacity-100 transition-opacity" />
                        <IconPlay className="w-6 h-6 relative z-10" />
                        <span className="font-display font-bold text-lg relative z-10">Create Room</span>
                      </button>

                      <button
                        onClick={() => setIsJoining(true)}
                        className="w-full group relative overflow-hidden rounded-full bg-white/10 border border-white/20 text-white py-5 px-8 flex items-center justify-center gap-3 hover:bg-white/20 active:scale-[0.98] transition-all duration-300"
                      >
                        <IconLink className="w-6 h-6 relative z-10" />
                        <span className="font-display font-bold text-lg relative z-10">Join Room</span>
                      </button>
                    </motion.div>
                  ) : (
                    <motion.form
                      key="form"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      transition={{ duration: 0.3 }}
                      onSubmit={joinRoom}
                      className="absolute inset-0 flex flex-col gap-4"
                    >
                      <div className="relative group">
                        <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none">
                          <IconLink className="w-5 h-5 text-gray-500 group-focus-within:text-white transition-colors" />
                        </div>
                        <input
                          type="text"
                          placeholder="Paste Room ID..."
                          value={joinId}
                          onChange={(e) => setJoinId(e.target.value)}
                          autoFocus
                          className="w-full bg-white/5 border border-white/10 rounded-full pl-14 pr-6 py-5 text-lg focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all placeholder:text-gray-600 text-white font-display"
                        />
                      </div>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => setIsJoining(false)}
                          className="flex-1 py-4 rounded-full bg-white/10 text-white font-display font-semibold hover:bg-white/20 transition-colors flex items-center justify-center gap-2"
                        >
                          <ArrowLeft className="w-5 h-5" />
                          Back
                        </button>
                        <button
                          type="submit"
                          disabled={!joinId.trim()}
                          className="flex-[2] py-4 rounded-full bg-white text-black font-display font-semibold hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Connect
                        </button>
                      </div>
                    </motion.form>
                  )}
                </AnimatePresence>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
