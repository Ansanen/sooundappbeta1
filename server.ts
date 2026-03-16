import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import https from "https";
import path from "path";
import { execSync, exec } from "child_process";
import { nanoid } from "nanoid";

const DENO_PATH = "/root/.deno/bin/deno";
const YT_DLP = "/usr/local/bin/yt-dlp";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingInterval: 3000,
    pingTimeout: 8000,
  });

  const PORT = parseInt(process.env.PORT || "3463");

  // ===================== TYPES =====================
  interface ChatMessage {
    id: string;
    text: string;
    userId: string;
    userName: string;
    timestamp: number;
    isSystem?: boolean;
  }

  interface Track {
    id: string;
    title: string;
    artist: string;
    url: string;       // streaming URL (may expire)
    cover: string;
    duration: number;   // seconds
    source: "youtube" | "upload" | "default";
    youtubeId?: string; // for re-resolving expired URLs
  }

  interface UserInfo {
    userId: string;
    name: string;
    joinedAt: number;
  }

  interface QueueItem extends Track {
    requestedBy: string; // user name
  }

  interface RoomState {
    id: string;
    hostSocketId: string;
    currentTrack: Track | null;
    isPlaying: boolean;
    positionAtStart: number;
    playbackStartedAt: number;
    users: Map<string, UserInfo>;
    queue: QueueItem[];
    messages: ChatMessage[];
    isPrivate: boolean;
    password?: string;
    allowGuestQueue: boolean;
  }

  const rooms = new Map<string, RoomState>();

  // ===================== LIVE STREAM (RADIO MODEL) =====================
  interface LiveStream {
    roomId: string;
    trackId: string;
    buffer: Buffer | null;
    duration: number;
    bitrate: number;
    byteRate: number;
    isPlaying: boolean;
    playStartedAt: number;
    playStartByte: number;
    isLoading: boolean;
    loadError: string | null;
    clients: Map<string, { res: any; intervalId: any }>;
  }

  const liveStreams = new Map<string, LiveStream>();

  function getCurrentByte(stream: LiveStream): number {
    if (!stream.isPlaying || !stream.buffer) return stream.playStartByte;
    const elapsed = (Date.now() - stream.playStartedAt) / 1000;
    const byte = stream.playStartByte + Math.floor(elapsed * stream.byteRate);
    return Math.min(byte, stream.buffer.length);
  }

  function startStreamingToClients(stream: LiveStream) {
    io.to(stream.roomId).emit('live_stream_ready', {
      trackId: stream.trackId,
      duration: stream.duration,
      url: `/api/live/${stream.roomId}`,
      currentTime: getCurrentByte(stream) / stream.byteRate,
    });
  }

  async function downloadAndConvert(videoId: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, PATH: `/root/.deno/bin:${process.env.PATH}` };
      const cmd = `${YT_DLP} -o - -f "bestaudio" "https://www.youtube.com/watch?v=${videoId}" 2>/dev/null | /usr/bin/ffmpeg -i pipe:0 -f mp3 -ab 192k -v quiet pipe:1`;
      exec(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: 60000, env, encoding: 'buffer' }, (err, stdout) => {
        if (err) { reject(new Error(`Failed to load track: ${err.message}`)); return; }
        if (!stdout || stdout.length < 1000) { reject(new Error('Empty audio output')); return; }
        console.log(`[Live] Track loaded: ${(stdout.length / 1024 / 1024).toFixed(1)}MB MP3`);
        resolve(stdout);
      });
    });
  }

  async function loadTrackForRoom(roomId: string, videoId: string): Promise<void> {
    let stream = liveStreams.get(roomId);
    if (!stream) {
      stream = { roomId, trackId: '', buffer: null, duration: 0, bitrate: 192000, byteRate: 24000, isPlaying: false, playStartedAt: 0, playStartByte: 0, isLoading: false, loadError: null, clients: new Map() };
      liveStreams.set(roomId, stream);
    }
    stream.isPlaying = false;
    stream.isLoading = true;
    stream.loadError = null;
    stream.trackId = videoId;
    io.to(roomId).emit('live_status', { status: 'loading', trackId: videoId });
    try {
      const mp3Buffer = await downloadAndConvert(videoId);
      stream.buffer = mp3Buffer;
      stream.duration = mp3Buffer.length / stream.byteRate;
      stream.isLoading = false;
      stream.isPlaying = true;
      stream.playStartedAt = Date.now();
      stream.playStartByte = 0;
      io.to(roomId).emit('live_status', { status: 'ready', trackId: videoId, duration: stream.duration });
      startStreamingToClients(stream);
    } catch (e: any) {
      stream.isLoading = false;
      stream.loadError = e.message;
      io.to(roomId).emit('live_status', { status: 'error', error: e.message });
    }
  }

  // URL cache for yt-dlp results (expire after 4 hours)
  const urlCache = new Map<string, { url: string; resolvedAt: number }>();
  const URL_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

  // ===================== HELPERS =====================

  /** Create and add a system message to a room */
  function addSystemMessage(room: RoomState, text: string) {
    const message: ChatMessage = {
      id: nanoid(),
      text,
      userId: "system",
      userName: "System",
      timestamp: Date.now(),
      isSystem: true,
    };
    room.messages.push(message);
    if (room.messages.length > 50) {
      room.messages.shift();
    }
    io.to(room.id).emit("chat_message", message);
  }

  /** Get the authoritative playback position right now */
  function getCurrentPosition(room: RoomState): number {
    if (!room.isPlaying || room.playbackStartedAt === 0) {
      return room.positionAtStart;
    }
    const elapsed = (Date.now() - room.playbackStartedAt) / 1000;
    return room.positionAtStart + elapsed;
  }

  /** Build a sync payload that clients use to align */
  function buildSyncPayload(room: RoomState) {
    const users = Array.from(room.users.entries()).map(([sid, u]) => ({
      socketId: sid,
      userId: u.userId,
      name: u.name,
      isHost: sid === room.hostSocketId,
    }));
    // Deduplicate by userId (same user reconnecting)
    const seen = new Set<string>();
    const uniqueUsers = users.filter(u => {
      if (seen.has(u.userId)) return false;
      seen.add(u.userId);
      return true;
    });

    return {
      currentTrack: room.currentTrack,
      isPlaying: room.isPlaying,
      position: getCurrentPosition(room),
      serverTime: Date.now(),
      playbackStartedAt: room.playbackStartedAt,
      positionAtStart: room.positionAtStart,
      queue: room.queue,
      hostSocketId: room.hostSocketId,
      userCount: uniqueUsers.length,
      users: uniqueUsers,
      messages: room.messages,
      isPrivate: room.isPrivate,
      allowGuestQueue: room.allowGuestQueue,
      liveStreamUrl: liveStreams.has(room.roomId) && liveStreams.get(room.roomId)!.buffer 
        ? `/api/live/${room.roomId}` : null,
      liveStreamDuration: liveStreams.has(room.roomId) ? liveStreams.get(room.roomId)!.duration : 0,
    };
  }

  /** Resolve YouTube audio URL via yt-dlp */
  async function resolveYouTubeUrl(videoId: string): Promise<string> {
    const cached = urlCache.get(videoId);
    if (cached && Date.now() - cached.resolvedAt < URL_CACHE_TTL) {
      return cached.url;
    }

    return new Promise((resolve, reject) => {
      const env = { ...process.env, PATH: `${path.dirname(DENO_PATH)}:${process.env.PATH}` };
      exec(
        `${YT_DLP} --get-url -f "bestaudio[ext=webm]/bestaudio" "https://www.youtube.com/watch?v=${videoId}"`,
        { timeout: 15000, env },
        (err, stdout, stderr) => {
          if (err) {
            console.error(`yt-dlp error for ${videoId}:`, stderr);
            reject(new Error(`Failed to resolve: ${videoId}`));
            return;
          }
          const url = stdout.trim().split("\n")[0];
          if (!url) {
            reject(new Error(`Empty URL for ${videoId}`));
            return;
          }
          urlCache.set(videoId, { url, resolvedAt: Date.now() });
          resolve(url);
        }
      );
    });
  }

  /** Search YouTube via yt-dlp */
  async function searchYouTube(query: string, limit = 10): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, PATH: `${path.dirname(DENO_PATH)}:${process.env.PATH}` };
      exec(
        `${YT_DLP} --dump-json --flat-playlist --no-download "ytsearch${limit}:${query.replace(/"/g, '\\"')}"`,
        { timeout: 20000, maxBuffer: 5 * 1024 * 1024, env },
        (err, stdout) => {
          if (err) {
            console.error("Search error:", err.message);
            resolve([]);
            return;
          }
          try {
            const results = stdout.trim().split("\n").filter(Boolean).map(line => {
              const j = JSON.parse(line);
              return {
                id: j.id,
                title: j.title || "Unknown",
                artist: j.uploader || j.channel || "Unknown",
                duration: j.duration || 0,
                cover: j.thumbnail || j.thumbnails?.[0]?.url || `https://img.youtube.com/vi/${j.id}/hqdefault.jpg`,
                youtubeId: j.id,
              };
            });
            resolve(results);
          } catch (e) {
            console.error("Parse error:", e);
            resolve([]);
          }
        }
      );
    });
  }

  // ===================== SOCKET.IO =====================

  io.on("connection", (socket) => {
    console.log(`[+] ${socket.id} connected`);
    let currentRoomId: string | null = null;
    let currentUserId: string | null = null;

    // === NTP-style time sync ===
    socket.on("time_sync", (clientTime: number) => {
      socket.emit("time_sync_response", {
        clientTime,
        serverTime: Date.now(),
      });
    });

    // === Join room ===
    socket.on("join_room", (payload: { roomId: string; userId: string; name?: string; isPrivate?: boolean; password?: string; allowGuestQueue?: boolean }) => {
      const { roomId, userId } = payload;
      const name = payload.name || `User ${userId.substring(0, 4)}`;
      const oldRoomId = currentRoomId;

      // Leave current room if any
      if (oldRoomId && rooms.has(oldRoomId)) {
        socket.leave(oldRoomId);
        const oldRoom = rooms.get(oldRoomId)!;
        const oldUser = oldRoom.users.get(socket.id);
        if(oldUser) {
           addSystemMessage(oldRoom, `${oldUser.name} has left`);
        }
        oldRoom.users.delete(socket.id);
        broadcastUserCount(oldRoomId, oldRoom);
        maybeTransferHost(oldRoomId, oldRoom);
      }

      socket.join(roomId);
      currentRoomId = roomId;
      currentUserId = userId;
      console.log(`[room] ${socket.id} (${userId}) joined room ${roomId}, total rooms: ${rooms.size + (rooms.has(roomId) ? 0 : 1)}`);

      if (!rooms.has(roomId)) {
        rooms.set(roomId, {
          id: roomId,
          hostSocketId: socket.id,
          currentTrack: null,
          isPlaying: false,
          positionAtStart: 0,
          playbackStartedAt: 0,
          users: new Map(),
          queue: [],
          messages: [],
          isPrivate: payload.isPrivate || false,
          password: payload.password || undefined,
          allowGuestQueue: payload.allowGuestQueue !== false,
        });
      }

      const room = rooms.get(roomId)!;

      // Check password for private rooms
      if (room.isPrivate && room.password && room.password !== payload.password) {
        // Allow if this socket is already in the room (e.g. host)
        if (!room.users.has(socket.id)) {
          socket.emit("join_error", { error: "wrong_password" });
          socket.leave(roomId);
          currentRoomId = oldRoomId;
          return;
        }
      }
      room.users.set(socket.id, { userId, name, joinedAt: Date.now() });
      if (oldRoomId !== roomId) {
        addSystemMessage(room, `${name} has joined`);
      }


      // If host left, reassign
      if (!room.users.has(room.hostSocketId)) {
        room.hostSocketId = socket.id;
      }

      // Send full state to joiner
      socket.emit("room_state", buildSyncPayload(room));
      broadcastUserCount(roomId, room);
    });

    // === Play ===
    socket.on("play", (data?: { position?: number }) => {
      const room = getRoom();
      if (!room || socket.id !== room.hostSocketId) return;

      const pos = data?.position ?? getCurrentPosition(room);
      room.isPlaying = true;
      room.positionAtStart = pos;
      room.playbackStartedAt = Date.now();

      io.to(currentRoomId!).emit("sync", buildSyncPayload(room));
    });

    // === Pause ===
    socket.on("pause", (data?: { position?: number }) => {
      const room = getRoom();
      if (!room || socket.id !== room.hostSocketId) return;

      room.positionAtStart = data?.position ?? getCurrentPosition(room);
      room.isPlaying = false;
      room.playbackStartedAt = 0;

      io.to(currentRoomId!).emit("sync", buildSyncPayload(room));
    });

    // === Seek ===
    socket.on("seek", (data: { position: number }) => {
      const room = getRoom();
      if (!room || socket.id !== room.hostSocketId) return;

      room.positionAtStart = data.position;
      if (room.isPlaying) {
        room.playbackStartedAt = Date.now();
      }

      io.to(currentRoomId!).emit("sync", buildSyncPayload(room));
    });

    // === Change track ===
    socket.on("change_track", (data: { track: Track }) => {
      const room = getRoom();
      if (!room || socket.id !== room.hostSocketId) return;

      room.currentTrack = data.track;
      room.positionAtStart = 0;
      room.isPlaying = true;
      room.playbackStartedAt = Date.now();
      
      addSystemMessage(room, `Track changed to ${data.track.title} by ${data.track.artist}`);

      io.to(currentRoomId!).emit("sync", buildSyncPayload(room));

      // Load for live streaming
      const videoId = data.track.youtubeId || data.track.id;
      loadTrackForRoom(currentRoomId!, videoId).catch(e => {
        console.error('[Live] Failed to load track:', e.message);
      });
    });

    // === Host reports actual position periodically ===
    socket.on("host_position", (data: { position: number }) => {
      const room = getRoom();
      if (!room || socket.id !== room.hostSocketId) return;

      // Store host's current position
      room.positionAtStart = data.position;
      room.playbackStartedAt = Date.now();

      // Broadcast to all listeners
      socket.to(currentRoomId!).emit("position_broadcast", {
        position: data.position,
        timestamp: Date.now(),
      });
    });

    // === Listener requests current position ===
    socket.on("request_sync", () => {
      const room = getRoom();
      if (!room) return;
      
      // Send current position (estimated from last host report)
      const pos = getCurrentPosition(room);
      socket.emit("sync_response", { position: pos });
      
      // Also send full room state
      socket.emit("sync", buildSyncPayload(room));
    });
    
    // === Chat ===
    socket.on("chat_message", (data: { text: string }) => {
      const room = getRoom();
      const user = room?.users.get(socket.id);
      if (!room || !user) return;

      const message: ChatMessage = {
        id: nanoid(),
        text: data.text,
        userId: user.userId,
        userName: user.name,
        timestamp: Date.now(),
      };

      room.messages.push(message);
      if (room.messages.length > 50) {
        room.messages.shift();
      }

      io.to(currentRoomId!).emit("chat_message", message);
    });


    // === Queue operations ===
    socket.on("add_to_queue", (data: { track: Track }) => {
      const room = getRoom();
      if (!room) return;
      if (!room.allowGuestQueue && socket.id !== room.hostSocketId) {
        socket.emit("queue_error", { error: "Queue is host-only" });
        return;
      }
      const user = room.users.get(socket.id);
      const queueItem: QueueItem = { ...data.track, requestedBy: user?.name || "Someone" };
      room.queue.push(queueItem);
      io.to(currentRoomId!).emit("queue_updated", { queue: room.queue });
      // Notify host
      if (socket.id !== room.hostSocketId) {
        io.to(room.hostSocketId).emit("song_requested", { 
          track: data.track, 
          by: user?.name || "Someone" 
        });
      }
    });

    socket.on("remove_from_queue", (data: { index: number }) => {
      const room = getRoom();
      if (!room) return;
      if (data.index >= 0 && data.index < room.queue.length) {
        room.queue.splice(data.index, 1);
        io.to(currentRoomId!).emit("queue_updated", { queue: room.queue });
      }
    });

    socket.on("play_next", () => {
      const room = getRoom();
      if (!room || socket.id !== room.hostSocketId || room.queue.length === 0) return;

      const next = room.queue.shift()!;
      room.currentTrack = next;
      room.positionAtStart = 0;
      room.isPlaying = true;
      room.playbackStartedAt = Date.now();
      
      addSystemMessage(room, `Track changed to ${next.title} by ${next.artist}`);

      io.to(currentRoomId!).emit("sync", buildSyncPayload(room));
      io.to(currentRoomId!).emit("queue_updated", { queue: room.queue });

      // Load for live streaming
      const nextVideoId = next.youtubeId || next.id;
      loadTrackForRoom(currentRoomId!, nextVideoId).catch(e => {
        console.error('[Live] Failed to load track:', e.message);
      });
    });

    // === Toggle guest queue ===
    socket.on("toggle_guest_queue", () => {
      const room = getRoom();
      if (!room || socket.id !== room.hostSocketId) return;
      room.allowGuestQueue = !room.allowGuestQueue;
      io.to(currentRoomId!).emit("room_settings", { allowGuestQueue: room.allowGuestQueue });
    });

    // === Legacy position sync (kept for compatibility) ===
    socket.on("request_position", () => {
      const room = getRoom();
      if (!room) return;
      const pos = getCurrentPosition(room);
      socket.emit("sync_response", { position: pos });
    });

    // === Reactions ===
    socket.on("reaction", (data: { emoji: string }) => {
      if (!currentRoomId) return;
      io.to(currentRoomId).emit("reaction", {
        id: Math.random().toString(36).substring(2, 9),
        emoji: data.emoji,
        x: Math.random() * 80 + 10,
      });
    });

    // === Live stream controls ===
    socket.on("live_play", (data?: { position?: number }) => {
      const room = getRoom();
      if (!room || socket.id !== room.hostSocketId) return;
      const stream = liveStreams.get(currentRoomId!);
      if (!stream || !stream.buffer) return;
      const pos = data?.position ?? 0;
      stream.isPlaying = true;
      stream.playStartByte = Math.floor(pos * stream.byteRate);
      stream.playStartedAt = Date.now();
      io.to(currentRoomId!).emit('live_playing', { position: pos });
    });

    socket.on("live_pause", () => {
      const room = getRoom();
      if (!room || socket.id !== room.hostSocketId) return;
      const stream = liveStreams.get(currentRoomId!);
      if (!stream) return;
      const currentPos = getCurrentByte(stream) / stream.byteRate;
      stream.isPlaying = false;
      stream.playStartByte = getCurrentByte(stream);
      io.to(currentRoomId!).emit('live_paused', { position: currentPos });
    });

    socket.on("live_seek", (data: { position: number }) => {
      const room = getRoom();
      if (!room || socket.id !== room.hostSocketId) return;
      const stream = liveStreams.get(currentRoomId!);
      if (!stream || !stream.buffer) return;
      stream.playStartByte = Math.floor(data.position * stream.byteRate);
      stream.playStartedAt = Date.now();
      startStreamingToClients(stream);
      io.to(currentRoomId!).emit('live_seeked', { position: data.position });
    });

    socket.on("live_time", (data: { currentTime: number; duration: number }) => {
      if (!currentRoomId) return;
      socket.to(currentRoomId).emit('live_time', data);
    });

    // === Disconnect ===
    socket.on("disconnect", () => {
      console.log(`[-] ${socket.id} disconnected`);
      if (!currentRoomId || !rooms.has(currentRoomId)) return;

      const room = rooms.get(currentRoomId)!;
      const user = room.users.get(socket.id);
      if (user) {
        addSystemMessage(room, `${user.name} has left`);
      }
      room.users.delete(socket.id);
      broadcastUserCount(currentRoomId, room);
      maybeTransferHost(currentRoomId, room);

      // Cleanup empty rooms after 5 min
      if (room.users.size === 0) {
        const rid = currentRoomId;
        setTimeout(() => {
          if (rooms.has(rid) && rooms.get(rid)!.users.size === 0) {
            rooms.delete(rid);
            const ls = liveStreams.get(rid);
            if (ls) {
              for (const [, client] of ls.clients) {
                clearInterval(client.intervalId);
                try { client.res.end(); } catch {}
              }
              liveStreams.delete(rid);
            }
            console.log(`[x] Room ${rid} cleaned up`);
          }
        }, 5 * 60 * 1000);
      }
    });

    // === Helpers ===
    function getRoom(): RoomState | null {
      if (!currentRoomId) return null;
      return rooms.get(currentRoomId) || null;
    }

    function broadcastUserCount(roomId: string, room: RoomState) {
      const payload = buildSyncPayload(room);
      io.to(roomId).emit("user_count", payload.userCount);
      io.to(roomId).emit("users_updated", { users: payload.users });
    }

    function maybeTransferHost(roomId: string, room: RoomState) {
      if (room.users.size === 0) return;
      if (!room.users.has(room.hostSocketId)) {
        const newHostSocketId = room.users.keys().next().value;
        if (newHostSocketId) {
          room.hostSocketId = newHostSocketId;
          const newHost = room.users.get(newHostSocketId);
          io.to(roomId).emit("host_changed", { hostSocketId: room.hostSocketId });
          if(newHost) {
            addSystemMessage(room, `${newHost.name} is now the host`);
          }
        }
      }
    }
  });

  // ===================== API ROUTES =====================

  app.get("/api/rooms", (_req, res) => {
    const publicRooms = Array.from(rooms.values())
      .filter(r => !r.isPrivate && r.users.size > 0)
      .map(r => ({
        id: r.id,
        userCount: r.users.size,
        currentTrack: r.currentTrack ? { title: r.currentTrack.title, artist: r.currentTrack.artist, cover: r.currentTrack.cover } : null,
        hostName: r.users.get(r.hostSocketId)?.name || 'Unknown',
      }));
    res.json({ rooms: publicRooms });
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", rooms: rooms.size, uptime: process.uptime() });
  });

  // Search YouTube
  app.get("/api/search", async (req, res) => {
    const q = (req.query.q as string) || "";
    if (!q.trim()) return res.json({ results: [] });
    try {
      const results = await searchYouTube(q, 15);
      res.json({ results });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Resolve audio stream URL for a YouTube video
  app.get("/api/resolve/:videoId", async (req, res) => {
    try {
      const url = await resolveYouTubeUrl(req.params.videoId);
      res.json({ url });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Proxy audio stream via native https (fetch was failing on this server)
  app.get("/api/stream/:videoId", async (req, res) => {
    const proxyStream = (audioUrl: string, isRetry = false) => {
      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Referer": "https://www.youtube.com/",
        "Origin": "https://www.youtube.com",
      };
      if (req.headers.range) {
        headers["Range"] = req.headers.range as string;
      }

      const parsed = new URL(audioUrl);
      const options = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers,
        family: 4, // Force IPv4
      };

      const proxyReq = https.request(options, (proxyRes) => {
        if (proxyRes.statusCode && proxyRes.statusCode >= 400 && !isRetry) {
          proxyRes.resume();
          // Retry with fresh URL
          urlCache.delete(req.params.videoId);
          resolveYouTubeUrl(req.params.videoId).then(freshUrl => {
            proxyStream(freshUrl, true);
          }).catch(e => {
            if (!res.headersSent) res.status(502).json({ error: e.message });
          });
          return;
        }

        res.status(proxyRes.statusCode || 200);
        const pass = ["content-type", "content-length", "content-range", "accept-ranges"];
        for (const [k, v] of Object.entries(proxyRes.headers)) {
          if (v && pass.includes(k.toLowerCase())) res.setHeader(k, v as string);
        }
        res.setHeader("Cache-Control", "public, max-age=3600");
        proxyRes.pipe(res);
      });

      proxyReq.on("error", (e) => {
        console.error("Stream proxy error:", e.message);
        if (!isRetry && !res.headersSent) {
          // Auto-retry with fresh URL on connection errors
          urlCache.delete(req.params.videoId);
          resolveYouTubeUrl(req.params.videoId).then(freshUrl => {
            proxyStream(freshUrl, true);
          }).catch(err => {
            if (!res.headersSent) res.status(502).json({ error: err.message });
          });
          return;
        }
        if (!res.headersSent) res.status(502).json({ error: e.message });
      });

      req.on("close", () => proxyReq.destroy());
      proxyReq.end();
    };

    try {
      const audioUrl = await resolveYouTubeUrl(req.params.videoId);
      proxyStream(audioUrl);
    } catch (e: any) {
      console.error("Stream resolve error:", e.message);
      if (!res.headersSent) res.status(500).json({ error: e.message });
    }
  });

  // ===================== LIVE STREAM ENDPOINTS =====================

  app.get("/api/live/:roomId/status", (req, res) => {
    const stream = liveStreams.get(req.params.roomId);
    if (!stream) { res.json({ active: false }); return; }
    res.json({
      active: true,
      isPlaying: stream.isPlaying,
      isLoading: stream.isLoading,
      duration: stream.duration,
      currentTime: stream.buffer ? getCurrentByte(stream) / stream.byteRate : 0,
      bufferSize: stream.buffer ? stream.buffer.length : 0,
      clients: stream.clients.size,
      error: stream.loadError,
    });
  });

  app.get("/api/live/:roomId", (req, res) => {
    const stream = liveStreams.get(req.params.roomId);
    if (!stream || !stream.buffer) {
      res.status(404).json({ error: 'No active stream' });
      return;
    }
    const clientId = Math.random().toString(36).substring(2, 10);
    const currentByte = getCurrentByte(stream);
    const totalBytes = stream.buffer.length;

    // Serve the COMPLETE MP3 file as a normal audio response
    // Browser will seek via Range requests if needed
    const rangeHeader = req.headers.range;
    
    if (rangeHeader) {
      // Handle Range request (browser seeking)
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1]);
        const end = match[2] ? parseInt(match[2]) : totalBytes - 1;
        const chunkSize = end - start + 1;
        
        res.writeHead(206, {
          'Content-Type': 'audio/mpeg',
          'Content-Range': `bytes ${start}-${end}/${totalBytes}`,
          'Content-Length': chunkSize,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
        });
        res.end(stream.buffer.slice(start, end + 1));
        return;
      }
    }

    // Full file response — browser can seek freely
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Content-Length': totalBytes,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    });
    res.end(stream.buffer);
    
    console.log(`[Live] Client ${clientId} served full MP3 (${(totalBytes/1024/1024).toFixed(1)}MB) for room ${req.params.roomId}`);
  });

  // ===================== SERVE FRONTEND =====================

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`🔊 Soound server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
