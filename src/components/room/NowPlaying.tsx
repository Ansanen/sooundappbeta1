import React from 'react';
import { Track } from '../../lib/types';
import { motion } from 'motion/react';

interface NowPlayingProps {
  currentTrack: Track;
}

export const NowPlaying: React.FC<NowPlayingProps> = ({ currentTrack }) => {
  return (
    <div className="w-full">
      <motion.h2
        key={currentTrack.title}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="font-display font-bold text-xl text-white truncate"
      >
        {currentTrack.title}
      </motion.h2>
      <motion.p
        key={currentTrack.artist}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-white/50 text-sm truncate mt-0.5"
      >
        {currentTrack.artist}
      </motion.p>
    </div>
  );
};
