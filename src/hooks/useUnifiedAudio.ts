/**
 * useUnifiedAudio — Unified audio system with mode switching
 * 
 * Modes:
 * 1. sync (default) — Simple: Host broadcasts position, listeners follow
 * 2. webrtc — Host streams audio via WebRTC, listeners receive directly
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import Peer, { MediaConnection } from 'peerjs';
import { getSocket } from '../lib/socket';

export type AudioMode = 'sync' | 'webrtc' | 'radio';
export type AudioStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'error' | 'connecting' | 'buffering';

interface UnifiedAudioOptions {
  roomId: string;
  trackUrl: string | null;
  isHost: boolean;
  mode: AudioMode;
  onTimeUpdate: (time: number, duration: number) => void;
  onEnded: () => void;
  onStatusChange: (status: AudioStatus, msg?: string) => void;
}

export function useUnifiedAudio({
  roomId,
  trackUrl,
  isHost,
  mode,
  onTimeUpdate,
  onEnded,
  onStatusChange,
}: UnifiedAudioOptions) {
  const socket = getSocket();
  
  // === Core State ===
  const [status, setStatusState] = useState<AudioStatus>('idle');
  const [volume, setVolumeState] = useState(1);
  const isPlayingRef = useRef(false);
  const durationRef = useRef(0);
  
  // === HTML5 Audio (for sync mode) ===
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSyncTimeRef = useRef(0);
  
  // === WebRTC ===
  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Map<string, MediaConnection>>(new Map());
  const listenerAudioRef = useRef<HTMLAudioElement | null>(null);
  
  // === Web Audio for WebRTC mode ===
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playStartTimeRef = useRef(0);
  const playStartPositionRef = useRef(0);

  // Callback refs
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onEndedRef = useRef(onEnded);
  const onStatusChangeRef = useRef(onStatusChange);
  onTimeUpdateRef.current = onTimeUpdate;
  onEndedRef.current = onEnded;
  onStatusChangeRef.current = onStatusChange;

  const setStatus = useCallback((s: AudioStatus, msg?: string) => {
    setStatusState(s);
    onStatusChangeRef.current(s, msg);
  }, []);

  // === Create HTML5 Audio element (for sync mode) ===
  useEffect(() => {
    if (mode !== 'sync') return;
    
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.crossOrigin = 'anonymous';
      // iOS silent mode workaround
      (audio as any).playsInline = true;
      (audio as any).webkitPlaysInline = true;
      audioRef.current = audio;
      console.log('[Audio] HTML5 Audio created');
    }
    
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    };
  }, [mode]);

  // === Load track (sync mode) ===
  useEffect(() => {
    if (mode !== 'sync') return;
    
    const audio = audioRef.current;
    if (!audio || !trackUrl) {
      setStatus('idle');
      return;
    }

    console.log('[Audio] Loading track:', trackUrl);
    setStatus('loading', 'Loading track...');
    
    audio.src = trackUrl;
    audio.load();

    const onCanPlay = () => {
      console.log('[Audio] Track ready, duration:', audio.duration);
      durationRef.current = audio.duration || 0;
      setStatus('ready');
      
      // For listeners: request sync if we don't start playing within 2s
      // This handles late join when sync_play was missed
      if (!isHost) {
        setTimeout(() => {
          if (audio && audio.paused && audio.src) {
            console.log('[Audio] Listener: requesting sync (no play command received)');
            socket.emit('request_sync');
          }
        }, 2000);
      }
    };

    const onError = (e: Event) => {
      console.error('[Audio] Load error:', e);
      setStatus('error', 'Failed to load');
    };

    const onEnded = () => {
      console.log('[Audio] Track ended');
      isPlayingRef.current = false;
      setStatus('ready');
      onEndedRef.current();
    };

    const onTimeUpdate = () => {
      onTimeUpdateRef.current(audio.currentTime, audio.duration || 0);
    };

    const onPlaying = () => {
      isPlayingRef.current = true;
      setStatus('playing');
    };

    const onPause = () => {
      // Only update if we didn't initiate the pause
      if (isPlayingRef.current) {
        isPlayingRef.current = false;
      }
    };

    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('error', onError);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('pause', onPause);

    return () => {
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
    };
  }, [trackUrl, mode, setStatus]);

  // === Host: broadcast position every 500ms (sync mode) ===
  useEffect(() => {
    if (mode !== 'sync' || !isHost) return;

    const interval = setInterval(() => {
      const audio = audioRef.current;
      if (!audio || audio.paused) return;
      
      socket.emit('host_time', {
        position: audio.currentTime,
        duration: audio.duration || 0,
        isPlaying: !audio.paused,
        timestamp: Date.now(),
      });
    }, 500); // Every 500ms

    return () => clearInterval(interval);
  }, [mode, isHost, socket]);

  // === Listener: sync to host position (sync mode) ===
  useEffect(() => {
    if (mode !== 'sync' || isHost) return;

    const handleHostTime = (data: { position: number; duration: number; isPlaying: boolean; timestamp?: number }) => {
      const audio = audioRef.current;
      if (!audio || !audio.src) return;

      // Calculate host position accounting for network delay
      const networkDelay = data.timestamp ? (Date.now() - data.timestamp) / 1000 : 0.1;
      const estimatedHostPos = data.position + networkDelay;

      // Handle play/pause state
      if (data.isPlaying && audio.paused) {
        audio.currentTime = estimatedHostPos;
        audio.play().then(() => {
          isPlayingRef.current = true;
          setStatus('playing');
        }).catch(() => {
          setStatus('ready', 'Tap to play');
        });
      } else if (!data.isPlaying && !audio.paused) {
        audio.pause();
        isPlayingRef.current = false;
        setStatus('paused');
      }

      // Sync position if drifted > 0.5s
      if (data.isPlaying && !audio.paused) {
        const drift = Math.abs(audio.currentTime - estimatedHostPos);
        if (drift > 0.5) {
          console.log(`[Sync] Drift ${drift.toFixed(2)}s → seeking to ${estimatedHostPos.toFixed(2)}s (net delay: ${(networkDelay*1000).toFixed(0)}ms)`);
          audio.currentTime = Math.min(estimatedHostPos, audio.duration || estimatedHostPos);
          lastSyncTimeRef.current = Date.now();
        }
      }
    };

    const handleSimplePlay = (data: { position: number }) => {
      const audio = audioRef.current;
      if (!audio) return;
      
      console.log('[Sync] simple_play at', data.position);
      audio.currentTime = data.position;
      audio.play().then(() => {
        isPlayingRef.current = true;
        setStatus('playing');
      }).catch(() => {
        setStatus('ready', 'Tap to play');
      });
    };

    const handleSimplePause = (data: { position: number }) => {
      const audio = audioRef.current;
      if (!audio) return;
      
      console.log('[Sync] simple_pause at', data.position);
      audio.pause();
      audio.currentTime = data.position;
      isPlayingRef.current = false;
      setStatus('paused');
    };

    const handleSimpleSeek = (data: { position: number }) => {
      const audio = audioRef.current;
      if (!audio) return;
      console.log('[Sync] simple_seek to', data.position);
      audio.currentTime = data.position;
    };

    // Handle sync_play from server (used for late joiners + scheduled playback)
    const handleSyncPlay = (data: { scheduledTime: number; position: number }) => {
      const audio = audioRef.current;
      if (!audio || !audio.src) {
        console.log('[Sync] sync_play received but no audio loaded yet');
        return;
      }
      
      const now = Date.now();
      const delay = data.scheduledTime - now;
      
      console.log(`[Sync] sync_play: pos=${data.position.toFixed(1)}s, scheduled in ${delay}ms`);
      
      const startPlayback = () => {
        // Adjust position for time elapsed since scheduled time
        const elapsed = Math.max(0, (Date.now() - data.scheduledTime) / 1000);
        const targetPos = data.position + elapsed;
        
        audio.currentTime = Math.min(targetPos, audio.duration || targetPos);
        audio.play().then(() => {
          isPlayingRef.current = true;
          setStatus('playing');
          console.log(`[Sync] sync_play started at ${audio.currentTime.toFixed(1)}s`);
        }).catch((e) => {
          console.warn('[Sync] sync_play autoplay blocked:', e.message);
          setStatus('ready', 'Tap to play');
        });
      };
      
      if (delay > 50) {
        // Schedule playback
        setTimeout(startPlayback, delay);
      } else {
        // Start immediately
        startPlayback();
      }
    };

    // Handle sync_pause from server
    const handleSyncPause = (data: { position: number }) => {
      const audio = audioRef.current;
      if (!audio) return;
      
      console.log('[Sync] sync_pause at', data.position);
      audio.pause();
      audio.currentTime = data.position;
      isPlayingRef.current = false;
      setStatus('paused');
    };

    socket.on('host_time', handleHostTime);
    socket.on('simple_play', handleSimplePlay);
    socket.on('simple_pause', handleSimplePause);
    socket.on('simple_seek', handleSimpleSeek);
    socket.on('sync_play', handleSyncPlay);
    socket.on('sync_pause', handleSyncPause);

    return () => {
      socket.off('host_time', handleHostTime);
      socket.off('simple_play', handleSimplePlay);
      socket.off('simple_pause', handleSimplePause);
      socket.off('simple_seek', handleSimpleSeek);
      socket.off('sync_play', handleSyncPlay);
      socket.off('sync_pause', handleSyncPause);
    };
  }, [mode, isHost, socket, setStatus]);

  // =====================================================
  // === WebRTC Mode (unchanged from before) ===
  // =====================================================
  
  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext();
      gainRef.current = audioCtxRef.current.createGain();
      gainRef.current.connect(audioCtxRef.current.destination);
    }
    return audioCtxRef.current;
  }, []);

  const ensureWebRTCDestination = useCallback(() => {
    if (mode !== 'webrtc' || !isHost) return;
    if (!audioCtxRef.current || !gainRef.current) return;
    
    if (!destinationRef.current) {
      destinationRef.current = audioCtxRef.current.createMediaStreamDestination();
      gainRef.current.connect(destinationRef.current);
    }
  }, [mode, isHost]);

  // Load audio buffer for WebRTC mode
  const rawAudioDataRef = useRef<ArrayBuffer | null>(null);
  
  useEffect(() => {
    if (mode !== 'webrtc' || !trackUrl || !isHost) return;

    setStatus('loading');
    
    fetch(trackUrl)
      .then(res => res.arrayBuffer())
      .then(data => {
        rawAudioDataRef.current = data;
        const ctx = getAudioCtx();
        return ctx.decodeAudioData(data.slice(0));
      })
      .then(buffer => {
        bufferRef.current = buffer;
        durationRef.current = buffer.duration;
        setStatus('ready');
      })
      .catch(e => {
        console.error('[WebRTC] Load error:', e);
        setStatus('error');
      });
  }, [trackUrl, mode, isHost, getAudioCtx, setStatus]);

  // WebRTC Peer setup
  useEffect(() => {
    if (mode !== 'webrtc') return;

    const peerId = `soound-${roomId}-${isHost ? 'host' : Math.random().toString(36).slice(2, 8)}`;
    const peer = new Peer(peerId, {
      debug: 0,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ]
      }
    });

    peer.on('open', (id) => {
      console.log(`[WebRTC] Connected: ${id}`);
      if (isHost) {
        socket.emit('webrtc_host_ready', { peerId: id });
      } else {
        socket.emit('webrtc_get_host');
      }
    });

    peer.on('error', (err) => {
      console.error('[WebRTC] Error:', err);
    });

    // Listener receives call
    if (!isHost) {
      peer.on('call', (call) => {
        call.answer();
        call.on('stream', (stream) => {
          if (!listenerAudioRef.current) {
            listenerAudioRef.current = new Audio();
          }
          listenerAudioRef.current.srcObject = stream;
          listenerAudioRef.current.play()
            .then(() => setStatus('playing'))
            .catch(() => setStatus('paused', 'Tap to listen'));
        });
      });
    }

    peerRef.current = peer;

    return () => {
      peer.destroy();
      connectionsRef.current.forEach(c => c.close());
      connectionsRef.current.clear();
    };
  }, [mode, roomId, isHost, socket, setStatus]);

  // WebRTC: Host calls listeners
  useEffect(() => {
    if (mode !== 'webrtc' || !isHost) return;

    const handleListenerJoined = (data: { peerId: string }) => {
      const peer = peerRef.current;
      const dest = destinationRef.current;
      if (!peer || !dest) return;

      const call = peer.call(data.peerId, dest.stream);
      call.on('close', () => connectionsRef.current.delete(data.peerId));
      connectionsRef.current.set(data.peerId, call);
    };

    socket.on('webrtc_listener_joined', handleListenerJoined);
    return () => { socket.off('webrtc_listener_joined', handleListenerJoined); };
  }, [mode, isHost, socket]);

  // WebRTC: Listener connects to host
  useEffect(() => {
    if (mode !== 'webrtc' || isHost) return;

    const handleHostReady = (data: { peerId: string }) => {
      const myId = peerRef.current?.id;
      if (myId) {
        socket.emit('webrtc_listener_join', { peerId: myId });
        setStatus('connecting');
      }
    };

    socket.on('webrtc_host_ready', handleHostReady);
    return () => { socket.off('webrtc_host_ready', handleHostReady); };
  }, [mode, isHost, socket, setStatus]);

  // WebRTC playback helpers
  const startWebRTCPlayback = useCallback((position: number) => {
    const ctx = audioCtxRef.current;
    const buffer = bufferRef.current;
    if (!ctx || !buffer) return;

    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch {}
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gainRef.current!);
    sourceRef.current = source;

    source.start(0, position);
    playStartTimeRef.current = ctx.currentTime;
    playStartPositionRef.current = position;
    isPlayingRef.current = true;
    setStatus('playing');

    source.onended = () => {
      if (isPlayingRef.current) {
        isPlayingRef.current = false;
        onEndedRef.current();
      }
    };
  }, [setStatus]);

  const stopWebRTCPlayback = useCallback(() => {
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch {}
      sourceRef.current = null;
    }
    isPlayingRef.current = false;
  }, []);

  // =====================================================
  // === Public API ===
  // =====================================================

  const play = useCallback((position?: number) => {
    console.log('[Audio] play() called - isHost:', isHost, 'mode:', mode, 'position:', position);

    if (mode === 'sync') {
      const audio = audioRef.current;
      if (!audio) {
        console.error('[Audio] play() - no audio element!');
        return;
      }
      
      console.log('[Audio] play() - audio.src:', audio.src ? 'set' : 'NOT SET', 'readyState:', audio.readyState, 'paused:', audio.paused);

      if (position !== undefined) {
        audio.currentTime = position;
      }

      audio.play().then(() => {
        console.log('[Audio] play() - SUCCESS, currentTime:', audio.currentTime);
        isPlayingRef.current = true;
        setStatus('playing');
        
        if (isHost) {
          console.log('[Audio] Host emitting simple_play at', audio.currentTime);
          socket.emit('simple_play', { position: audio.currentTime });
        }
      }).catch(e => {
        console.error('[Audio] play() - FAILED:', e.name, e.message);
        setStatus('ready', 'Tap to play');
      });
    } else if (mode === 'webrtc' && isHost) {
      getAudioCtx().resume();
      ensureWebRTCDestination();
      
      const pos = position ?? (audioCtxRef.current 
        ? playStartPositionRef.current + (audioCtxRef.current.currentTime - playStartTimeRef.current)
        : 0);
      
      startWebRTCPlayback(pos);
      socket.emit('webrtc_play', { position: pos });
    } else if (mode === 'webrtc' && !isHost && listenerAudioRef.current) {
      listenerAudioRef.current.play().catch(() => {});
    }
  }, [mode, isHost, socket, setStatus, getAudioCtx, ensureWebRTCDestination, startWebRTCPlayback]);

  const pause = useCallback(() => {
    console.log('[Audio] pause() called - isHost:', isHost, 'mode:', mode);

    if (mode === 'sync') {
      const audio = audioRef.current;
      if (!audio) {
        console.error('[Audio] pause() - no audio element!');
        return;
      }

      // Prevent duplicate pause calls
      if (audio.paused && !isPlayingRef.current) {
        console.log('[Audio] pause() - already paused, skipping');
        return;
      }
      
      console.log('[Audio] pause() - pausing at', audio.currentTime);
      audio.pause();
      isPlayingRef.current = false;
      setStatus('paused');

      if (isHost) {
        console.log('[Audio] Host emitting simple_pause at', audio.currentTime);
        socket.emit('simple_pause', { position: audio.currentTime });
      }
    } else if (mode === 'webrtc' && isHost) {
      stopWebRTCPlayback();
      setStatus('paused');
      socket.emit('webrtc_pause');
    }
  }, [mode, isHost, socket, setStatus, stopWebRTCPlayback]);

  const seekTo = useCallback((time: number) => {
    console.log('[Audio] seekTo()', time);

    if (mode === 'sync') {
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = time;
      
      if (isHost) {
        socket.emit('simple_seek', { position: time });
      }
    } else if (mode === 'webrtc' && isHost) {
      if (isPlayingRef.current) {
        stopWebRTCPlayback();
        startWebRTCPlayback(time);
      } else {
        playStartPositionRef.current = time;
      }
      socket.emit('webrtc_seek', { position: time });
    }
  }, [mode, isHost, socket, stopWebRTCPlayback, startWebRTCPlayback]);

  const setVolume = useCallback((vol: number) => {
    setVolumeState(vol);
    if (audioRef.current) audioRef.current.volume = vol;
    if (gainRef.current) gainRef.current.gain.value = vol;
    if (listenerAudioRef.current) listenerAudioRef.current.volume = vol;
  }, []);

  const unlock = useCallback(() => {
    // Only unlock AudioContext — don't touch HTML5 audio (play+pause breaks state)
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    // Unlock listener audio
    if (listenerAudioRef.current) {
      listenerAudioRef.current.play().catch(() => {});
    }
  }, []);

  const getCurrentPosition = useCallback(() => {
    if (mode === 'sync') {
      return audioRef.current?.currentTime || 0;
    } else if (mode === 'webrtc' && audioCtxRef.current) {
      return playStartPositionRef.current + (audioCtxRef.current.currentTime - playStartTimeRef.current);
    }
    return 0;
  }, [mode]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      if (sourceRef.current) try { sourceRef.current.stop(); } catch {}
      if (listenerAudioRef.current) listenerAudioRef.current.srcObject = null;
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
