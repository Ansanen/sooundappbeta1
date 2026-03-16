import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getSocket } from '../lib/socket';
import { Track, RoomUser } from '../lib/types';

interface Reaction {
  id: string;
  emoji: string;
  x: number;
}

interface RoomOptions {
  isPrivate?: boolean;
  password?: string;
  allowGuestQueue?: boolean;
}

const useRoom = (roomId: string, userId: string, userName: string, options?: RoomOptions) => {
  const socket = getSocket();
  const [isHost, setIsHost] = useState(false);
  const [hostSocketId, setHostSocketId] = useState<string>('');
  const [userCount, setUserCount] = useState(1);
  const [users, setUsers] = useState<RoomUser[]>([]);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [queue, setQueue] = useState<Track[]>([]);
  const [duration, setDuration] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [allowGuestQueue, setAllowGuestQueue] = useState(true);

  // Live stream state
  const [liveStatus, setLiveStatus] = useState<'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'error'>('idle');
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveCurrentTime, setLiveCurrentTime] = useState(0);
  const isHostRef = useRef(false);
  
  const isPlayingRef = useRef(isPlaying);
  const currentTrackRef = useRef<Track | null>(currentTrack);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
    currentTrackRef.current = currentTrack;
  }, [isPlaying, currentTrack]);

  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const emit = {
    play: (pos: number) => socket.emit('play', { position: pos }),
    pause: (pos: number) => socket.emit('pause', { position: pos }),
    seek: (pos: number) => socket.emit('seek', { position: pos }),
    changeTrack: (track: Track) => socket.emit('change_track', { track }),
    addToQueue: (track: Track) => socket.emit('add_to_queue', { track }),
    removeFromQueue: (index: number) => socket.emit('remove_from_queue', { index }),
    playNext: () => socket.emit('play_next'),
    reaction: (emoji: string) => socket.emit('reaction', { emoji }),
    requestSync: () => socket.emit('request_sync'),
    hostPosition: (pos: number) => socket.emit('host_position', { position: pos }),
    toggleGuestQueue: () => socket.emit('toggle_guest_queue'),
    livePlay: (pos?: number) => socket.emit('live_play', { position: pos }),
    livePause: () => socket.emit('live_pause'),
    liveSeek: (pos: number) => socket.emit('live_seek', { position: pos }),
    liveTime: (currentTime: number, duration: number) => socket.emit('live_time', { currentTime, duration }),
  };
  
  useEffect(() => {
    const handleRoomState = (state: any) => {
      setHostSocketId(state.hostSocketId);
      setUserCount(state.userCount);
      setQueue(state.queue || []);
      setUsers(state.users || []);
      setCurrentTrack(state.currentTrack || null);
      setIsPlaying(state.isPlaying || false);
      setDuration(state.liveStreamDuration || state.currentTrack?.duration || 0);
      if (state.allowGuestQueue !== undefined) setAllowGuestQueue(state.allowGuestQueue);
      // Set live URL for late joiners
      if (state.liveStreamUrl) {
        setLiveUrl(state.liveStreamUrl + '?t=' + Date.now());
        setLiveStatus('ready');
      }
    };
    
    const handleSync = (state: any) => {
      setHostSocketId(state.hostSocketId);
      setUserCount(state.userCount);
      setQueue(state.queue || []);
      setUsers(state.users || []);

      if (state.currentTrack?.id !== currentTrackRef.current?.id) {
        setCurrentTrack(state.currentTrack || null);
        setDuration(state.liveStreamDuration || state.currentTrack?.duration || 0);
        // New track — update live URL
        if (state.liveStreamUrl) {
          setLiveUrl(state.liveStreamUrl + '?t=' + Date.now());
          setLiveStatus('ready');
        }
      }
      setIsPlaying(state.isPlaying || false);
      if (state.allowGuestQueue !== undefined) setAllowGuestQueue(state.allowGuestQueue);
    };

    const joinRoom = () => {
      socket.emit('join_room', {
        roomId,
        userId,
        name: userName,
        isPrivate: options?.isPrivate,
        password: options?.password,
        allowGuestQueue: options?.allowGuestQueue,
      });
    };

    socket.on('connect', joinRoom);
    socket.on('reconnect', joinRoom);
    
    socket.on('room_state', handleRoomState);
    socket.on('sync', handleSync);
    
    socket.on('host_changed', ({ hostSocketId: newHostSocketId }: { hostSocketId: string }) => {
      setHostSocketId(newHostSocketId);
      if (newHostSocketId === socket.id) {
        showToast("You are now the host");
      }
    });

    socket.on('user_count', (count: number) => setUserCount(count));
    socket.on('queue_updated', (data: { queue: Track[] }) => setQueue(data.queue));
    socket.on('users_updated', (data: { users: RoomUser[] }) => setUsers(data.users));
    
    socket.on('song_requested', (data: { track: Track; by: string }) => {
      showToast(`🎵 ${data.by} requested: ${data.track.title}`);
    });

    socket.on('room_settings', (data: any) => {
      if (data.allowGuestQueue !== undefined) setAllowGuestQueue(data.allowGuestQueue);
    });

    socket.on('join_error', (data: { error: string }) => {
      if (data.error === 'wrong_password') {
        showToast('Wrong room password');
      }
    });

    socket.on('queue_error', (data: { message: string }) => {
      showToast(data.message);
    });

    socket.on('reaction', (data: Reaction) => {
      setReactions(prev => [...prev, data]);
      setTimeout(() => setReactions(prev => prev.filter(r => r.id !== data.id)), 3000);
    });

    socket.on('live_status', (data: any) => {
      if (data.status === 'loading') {
        setLiveStatus('loading');
        setLiveError(null);
      } else if (data.status === 'ready') {
        setLiveStatus('ready');
        setDuration(data.duration || 0);
      } else if (data.status === 'error') {
        setLiveStatus('error');
        setLiveError(data.error);
      }
    });

    socket.on('live_stream_ready', (data: any) => {
      setLiveUrl(data.url + '?t=' + Date.now());
      setLiveStatus('playing');
      setDuration(data.duration || 0);
      if (data.currentTime) setLiveCurrentTime(data.currentTime);
    });

    socket.on('live_playing', (data: any) => {
      setLiveStatus('playing');
      setIsPlaying(true);
    });

    socket.on('live_paused', (data: any) => {
      setLiveStatus('paused');
      setIsPlaying(false);
    });

    socket.on('live_seeked', (data: any) => {
      setLiveUrl(`/api/live/${roomId}?t=${Date.now()}`);
      setLiveStatus('playing');
    });

    socket.on('live_time', (data: any) => {
      if (!isHostRef.current) {
        setLiveCurrentTime(data.currentTime);
        setDuration(data.duration || duration);
      }
    });

    if (socket.connected) {
      joinRoom();
    }

    return () => {
      socket.off('connect', joinRoom);
      socket.off('reconnect', joinRoom);
      socket.off('room_state', handleRoomState);
      socket.off('sync', handleSync);
      socket.off('host_changed');
      socket.off('user_count');
      socket.off('queue_updated');
      socket.off('users_updated');
      socket.off('song_requested');
      socket.off('room_settings');
      socket.off('join_error');
      socket.off('queue_error');
      socket.off('reaction');
      socket.off('live_status');
      socket.off('live_stream_ready');
      socket.off('live_playing');
      socket.off('live_paused');
      socket.off('live_seeked');
      socket.off('live_time');
    };
  }, [roomId, userId, userName, socket, showToast]);

  useEffect(() => {
    setIsHost(socket.id === hostSocketId);
  }, [socket.id, hostSocketId]);

  return {
    isHost,
    hostSocketId,
    userCount,
    users,
    currentTrack,
    isPlaying,
    queue,
    duration,
    toast,
    reactions,
    allowGuestQueue,
    emit,
    showToast,
    liveStatus,
    liveUrl,
    liveError,
    liveCurrentTime,
  };
};

export default useRoom;
