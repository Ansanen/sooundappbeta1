import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Copy, Share2 } from 'lucide-react';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
}

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose, roomId }) => {
  const [copied, setCopied] = useState(false);
  const roomUrl = `${window.location.origin}?room=${roomId}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(roomUrl)}&bgcolor=0a0a0a&color=ffffff&format=svg`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(roomUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join my Soound room', url: roomUrl });
      } catch {}
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="bg-[#0a0a0a] border border-white/10 rounded-3xl p-8 max-w-sm w-full mx-4 relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 text-white/40 hover:text-white rounded-full hover:bg-white/10 transition-colors btn-press"
            >
              <X className="w-5 h-5" />
            </button>

            <h2 className="font-display font-bold text-xl text-white text-center mb-6">Share Room</h2>

            {/* QR Code */}
            <div className="w-48 h-48 mx-auto rounded-2xl bg-white/5 border border-white/10 overflow-hidden mb-6">
              <img src={qrUrl} alt="QR Code" className="w-full h-full object-contain" />
            </div>

            {/* Room code */}
            <p className="text-3xl font-display font-bold tracking-[0.3em] text-center text-white mb-2">
              {roomId}
            </p>
            <p className="text-xs text-white/40 truncate text-center mb-6">{roomUrl}</p>

            {/* Buttons */}
            <div className="flex flex-col gap-3">
              <button
                onClick={handleCopy}
                className="w-full py-3.5 rounded-2xl bg-white text-black font-display font-bold flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors btn-press"
              >
                <Copy className="w-4 h-4" />
                {copied ? 'Copied!' : 'Copy Link'}
              </button>
              {typeof navigator.share === 'function' && (
                <button
                  onClick={handleShare}
                  className="w-full py-3.5 rounded-2xl bg-white/10 text-white font-display font-bold flex items-center justify-center gap-2 hover:bg-white/20 transition-colors btn-press"
                >
                  <Share2 className="w-4 h-4" />
                  Share
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
