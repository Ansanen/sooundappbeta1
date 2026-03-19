/**
 * useWebRTCStream — Host streams audio directly to listeners via WebRTC
 * 
 * How it works:
 * 1. Host loads audio into Web Audio API
 * 2. Creates MediaStreamDestination to capture audio output
 * 3. Uses PeerJS to stream to all connected listeners
 * 4. Listeners receive one unified audio stream — perfect sync
 * 
 * Latency: ~100-300ms depending on network
 * Sync: Perfect (single source)
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import Peer, { MediaConnection } from 'peerjs';
import { getSocket } from '../lib/socket';

export type StreamStatus = 'idle' | 'connecting' | 'streaming' | 'listening' | 'error';

interface WebRTCStreamOptions {
  roomId: string;
  isHost: boolean;
  trackUrl: string | null;
  onTimeUpdate: (time: number, duration: number) => void;
  onEnded: () => void;
  onStatusChange: (status: StreamStatus, msg?: string) => void;
}

export function useWebRTCStream({
  roomId,
  isHost,
  trackUrl,
  onTimeUpdate,
  onEnded,
  onStatusChange,
}: WebRTCStreamOptions) {
  const socket = getSocket();
  
  // Audio
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  
  // WebRTC
  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Map<string, MediaConnection>>(new Map());
  const incomingStreamRef = useRef<MediaStream | null>(null);
  const listenerAudioRef = useRef<HTMLAudioElement | null>(null);
  
  // State
  const [status, setStatusState] = useState<StreamStatus>('idle');
  const [volume, setVolumeState] = useState(1);
  const isPlayingRef = useRef(false);
  const playStartTimeRef = useRef(0);
  const playStartPositionRef = useRef(0);
  const durationRef = useRef(0);
  const animFrameRef = useRef(0);

  // Callbacks refs
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onEndedRef = useRef(onEnded);
  const onStatusChangeRef = useRef(onStatusChange);
  onTimeUpdateRef.current = onTimeUpdate;
  onEndedRef.current = onEnded;
  onStatusChangeRef.current = onStatusChange;

  const setStatus = useCallback((s: StreamStatus, msg?: string) => {
    setStatusState(s);
    onStatusChangeRef.current(s, msg);
  }, []);

  // === Initialize PeerJS ===
  useEffect(() => {
    const peerId = `soound-${roomId}-${isHost ? 'host' : socket.id}`;
    
    const peer = new Peer(peerId, {
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ]
      }
    });

    peer.on('open', (id) => {
      console.log(`[WebRTC] Peer connected: ${id}`);
      if (isHost) {
        // Tell server we're ready to accept connections
        socket.emit('webrtc_host_ready', { peerId: id });
      }
    });

    peer.on('error', (err) => {
      console.error('[WebRTC] Peer error:', err);
      setStatus('error', err.message);
    });

    // Listener: receive incoming call from host
    if (!isHost) {
      peer.on('call', (call) => {
        console.log('[WebRTC] Incoming call from host');
        call.answer(); // Answer with no stream (we're just receiving)
        
        call.on('stream', (remoteStream) => {
          console.log('[WebRTC] Receiving audio stream');
          incomingStreamRef.current = remoteStream;
          
          // Create audio element to play the stream
          if (!listenerAudioRef.current) {
            listenerAudioRef.current = new Audio();
            listenerAudioRef.current.autoplay = true;
          }
          listenerAudioRef.current.srcObject = remoteStream;
          listenerAudioRef.current.play().catch(() => {
            setStatus('error', 'Tap to listen');
          });
          setStatus('listening');
        });

        call.on('close', () => {
          console.log('[WebRTC] Call closed');
          setStatus('idle');
        });
      });
    }

    peerRef.current = peer;

    return () => {
      peer.destroy();
      connectionsRef.current.forEach(conn => conn.close());
      connectionsRef.current.clear();
    };
  }, [roomId, isHost, socket, setStatus]);

  // === Host: Load and decode audio ===
  useEffect(() => {
    if (!isHost || !trackUrl) return;

    // Initialize AudioContext with destination for streaming
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
      gainRef.current = audioCtxRef.current.createGain();
      destinationRef.current = audioCtxRef.current.createMediaStreamDestination();
      
      // Connect gain to both speakers and stream destination
      gainRef.current.connect(audioCtxRef.current.destination);
      gainRef.current.connect(destinationRef.current);
    }

    const ctx = audioCtxRef.current;
    setStatus('connecting', 'Loading audio...');

    fetch(trackUrl)
      .then(res => res.arrayBuffer())
      .then(data => ctx.decodeAudioData(data))
      .then(buffer => {
        bufferRef.current = buffer;
        durationRef.current = buffer.duration;
        console.log(`[WebRTC] Audio decoded: ${buffer.duration.toFixed(1)}s`);
        setStatus('idle', 'Ready');
      })
      .catch(err => {
        console.error('[WebRTC] Load error:', err);
        setStatus('error', 'Failed to load');
      });
  }, [isHost, trackUrl, setStatus]);

  // === Host: Stream to new listeners ===
  useEffect(() => {
    if (!isHost) return;

    const handleListenerJoined = (data: { peerId: string }) => {
      const peer = peerRef.current;
      const destination = destinationRef.current;
      if (!peer || !destination) return;

      console.log(`[WebRTC] Calling listener: ${data.peerId}`);
      const call = peer.call(data.peerId, destination.stream);
      
      call.on('close', () => {
        connectionsRef.current.delete(data.peerId);
        console.log(`[WebRTC] Listener disconnected: ${data.peerId}`);
      });

      connectionsRef.current.set(data.peerId, call);
    };

    socket.on('webrtc_listener_joined', handleListenerJoined);
    return () => { socket.off('webrtc_listener_joined', handleListenerJoined); };
  }, [isHost, socket]);

  // === Listener: Request stream from host ===
  useEffect(() => {
    if (isHost) return;

    const handleHostReady = (data: { peerId: string }) => {
      console.log(`[WebRTC] Host is ready: ${data.peerId}`);
      // Tell server we want to connect
      const myPeerId = peerRef.current?.id;
      if (myPeerId) {
        socket.emit('webrtc_listener_join', { peerId: myPeerId });
      }
    };

    socket.on('webrtc_host_ready', handleHostReady);
    
    // Also request current host on join
    socket.emit('webrtc_get_host');

    return () => { socket.off('webrtc_host_ready', handleHostReady); };
  }, [isHost, socket]);

  // === Time update loop ===
  useEffect(() => {
    if (!isHost) return;
    
    const tick = () => {
      if (isPlayingRef.current && audioCtxRef.current) {
        const elapsed = audioCtxRef.current.currentTime - playStartTimeRef.current;
        const pos = playStartPositionRef.current + elapsed;
        onTimeUpdateRef.current(pos, durationRef.current);
        
        // Broadcast to listeners for progress bar
        socket.emit('webrtc_time', { currentTime: pos, duration: durationRef.current });
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isHost, socket]);

  // Listener: receive time updates
  useEffect(() => {
    if (isHost) return;
    const handleTime = (data: { currentTime: number; duration: number }) => {
      onTimeUpdateRef.current(data.currentTime, data.duration);
      durationRef.current = data.duration;
    };
    socket.on('webrtc_time', handleTime);
    return () => { socket.off('webrtc_time', handleTime); };
  }, [isHost, socket]);

  // === Playback controls (Host only) ===
  const play = useCallback((position?: number) => {
    if (!isHost) return;
    const ctx = audioCtxRef.current;
    const buffer = bufferRef.current;
    if (!ctx || !buffer) return;

    // Resume context if suspended
    if (ctx.state === 'suspended') ctx.resume();

    // Stop existing source
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch {}
    }

    // Create new source
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gainRef.current!);
    sourceRef.current = source;

    const pos = position ?? playStartPositionRef.current;
    source.start(0, pos);
    
    playStartTimeRef.current = ctx.currentTime;
    playStartPositionRef.current = pos;
    isPlayingRef.current = true;
    setStatus('streaming');

    source.onended = () => {
      if (isPlayingRef.current) {
        isPlayingRef.current = false;
        setStatus('idle');
        onEndedRef.current();
      }
    };

    // Notify listeners
    socket.emit('webrtc_play', { position: pos });
  }, [isHost, socket, setStatus]);

  const pause = useCallback(() => {
    if (!isHost) return;
    if (sourceRef.current) {
      const ctx = audioCtxRef.current;
      if (ctx) {
        const elapsed = ctx.currentTime - playStartTimeRef.current;
        playStartPositionRef.current += elapsed;
      }
      try { sourceRef.current.stop(); } catch {}
    }
    isPlayingRef.current = false;
    setStatus('idle');
    socket.emit('webrtc_pause');
  }, [isHost, socket, setStatus]);

  const seekTo = useCallback((time: number) => {
    if (!isHost) return;
    if (isPlayingRef.current) {
      play(time);
    } else {
      playStartPositionRef.current = time;
    }
    socket.emit('webrtc_seek', { position: time });
  }, [isHost, play, socket]);

  const setVolume = useCallback((vol: number) => {
    setVolumeState(vol);
    if (isHost && gainRef.current) {
      gainRef.current.gain.value = vol;
    }
    if (!isHost && listenerAudioRef.current) {
      listenerAudioRef.current.volume = vol;
    }
  }, [isHost]);

  // Listener: unlock audio
  const unlock = useCallback(() => {
    if (listenerAudioRef.current) {
      listenerAudioRef.current.play().catch(() => {});
    }
  }, []);

  const getCurrentPosition = useCallback(() => {
    if (!isHost || !audioCtxRef.current || !isPlayingRef.current) {
      return playStartPositionRef.current;
    }
    const elapsed = audioCtxRef.current.currentTime - playStartTimeRef.current;
    return playStartPositionRef.current + elapsed;
  }, [isHost]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (sourceRef.current) {
        try { sourceRef.current.stop(); } catch {}
      }
      if (listenerAudioRef.current) {
        listenerAudioRef.current.srcObject = null;
      }
    };
  }, []);

  return {
    status,
    volume,
    setVolume,
    play,
    pause,
    seekTo,
    unlock,
    getCurrentPosition,
    duration: durationRef.current,
    isPlaying: isPlayingRef.current,
  };
}
