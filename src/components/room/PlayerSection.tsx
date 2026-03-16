import React, { useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Track } from '../../lib/types';
import { IconPlay, IconPause, IconNext, IconPrev, IconVolume, IconSearch } from '../CustomIcons';
import { CircularVisualizer } from '../CircularVisualizer';
import { NowPlaying } from './NowPlaying';
import { SoundWaveAvatar } from './SoundWaveAvatar';
import { cn } from '../../lib/utils';

const REACTIONS = [
  { id: 'fire', label: 'Fire', color: '#FF6B35', icon: (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5"><path d="M12 22c-4.97 0-8-3.03-8-7 0-2.5 1.5-5.5 4-7.5L12 4l4 3.5c2.5 2 4 5 4 7.5 0 3.97-3.03 7-8 7z" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.25"/></svg>
  )},
  { id: 'heart', label: 'Love', color: '#FF2D78', icon: (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.25"/></svg>
  )},
  { id: 'clap', label: 'Stellar', color: '#FFD700', icon: (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5"><path d="M12 2L9 9H2l5.5 4.5L5 21l7-5 7 5-2.5-7.5L22 9h-7L12 2z" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.25"/></svg>
  )},
  { id: 'music', label: 'Vibe', color: '#7B68EE', icon: (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5"><path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="1.5"/><circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="1.5"/></svg>
  )},
  { id: 'spark', label: 'Wow', color: '#00D4FF', icon: (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5"><path d="M12 2l2.4 7.2H22l-6 4.8 2.4 7.2L12 16.8 5.6 21.2 8 14 2 9.2h7.6L12 2z" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.2"/></svg>
  )},
];

interface PlayerSectionProps {
    currentTrack: Track | null;
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    isHost: boolean;
    queueCount: number;
    audioElement: HTMLAudioElement | null;
    audioStatus?: string;
    audioStatusMsg?: string;
    onPlayPause: () => void;
    onSeek: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onPlayNext: () => void;
    onPlayPrev: () => void;
    onShowToast: (msg: string) => void;
    onSendReaction: (emoji: string) => void;
    onOpenSearch?: () => void;
}

