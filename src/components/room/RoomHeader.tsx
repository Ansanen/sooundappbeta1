import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { SooundLogo } from '../SooundLogo';
import { IconChevronLeft, IconShare, IconUsers, IconSearch, IconQueue } from '../CustomIcons';
import { Crown } from 'lucide-react';
import { cn } from '../../lib/utils';

interface RoomHeaderProps {
  roomId: string;
  userCount: number;
  queueCount: number;
  isHost: boolean;
  onLeave: () => void;
  onOpenDrawer: (tab: 'search' | 'queue' | 'users') => void;
  onOpenShare: () => void;
  onOpenShareCard?: () => void;
}

export const RoomHeader: React.FC<RoomHeaderProps> = ({
  roomId,
  userCount,
  queueCount,
  isHost,
  onLeave,
  onOpenDrawer,
  onOpenShare,
  onOpenShareCard,
}) => {
  const [copied, setCopied] = useState(false);
  const [countBounce, setCountBounce] = useState(false);
  const prevCount = useRef(userCount);

  useEffect(() => {
    if (userCount !== prevCount.current) {
      setCountBounce(true);
      prevCount.current = userCount;
      const t = setTimeout(() => setCountBounce(false), 300);
      return () => clearTimeout(t);
    }
  }, [userCount]);

  const shareRoom = async () => {
    const url = `${window.location.origin}?room=${roomId}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join my Soound room', url });
        return;
      } catch {}
    }
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.header
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative z-20 flex items-center justify-between p-4 md:p-8 glass-header"
    >
      <div className="flex items-center gap-2">
        <button
          onClick={onLeave}
          className="flex items-center gap-2 text-white/60 hover:text-white transition-colors p-2 -ml-2 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 btn-press"
        >
          <IconChevronLeft className="w-6 h-6" />
        </button>
        <SooundLogo width={90} className="text-white/60 hidden md:block" />
      </div>

      <div className="flex items-center gap-2 md:gap-4">
        <div className="relative">
          <button
            onClick={onOpenShare}
            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 px-4 py-2.5 rounded-xl border border-white/10 transition-colors btn-press"
          >
            <span className="font-display font-bold text-base tracking-[0.15em] text-white/90">{roomId}</span>
            {isHost && (
              <span className="flex items-center gap-1 text-white/70">
                <Crown className="w-3 h-3" />
              </span>
            )}
            <IconShare className="w-4 h-4 text-white/40" />
          </button>
          {copied && <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs text-white/60 font-display whitespace-nowrap">Link copied!</span>}
        </div>
        
        {onOpenShareCard && (
          <button
            onClick={onOpenShareCard}
            className="w-10 h-10 rounded-full bg-white/10 border border-white/5 flex items-center justify-center hover:bg-white/20 transition-all btn-press"
            title="Share Card"
          >
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-white/70">
              <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2"/>
              <path d="M8 17V14L12 9L16 14V17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="12" cy="8" r="1.5" fill="currentColor"/>
            </svg>
          </button>
        )}
        <button
          onClick={() => onOpenDrawer('users')}
          className="flex items-center gap-1.5 text-white/70 bg-white/5 px-3 py-2.5 rounded-xl border border-white/5 hover:bg-white/10 transition-colors btn-press"
        >
          {isHost ? <Crown className="w-3.5 h-3.5 text-white/70" /> : <IconUsers className="w-3.5 h-3.5" />}
          <span className={cn("font-display font-bold text-sm", countBounce && "count-bounce")}>{userCount}</span>
        </button>
        <button
          onClick={() => onOpenDrawer('search')}
          className="w-10 h-10 rounded-full bg-white/10 border border-white/5 flex items-center justify-center hover:bg-white/20 transition-all btn-press"
        >
          <IconSearch className="w-4 h-4 md:w-5 md:h-5" />
        </button>
        <button
          onClick={() => onOpenDrawer('queue')}
          className="relative w-10 h-10 rounded-full bg-white/10 border border-white/5 flex items-center justify-center hover:bg-white/20 transition-all btn-press"
        >
          <IconQueue className="w-4 h-4 md:w-5 md:h-5" />
          {queueCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-white text-black text-[10px] font-bold rounded-full flex items-center justify-center shadow-lg">
              {queueCount}
            </span>
          )}
        </button>
      </div>
    </motion.header>
  );
};
