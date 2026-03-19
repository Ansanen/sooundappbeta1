import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Crown, Loader2, Trash2, GripVertical, Send, MessageCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { IconSearch, IconQueue, IconUsers, IconPlay, IconPlus } from '../CustomIcons';
import { RoomUser, Track, ChatMessage } from '../../lib/types';
import { getSocket } from '../../lib/socket';

type DrawerTab = 'search' | 'queue' | 'users' | 'chat';

interface DrawerPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab: DrawerTab;
  isHost: boolean;
  queue: Track[];
  users: RoomUser[];
  userCount: number;
  messages: ChatMessage[];
  currentUserId: string;
  onSelectTrack: (track: any) => void;
  onAddToQueue: (track: any) => void;
  onRemoveFromQueue: (index: number) => void;
  onSendMessage: (text: string) => void;
  allowGuestQueue?: boolean;
  onToggleGuestQueue?: () => void;
}

const formatTime = (time: number) => {
  if (isNaN(time) || !isFinite(time)) return "0:00";
  const mins = Math.floor(time / 60);
  const secs = Math.floor(time % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const hashColor = (name: string): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 50%)`;
};

const RECENT_SEARCHES_KEY = 'soound_recent_searches';
const getRecentSearches = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]').slice(0, 5);
  } catch { return []; }
};
const addRecentSearch = (q: string) => {
  const recent = getRecentSearches().filter(s => s !== q);
  recent.unshift(q);
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recent.slice(0, 5)));
};

export const DrawerPanel: React.FC<DrawerPanelProps> = ({
  isOpen,
  onClose,
  initialTab,
  isHost,
  queue,
  users,
  userCount,
  messages,
  currentUserId,
  onSelectTrack,
  onAddToQueue,
  onRemoveFromQueue,
  onSendMessage,
  allowGuestQueue = true,
  onToggleGuestQueue,
}) => {
  const [activeTab, setActiveTab] = useState<DrawerTab>(initialTab);
  const [chatText, setChatText] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const prevMsgCount = useRef(messages.length);

  // Track unread messages when not on chat tab
  useEffect(() => {
    if (activeTab === 'chat' && isOpen) {
      setUnreadCount(0);
      prevMsgCount.current = messages.length;
    } else if (messages.length > prevMsgCount.current) {
      setUnreadCount(prev => prev + (messages.length - prevMsgCount.current));
      prevMsgCount.current = messages.length;
    }
  }, [messages.length, activeTab, isOpen]);

  // Auto-scroll chat
  useEffect(() => {
    if (activeTab === 'chat') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeTab]);

  const handleSendChat = () => {
    if (!chatText.trim()) return;
    onSendMessage(chatText.trim());
    setChatText('');
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>(getRecentSearches());
  const searchTimeout = useRef<number>();
  const socket = getSocket();

  // Swipe to close
  const touchStartY = useRef(0);
  const touchDeltaY = useRef(0);
  const drawerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    touchDeltaY.current = 0;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const delta = e.touches[0].clientY - touchStartY.current;
    touchDeltaY.current = delta;
    if (drawerRef.current && delta > 0) {
      drawerRef.current.style.transform = `translateY(${delta}px)`;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (touchDeltaY.current > 100) {
      onClose();
    }
    if (drawerRef.current) {
      drawerRef.current.style.transform = '';
    }
  }, [onClose]);

  // Tab refs for animated underline
  const tabRefs = useRef<Record<DrawerTab, HTMLButtonElement | null>>({ search: null, queue: null, users: null, chat: null });
  const [underlineStyle, setUnderlineStyle] = useState({ left: 0, width: 0 });

  useEffect(() => {
    const el = tabRefs.current[activeTab];
    if (el) {
      const parent = el.parentElement;
      if (parent) {
        const parentRect = parent.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        setUnderlineStyle({ left: elRect.left - parentRect.left, width: elRect.width });
      }
    }
  }, [activeTab, isOpen]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    if (searchTimeout.current) clearTimeout(searchTimeout.current);

    searchTimeout.current = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const results = data.results || [];
        setSearchResults(results);
        // Only save to recent if we got results
        if (results.length > 0) {
          addRecentSearch(searchQuery.trim());
          setRecentSearches(getRecentSearches());
        }
      } catch (error) {
        console.error("Search failed:", error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 500);

    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current) };
  }, [searchQuery]);

  const renderContent = () => {
    switch (activeTab) {
      case 'users':
        return (
          <div className="flex-1 overflow-y-auto px-4 py-6 custom-scrollbar">
            <div className="space-y-2">
              {users.map((user) => (
                <div
                  key={user.socketId}
                  className="flex items-center gap-3 p-3 rounded-2xl bg-white/5"
                >
                  <div
                    className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center font-display font-bold text-sm text-white"
                  >
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-display font-bold text-sm text-white/90 truncate">
                      {user.name}
                      {user.socketId === socket.id && <span className="text-white/40 ml-2">(you)</span>}
                    </p>
                    <p className="text-xs text-white/30">in the room</p>
                  </div>
                  {user.isHost && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 text-white border border-white/10">
                      <Crown className="w-3.5 h-3.5" />
                      <span className="text-xs font-display font-bold">Host</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {users.length === 0 && (
              <div className="h-full flex items-center justify-center text-white/30">
                <p className="font-display">No one here yet</p>
              </div>
            )}
          </div>
        );
      case 'search':
        return (
          <>
            <div className="p-4 md:p-6">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <IconSearch className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                  <input
                    type="text"
                    placeholder="Search YouTube..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl pl-12 pr-4 py-3.5 md:py-4 text-base focus:outline-none focus:border-white/30 transition-colors placeholder:text-white/30 text-white font-display"
                  />
                  {isSearching && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 animate-spin" />}
                </div>
                {/* Upload button */}
                <label className="flex items-center justify-center w-14 h-14 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl cursor-pointer transition-colors">
                  <input
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const formData = new FormData();
                      formData.append('audio', file);
                      try {
                        const res = await fetch('/api/upload', { method: 'POST', body: formData });
                        if (res.ok) {
                          const data = await res.json();
                          onAddToQueue({ id: data.id, title: data.title, artist: 'Uploaded', url: data.url, source: 'upload' });
                        }
                      } catch (err) {
                        console.error('Upload failed:', err);
                      }
                      e.target.value = '';
                    }}
                  />
                  <svg className="w-5 h-5 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                </label>
              </div>
              {/* Recent searches */}
              {!searchQuery && recentSearches.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {recentSearches.map((s) => (
                    <button
                      key={s}
                      onClick={() => setSearchQuery(s)}
                      className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-xs text-white/60 font-display transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-6 custom-scrollbar">
              {searchResults.length > 0 ? (
                <div className="space-y-2">
                  {searchResults.map((track) => (
                    <div
                      key={track.id || track.youtubeId}
                      className="w-full flex items-center gap-3 md:gap-4 p-2 md:p-3 rounded-2xl hover:bg-white/5 transition-colors group active:bg-white/10"
                    >
                      <div className="relative w-12 h-12 md:w-14 md:h-14 shrink-0 cursor-pointer" onClick={() => onSelectTrack(track)}>
                        <img src={track.cover} alt={track.title} className="w-full h-full rounded-xl object-cover" referrerPolicy="no-referrer" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-xl transition-opacity">
                          {isHost ? <IconPlay className="w-5 h-5 md:w-6 md:h-6 text-white" /> : <IconPlus className="w-5 h-5 md:w-6 md:h-6 text-white" />}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSelectTrack(track)}>
                        <p className="text-sm md:text-base font-display font-bold text-white/90 group-hover:text-white truncate">{track.title}</p>
                        <p className="text-xs md:text-sm text-white/40 truncate">{track.artist} · {formatTime(track.duration || 0)}</p>
                      </div>
                      <button
                        onClick={() => onAddToQueue(track)}
                        className="p-2 md:w-10 md:h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white hover:text-black transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100 btn-press shrink-0"
                      >
                        <IconPlus className="w-5 h-5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : !isSearching && searchQuery ? (
                <div className="h-full flex flex-col items-center justify-center text-white/30 space-y-4">
                  <IconSearch className="w-12 h-12 opacity-20" />
                  <p className="font-display">No results found</p>
                </div>
              ) : !searchQuery ? (
                <div className="h-full flex flex-col items-center justify-center text-white/30 space-y-4 pt-12">
                    <IconSearch className="w-16 h-16 opacity-20" />
                    <p className="font-display text-lg">Search any song on YouTube</p>
                    <p className="font-display text-sm text-white/20">Full tracks, any artist</p>
                </div>
              ) : null}
            </div>
          </>
        );
      case 'chat':
        return (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-4 py-4 custom-scrollbar">
              <div className="space-y-3">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn("flex flex-col", msg.userId === currentUserId ? "items-end" : "items-start")}
                  >
                    {msg.isSystem ? (
                      <div className="w-full text-center my-1.5">
                        <p className="text-xs text-white/25 font-display">{msg.text}</p>
                      </div>
                    ) : (
                      <div className={cn("max-w-[85%]", msg.userId === currentUserId ? "items-end" : "items-start")}>
                        <div className="flex items-center gap-2 mb-0.5">
                          {msg.userId !== currentUserId && (
                            <span className="text-xs font-display font-bold text-white/50">{msg.userName}</span>
                          )}
                          <span className="text-[10px] text-white/20">
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className={cn(
                          "px-3.5 py-2 rounded-2xl text-sm font-display",
                          msg.userId === currentUserId
                            ? "bg-white/15 rounded-br-sm"
                            : "bg-white/5 rounded-bl-sm border border-white/5"
                        )}>
                          {msg.text}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {messages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-white/25 space-y-3 pt-16">
                    <MessageCircle className="w-12 h-12 opacity-30" />
                    <p className="font-display">No messages yet</p>
                    <p className="font-display text-xs text-white/15">Start the conversation</p>
                  </div>
                )}
              </div>
              <div ref={chatEndRef} />
            </div>
            <div className="p-3 border-t border-white/5">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSendChat(); }}
                  placeholder="Type a message..."
                  className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-4 py-2.5 text-sm font-display focus:outline-none focus:border-white/20 transition-colors placeholder:text-white/25"
                />
                <button
                  onClick={handleSendChat}
                  disabled={!chatText.trim()}
                  className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:bg-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed btn-press shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        );
      case 'queue':
        return (
          <div className="flex-1 overflow-y-auto px-4 py-6 custom-scrollbar">
            {isHost && onToggleGuestQueue && (
              <div className="flex items-center justify-between mb-4 px-1">
                <span className="text-sm font-display text-white/70">Guests can add songs</span>
                <button
                  onClick={onToggleGuestQueue}
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
            )}
            {queue.length > 0 ? (
              <div className="space-y-2">
                {queue.map((track, index) => (
                  <div
                    key={`${track.id}-${index}`}
                    className="w-full flex items-center gap-3 md:gap-4 p-2 md:p-3 rounded-2xl bg-white/5 hover:bg-white/10 transition-colors group"
                  >
                    <div className="flex flex-col items-center gap-0.5 text-white/20 w-6">
                      <GripVertical className="w-4 h-4" />
                      <span className="text-[10px] font-display font-bold">{index + 1}</span>
                    </div>
                    <img src={track.cover} alt={track.title} className="w-12 h-12 md:w-14 md:h-14 rounded-xl object-cover shrink-0" referrerPolicy="no-referrer" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm md:text-base font-display font-bold text-white/90 truncate">{track.title}</p>
                      <p className="text-xs md:text-sm text-white/40 truncate">
                        {track.artist}
                        {track.duration ? <span className="text-white/25"> · {formatTime(track.duration)}</span> : null}
                        {track.requestedBy && <span className="text-white/25"> · by {track.requestedBy}</span>}
                      </p>
                    </div>
                    {isHost && (
                        <button
                        onClick={() => onRemoveFromQueue(index)}
                        className="p-2 md:w-10 md:h-10 rounded-full flex items-center justify-center text-white/40 hover:text-red-400 hover:bg-red-400/10 transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100 btn-press shrink-0"
                        >
                        <Trash2 className="w-5 h-5" />
                        </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-white/30 space-y-4">
                <motion.div
                  animate={{ y: [0, -8, 0] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                >
                  <IconQueue className="w-16 h-16 opacity-20" />
                </motion.div>
                <p className="font-display text-base">Queue is empty</p>
                <p className="font-display text-sm text-white/20">Add songs to keep the music going</p>
                <button
                  onClick={() => setActiveTab('search')}
                  className="px-6 py-2.5 rounded-2xl bg-white text-black hover:scale-105 transition-all text-sm font-display font-bold mt-2 btn-press"
                >
                  Add Songs
                </button>
              </div>
            )}
          </div>
        );
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 z-40 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            ref={drawerRef}
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="absolute bottom-0 left-0 right-0 z-50 h-[85dvh] md:h-auto md:top-0 md:bottom-0 md:left-auto md:w-[420px] bg-[#0a0a0a] md:border-l border-white/10 rounded-t-3xl md:rounded-none flex flex-col shadow-[0_-20px_40px_rgba(0,0,0,0.5)] md:shadow-2xl"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <div className="w-full flex justify-center pt-4 pb-2 md:hidden" onClick={onClose}>
              <div className="w-12 h-1.5 bg-white/20 rounded-full" />
            </div>
            <div className="px-6 pb-4 pt-2 md:pt-8 flex items-center justify-between border-b border-white/5 relative">
              <div className="flex gap-6 relative">
                <button
                  ref={el => { tabRefs.current.search = el; }}
                  onClick={() => setActiveTab('search')}
                  className={cn("font-display font-bold text-xl transition-colors pb-2", activeTab === 'search' ? "text-white" : "text-white/40 hover:text-white/80")}
                >
                  Search
                </button>
                <button
                  ref={el => { tabRefs.current.queue = el; }}
                  onClick={() => setActiveTab('queue')}
                  className={cn("font-display font-bold text-xl transition-colors flex items-center gap-2 pb-2", activeTab === 'queue' ? "text-white" : "text-white/40 hover:text-white/80")}
                >
                  Queue
                  {queue.length > 0 && (
                    <span className="w-5 h-5 bg-white/20 text-white text-xs rounded-full flex items-center justify-center">{queue.length}</span>
                  )}
                </button>
                <button
                  ref={el => { tabRefs.current.chat = el; }}
                  onClick={() => { setActiveTab('chat'); setUnreadCount(0); }}
                  className={cn("font-display font-bold text-xl transition-colors flex items-center gap-2 pb-2", activeTab === 'chat' ? "text-white" : "text-white/40 hover:text-white/80")}
                >
                  Chat
                  {unreadCount > 0 && activeTab !== 'chat' && (
                    <span className="w-5 h-5 bg-white text-black text-xs rounded-full flex items-center justify-center font-bold">{unreadCount > 9 ? '9+' : unreadCount}</span>
                  )}
                </button>
                <button
                  ref={el => { tabRefs.current.users = el; }}
                  onClick={() => setActiveTab('users')}
                  className={cn("font-display font-bold text-xl transition-colors flex items-center gap-2 pb-2", activeTab === 'users' ? "text-white" : "text-white/40 hover:text-white/80")}
                >
                  <IconUsers className="w-5 h-5" />
                  <span className="w-5 h-5 bg-white/20 text-white text-xs rounded-full flex items-center justify-center">{userCount}</span>
                </button>
                {/* Animated underline */}
                <div
                  className="tab-underline absolute bottom-0 h-0.5 bg-white rounded-full"
                  style={{ left: underlineStyle.left, width: underlineStyle.width }}
                />
              </div>
              <button onClick={onClose} className="text-white/50 hover:text-white p-2 -mr-2 rounded-full hover:bg-white/10 transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            {renderContent()}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