const formatTime = (time: number) => {
    if (isNaN(time) || !isFinite(time)) return "0:00";
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const PlayerSection: React.FC<PlayerSectionProps> = ({
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    isHost,
    queueCount,
    audioElement,
    onPlayPause,
    onSeek,
    onVolumeChange,
    onPlayNext,
    onPlayPrev,
    onShowToast,
    onSendReaction,
    onOpenSearch,
    audioStatus,
    audioStatusMsg,
}) => {
    const [isMuted, setIsMuted] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [prevVolume, setPrevVolume] = useState(volume);
    const progressRef = useRef<HTMLDivElement>(null);
    const lastSeekTime = useRef(0);

    const seekToPosition = useCallback((clientX: number) => {
        const bar = progressRef.current;
        if (!bar) return;
        const rect = bar.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const time = pct * (duration || 1);
        const synth = { target: { value: String(time) } } as React.ChangeEvent<HTMLInputElement>;
        onSeek(synth);
    }, [duration, onSeek]);

    const handleProgressStart = useCallback((e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
        if (!isHost) {
            onShowToast("Only host can seek");
            return;
        }
        setIsDragging(true);
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        seekToPosition(clientX);
    }, [isHost, seekToPosition, onShowToast]);

    const handleProgressMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        if (!isHost || !isDragging) return;
        const now = Date.now();
        if (now - lastSeekTime.current < 16) return;
        lastSeekTime.current = now;
        seekToPosition(e.touches[0].clientX);
    }, [isHost, isDragging, seekToPosition]);

    const handleProgressEnd = useCallback(() => {
        setIsDragging(false);
    }, []);

    const handleToggleMute = useCallback(() => {
        if (isMuted) {
            const synth = { target: { value: String(prevVolume || 0.5) } } as React.ChangeEvent<HTMLInputElement>;
            onVolumeChange(synth);
            setIsMuted(false);
        } else {
            setPrevVolume(volume);
            const synth = { target: { value: '0' } } as React.ChangeEvent<HTMLInputElement>;
            onVolumeChange(synth);
            setIsMuted(true);
        }
    }, [isMuted, volume, prevVolume, onVolumeChange]);

    const progress = duration ? (currentTime / duration) * 100 : 0;

    return (
        <main className="relative z-10 flex-1 min-h-0 flex flex-col items-center justify-center p-4 md:p-6 w-full max-w-lg mx-auto">
            {currentTrack ? (
                <div className="flex flex-col items-center w-full gap-4">
                    {/* Audio Status Indicator */}
                    {audioStatus && audioStatus !== 'playing' && audioStatus !== 'paused' && audioStatus !== 'idle' && (
                        <div className="flex items-center gap-2 glass-pill px-4 py-2 rounded-full">
                            {(audioStatus === 'loading' || audioStatus === 'buffering') && (
                                <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                            )}
                            {audioStatus === 'error' && (
                                <svg viewBox="0 0 24 24" className="w-4 h-4 text-red-400"><path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>
                            )}
                            <span className="text-xs font-display text-white/60">
                                {audioStatusMsg || audioStatus}
                            </span>
                        </div>
                    )}

                    {/* Album Art — Sound Wave Avatar */}
                    <SoundWaveAvatar
                        trackId={currentTrack.id}
                        trackTitle={currentTrack.title}
                        cover={currentTrack.cover}
                        isPlaying={isPlaying}
                    />

                    {/* Glass Control Panel */}
                    <div className="glass-panel w-full rounded-3xl p-5 flex flex-col gap-4">
                        {/* Track Info */}
                        <NowPlaying currentTrack={currentTrack} />

                        {/* Progress Bar */}
                        <div className="w-full flex items-center gap-3">
                            <span className="text-xs font-display text-white/40 w-10 text-right tabular-nums">
                                {formatTime(currentTime)}
                            </span>
                            <div
                                ref={progressRef}
                                className="progress-bar-container relative flex-1 h-10 flex items-center cursor-pointer touch-none"
                                onClick={handleProgressStart}
                                onTouchStart={handleProgressStart}
                                onTouchMove={handleProgressMove}
                                onTouchEnd={handleProgressEnd}
                            >
                                <div className="progress-track w-full bg-white/10 rounded-full overflow-hidden relative">
                                    <div
                                        className="absolute inset-y-0 left-0 bg-white rounded-full"
                                        style={{ width: `${progress}%`, transition: isDragging ? 'none' : 'width 0.1s linear' }}
                                    />
                                </div>
                                <div
                                    className="progress-dot absolute w-4 h-4 bg-white rounded-full shadow-lg -ml-2 z-10"
                                    style={{ left: `${progress}%` }}
                                />
                            </div>
                            <span className="text-xs font-display text-white/40 w-10 tabular-nums">
                                {formatTime(duration)}
                            </span>
                        </div>

                        {/* Controls */}
                        <div className="flex items-center justify-center gap-6 md:gap-8">
                            <button
                                onClick={() => isHost ? onPlayPrev() : onShowToast("Only host can control playback")}
                                className="btn-press p-3 text-white/40 hover:text-white transition-colors rounded-full hover:bg-white/5 min-w-[44px] min-h-[44px] flex items-center justify-center"
                            >
                                <IconPrev className="w-7 h-7" />
                            </button>
                            <button
                                onClick={onPlayPause}
                                className={cn(
                                    "btn-press w-16 h-16 rounded-full flex items-center justify-center transition-all glass-play-btn",
                                    isPlaying ? "shadow-[0_0_30px_rgba(255,255,255,0.25)]" : "shadow-[0_0_20px_rgba(255,255,255,0.1)]"
                                )}
                            >
                                {isPlaying ? <IconPause className="w-7 h-7" /> : <IconPlay className="w-7 h-7 ml-1" />}
                            </button>
                            <button
                                onClick={() => isHost ? onPlayNext() : onShowToast("Only host can control playback")}
                                className={cn(
                                    "btn-press p-3 transition-colors rounded-full hover:bg-white/5 min-w-[44px] min-h-[44px] flex items-center justify-center",
                                    queueCount > 0 ? "text-white hover:text-white/80" : "text-white/40 hover:text-white"
                                )}
                            >
                                <IconNext className="w-7 h-7" />
                            </button>
                        </div>
                    </div>

                    {/* Bottom Row: Volume | Reactions | Queue count */}
                    <div className="w-full flex items-center justify-between">
                        {/* Volume toggle */}
                        <div className="flex items-center">
                            <button
                                onClick={handleToggleMute}
                                className="btn-press p-2 text-white/40 hover:text-white transition-colors md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center"
                            >
                                {isMuted || volume === 0 ? (
                                    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
                                        <path d="M11 5L6 9H2v6h4l5 4V5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                        <line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                        <line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                    </svg>
                                ) : (
                                    <IconVolume className="w-5 h-5" />
                                )}
                            </button>
                            <div className="hidden md:flex items-center gap-3 w-28 group">
                                <button onClick={handleToggleMute} className="btn-press">
                                    <IconVolume className="w-5 h-5 text-white/40 group-hover:text-white/80 transition-colors" />
                                </button>
                                <input
                                    type="range" min={0} max={1} step={0.01} value={isMuted ? 0 : volume}
                                    onChange={(e) => { setIsMuted(false); onVolumeChange(e); }}
                                    className="volume-slider w-full cursor-pointer"
                                />
                            </div>
                        </div>

                        {/* Reactions — glass pill with colored icons */}
                        <div className="glass-reactions flex items-center gap-0.5 rounded-full px-1.5 py-0.5">
                            {REACTIONS.map((r) => (
                                <button
                                    key={r.id}
                                    onClick={() => onSendReaction(r.id)}
                                    className="btn-press reaction-btn p-2 rounded-full transition-all min-w-[44px] min-h-[44px] flex items-center justify-center"
                                    style={{ color: r.color, '--glow': r.color } as React.CSSProperties}
                                    title={r.label}
                                >
                                    {r.icon}
                                </button>
                            ))}
                        </div>

                        {/* Queue count */}
                        <div className="min-w-[44px] min-h-[44px] flex items-center justify-center">
                            {queueCount > 0 && (
                                <span className="text-xs text-white/40 font-display glass-pill px-2.5 py-1 rounded-full">
                                    {queueCount} in queue
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    className="flex flex-col items-center justify-center gap-6"
                >
                    {/* Music note icon with pulse */}
                    <div className="relative w-40 h-40 flex items-center justify-center">
                        <div className="absolute inset-0 rounded-3xl bg-white/5 animate-pulse" style={{ animationDuration: '3s' }} />
                        <div className="relative w-40 h-40 rounded-3xl bg-white/[0.03] border border-white/10 flex items-center justify-center">
                            <svg viewBox="0 0 24 24" fill="none" className="w-16 h-16 text-white/20">
                                <path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="1.5"/>
                                <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="1.5"/>
                            </svg>
                        </div>
                    </div>

                    <div className="text-center space-y-2">
                        <h3 className="text-xl font-display font-bold text-white/80">No track playing</h3>
                        <p className="text-white/40 text-sm">Search for a song to start listening</p>
                    </div>

                    {onOpenSearch && (
                        <button
                            onClick={onOpenSearch}
                            className="btn-press flex items-center gap-3 px-8 py-4 bg-white text-black font-display font-bold rounded-2xl transition-all shadow-[0_0_30px_rgba(255,255,255,0.1)]"
                        >
                            <IconSearch className="w-5 h-5" />
                            Search
                        </button>
                    )}
                </motion.div>
            )}
        </main>
    );
};
