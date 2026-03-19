import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send } from 'lucide-react';
import { ChatMessage } from '../../lib/types';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  currentUserId: string | null;
}

const formatTimestamp = (timestamp: number) => {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const ChatPanel: React.FC<ChatPanelProps> = ({ messages, onSend, currentUserId }) => {
  const [text, setText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = () => {
    if (text.trim()) {
      onSend(text.trim());
      setText('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full text-white">
      <div className="flex-1 p-4 overflow-y-auto custom-scrollbar">
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                className={`flex flex-col ${
                  msg.userId === currentUserId ? 'items-end' : 'items-start'
                }`}
              >
                {msg.isSystem ? (
                  <div className="w-full text-center my-2">
                    <p className="text-xs text-white/30 font-display">{msg.text}</p>
                  </div>
                ) : (
                  <div
                    className={`flex flex-col max-w-[85%] ${
                      msg.userId === currentUserId ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                       {msg.userId !== currentUserId && (
                        <span className="text-xs font-display font-bold text-white/60">{msg.userName}</span>
                      )}
                      <span className="text-[10px] text-white/25">{formatTimestamp(msg.timestamp)}</span>
                    </div>
                    <div
                      className={`px-4 py-2.5 rounded-2xl ${
                        msg.userId === currentUserId
                          ? 'bg-white/15 rounded-br-sm'
                          : 'bg-white/5 rounded-bl-sm border border-white/5'
                      }`}
                    >
                      <p className="text-sm font-display">{msg.text}</p>
                    </div>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <div ref={messagesEndRef} />
      </div>
      <div className="p-3 border-t border-white/5">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-4 py-2.5 text-sm font-display focus:outline-none focus:border-white/20 transition-colors placeholder:text-white/25"
          />
          <button
            onClick={handleSend}
            className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:bg-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed btn-press shrink-0"
            disabled={!text.trim()}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
