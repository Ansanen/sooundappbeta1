import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PaperAirplaneIcon } from '@heroicons/react/24/solid';
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

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white">
      <div className="flex-1 p-4 overflow-y-auto">
        <div className="space-y-4">
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                layout
                initial={{ opacity: 0, scale: 0.8, y: 50 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.2 } }}
                className={`flex flex-col ${
                  msg.userId === currentUserId ? 'items-end' : 'items-start'
                }`}
              >
                {msg.isSystem ? (
                  <div className="w-full text-center my-2">
                    <p className="text-xs text-gray-400 italic">{msg.text}</p>
                  </div>
                ) : (
                  <div
                    className={`flex flex-col max-w-xs md:max-w-md lg:max-w-lg ${
                      msg.userId === currentUserId ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                       {msg.userId !== currentUserId && (
                        <span className="text-xs font-bold text-gray-300">{msg.userName}</span>
                      )}
                      <span className="text-xs text-gray-500">{formatTimestamp(msg.timestamp)}</span>
                    </div>
                    <div
                      className={`px-4 py-2 rounded-lg mt-1 ${
                        msg.userId === currentUserId
                          ? 'bg-blue-600 rounded-br-none'
                          : 'bg-gray-700 rounded-bl-none'
                      }`}
                    >
                      <p className="text-sm">{msg.text}</p>
                    </div>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <div ref={messagesEndRef} />
      </div>
      <div className="p-4 bg-gray-800 border-t border-gray-700">
        <div className="flex items-center space-x-2">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type a message..."
            className="flex-1 bg-gray-700 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleSend}
            className="bg-blue-600 text-white rounded-full p-2 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            disabled={!text.trim()}
          >
            <PaperAirplaneIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
