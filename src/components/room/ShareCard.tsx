import React, { useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Track } from '../../lib/types';
import { cn } from '../../lib/utils';

interface ShareCardProps {
  isOpen: boolean;
  onClose: () => void;
  currentTrack: Track | null;
  roomId: string;
  userName: string;
  userCount: number;
  moodLabel?: string;
}

function hashToColors(str: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  const palettes: [string, string][] = [
    ['#667eea', '#764ba2'],
    ['#f093fb', '#f5576c'],
    ['#4facfe', '#00f2fe'],
    ['#43e97b', '#38f9d7'],
    ['#fa709a', '#fee140'],
    ['#a18cd1', '#fbc2eb'],
    ['#ffecd2', '#fcb69f'],
    ['#89f7fe', '#66a6ff'],
  ];
  return palettes[Math.abs(hash) % palettes.length];
}

function drawCard(
  canvas: HTMLCanvasElement,
  track: Track | null,
  roomId: string,
  userName: string,
  userCount: number,
  moodLabel?: string,
  coverImg?: HTMLImageElement | null,
) {
  const W = 1080;
  const H = 1920;
  const ctx = canvas.getContext('2d')!;
  canvas.width = W;
  canvas.height = H;

  // Background
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, W, H);

  // Gradient accent
  const [c1, c2] = hashToColors(track?.id || roomId);
  const grad = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, W * 0.8);
  grad.addColorStop(0, c1 + '30');
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Second orb
  const grad2 = ctx.createRadialGradient(W * 0.7, H * 0.6, 0, W * 0.7, H * 0.6, W * 0.5);
  grad2.addColorStop(0, c2 + '20');
  grad2.addColorStop(1, 'transparent');
  ctx.fillStyle = grad2;
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2;

  // Album art (large, centered)
  const artSize = 560;
  const artY = 380;
  const artR = 40;

  // Glass card behind art
  ctx.save();
  roundedRect(ctx, cx - artSize / 2 - 30, artY - 30, artSize + 60, artSize + 60, artR + 10);
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  if (coverImg) {
    ctx.save();
    roundedRect(ctx, cx - artSize / 2, artY, artSize, artSize, artR);
    ctx.clip();
    ctx.drawImage(coverImg, cx - artSize / 2, artY, artSize, artSize);
    ctx.restore();

    // Inner glass highlight on art
    ctx.save();
    roundedRect(ctx, cx - artSize / 2, artY, artSize, artSize, artR);
    const hlGrad = ctx.createLinearGradient(cx - artSize / 2, artY, cx + artSize / 2, artY + artSize);
    hlGrad.addColorStop(0, 'rgba(255,255,255,0.1)');
    hlGrad.addColorStop(0.5, 'transparent');
    hlGrad.addColorStop(1, 'rgba(255,255,255,0.03)');
    ctx.fillStyle = hlGrad;
    ctx.fill();
    ctx.restore();
  } else {
    // Placeholder
    ctx.save();
    roundedRect(ctx, cx - artSize / 2, artY, artSize, artSize, artR);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fill();
    // Music note
    ctx.font = `${artSize * 0.4}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillText('🎵', cx, artY + artSize / 2);
    ctx.restore();
  }

  // Generative rings overlay on art (like SoundWaveAvatar)
  if (track) {
    ctx.save();
    roundedRect(ctx, cx - artSize / 2, artY, artSize, artSize, artR);
    ctx.clip();
    const artCx = cx;
    const artCy = artY + artSize / 2;
    const seed = simpleHash(track.id + track.title);
    const ringCount = 4 + (seed[0] % 3);
    for (let i = 0; i < ringCount; i++) {
      const s = seed[i * 3 % seed.length];
      const s2 = seed[(i * 3 + 1) % seed.length];
      const s3 = seed[(i * 3 + 2) % seed.length];
      const radius = (artSize * 0.15) + (s / 255) * (artSize * 0.35);
      const arcLen = (60 + (s2 / 255) * 200) * (Math.PI / 180);
      const rotOffset = (s3 / 255) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(artCx, artCy, radius, rotOffset, rotOffset + arcLen);
      ctx.strokeStyle = `rgba(255,255,255,${0.15 + (s / 255) * 0.25})`;
      ctx.lineWidth = 1.5 + (s2 / 255) * 2;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.restore();
  }

  // Track info — glass panel
  const panelY = artY + artSize + 60;
  const panelH = 200;
  const panelW = artSize + 60;
  ctx.save();
  roundedRect(ctx, cx - panelW / 2, panelY, panelW, panelH, 30);
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Inner top highlight
  roundedRect(ctx, cx - panelW / 2, panelY, panelW, 1, 0);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fill();
  ctx.restore();

  if (track) {
    // Title
    ctx.font = 'bold 48px "Space Grotesk", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const title = truncateText(ctx, track.title, panelW - 60);
    ctx.fillText(title, cx, panelY + 40);

    // Artist
    ctx.font = '32px "Inter", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    const artist = truncateText(ctx, track.artist || 'Unknown Artist', panelW - 60);
    ctx.fillText(artist, cx, panelY + 105);
  } else {
    ctx.font = 'bold 40px "Space Grotesk", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Waiting for a track...', cx, panelY + 70);
  }

  // Bottom section — "Listening with" + mood
  const bottomY = panelY + panelH + 50;

  // User info
  ctx.font = '28px "Inter", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`${userName} · ${userCount} listening`, cx, bottomY);

  // Mood label
  if (moodLabel) {
    ctx.font = '26px "Inter", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillText(moodLabel, cx, bottomY + 45);
  }

  // Room code pill
  const pillY = bottomY + (moodLabel ? 100 : 60);
  const pillText = `Room: ${roomId}`;
  ctx.font = 'bold 28px "Space Grotesk", sans-serif';
  const pillW = ctx.measureText(pillText).width + 60;
  roundedRect(ctx, cx - pillW / 2, pillY, pillW, 52, 26);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pillText, cx, pillY + 26);

  // Soound logo at bottom
  ctx.font = 'bold 52px "Space Grotesk", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('SOOUND', cx, H - 80);

  ctx.font = '22px "Inter", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillText('Listen together. Anywhere.', cx, H - 45);
}

function simpleHash(str: string): number[] {
  const bytes: number[] = [];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    bytes.push(Math.abs(hash % 256));
  }
  while (bytes.length < 32) {
    hash = ((hash << 5) - hash + bytes.length) | 0;
    bytes.push(Math.abs(hash % 256));
  }
  return bytes;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + '…').width > maxW) {
    t = t.slice(0, -1);
  }
  return t + '…';
}

export const ShareCard: React.FC<ShareCardProps> = ({
  isOpen,
  onClose,
  currentTrack,
  roomId,
  userName,
  userCount,
  moodLabel,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isRendering, setIsRendering] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);

  const renderCard = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsRendering(true);

    if (currentTrack?.cover) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        drawCard(canvas, currentTrack, roomId, userName, userCount, moodLabel, img);
        setPreviewUrl(canvas.toDataURL('image/png'));
        setIsRendering(false);
      };
      img.onerror = () => {
        drawCard(canvas, currentTrack, roomId, userName, userCount, moodLabel, null);
        setPreviewUrl(canvas.toDataURL('image/png'));
        setIsRendering(false);
      };
      img.src = currentTrack.cover;
    } else {
      drawCard(canvas, currentTrack, roomId, userName, userCount, moodLabel, null);
      setPreviewUrl(canvas.toDataURL('image/png'));
      setIsRendering(false);
    }
  }, [currentTrack, roomId, userName, userCount, moodLabel]);

  React.useEffect(() => {
    if (isOpen) {
      renderCard();
    } else {
      setPreviewUrl(null);
    }
  }, [isOpen, renderCard]);

  const handleDownload = () => {
    if (!previewUrl) return;
    const a = document.createElement('a');
    a.href = previewUrl;
    a.download = `soound-${roomId}-${Date.now()}.png`;
    a.click();
  };

  const handleShare = async () => {
    if (!canvasRef.current) return;
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvasRef.current!.toBlob(resolve, 'image/png')
      );
      if (!blob) return;
      const file = new File([blob], `soound-${roomId}.png`, { type: 'image/png' });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Soound — Listen Together',
          text: `Listening to ${currentTrack?.title || 'music'} on Soound! Join room ${roomId}`,
        });
      } else {
        handleDownload();
      }
    } catch {
      handleDownload();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="glass-panel rounded-3xl p-5 max-w-sm w-full flex flex-col items-center gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display font-bold text-lg text-white/90">Share Card</h3>

            {/* Preview */}
            <div className="w-full aspect-[9/16] rounded-2xl overflow-hidden bg-white/5 border border-white/10 relative">
              {previewUrl ? (
                <img src={previewUrl} alt="Share card" className="w-full h-full object-contain" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 w-full">
              <button
                onClick={onClose}
                className="flex-1 py-3.5 rounded-2xl bg-white/10 text-white font-display font-semibold hover:bg-white/20 transition-colors btn-press"
              >
                Close
              </button>
              <button
                onClick={handleShare}
                disabled={isRendering}
                className="flex-[2] py-3.5 rounded-2xl bg-white text-black font-display font-bold hover:bg-gray-200 transition-colors disabled:opacity-50 btn-press flex items-center justify-center gap-2"
              >
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
                  <path d="M4 12V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M16 6L12 2L8 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M12 2V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                Share
              </button>
            </div>

            {/* Hidden canvas */}
            <canvas ref={canvasRef} className="hidden" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
