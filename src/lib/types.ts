export interface Track {
  id: string;
  title: string;
  artist: string;
  url: string;
  cover: string;
  duration?: number;
  source?: 'youtube' | 'upload' | 'default' | 'spotify';
  youtubeId?: string;
  spotifyId?: string;
  album?: string;
  requestedBy?: string;
}

export interface RoomUser {
  socketId: string;
  name: string;
  isHost: boolean;
  userId: string;
}

export interface ChatMessage {
  id: string;
  text: string;
  userId: string;
  userName: string;
  timestamp: number;
  isSystem?: boolean;
}
