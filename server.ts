import express from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { createServer } from "http";
import { Server } from "socket.io";
import https from "https";
import path from "path";
import fs from "fs";
import { execFile, exec } from "child_process";
import { nanoid } from "nanoid";

const DENO_PATH = process.env.DENO_PATH || "/root/.deno/bin/deno";
const YT_DLP = process.env.YT_DLP_PATH || "/usr/local/bin/yt-dlp";

// ===================== SPOTIFY SERVICE =====================
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || "46398cccb6be4f909d95afd1e43ef3e4";
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || "fab561c092dd4027ae98775a513bfb45";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API = "https://api.spotify.com/v1";

let spotifyToken: string | null = null;
let spotifyTokenExpiresAt = 0;

async function getSpotifyToken(): Promise<string> {
  if (spotifyToken && Date.now() < spotifyTokenExpiresAt - 10000) {
    return spotifyToken;
  }

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) throw new Error(`Spotify token error: ${res.status}`);
  const data = await res.json();
  spotifyToken = data.access_token;
  spotifyTokenExpiresAt = Date.now() + data.expires_in * 1000;
  console.log("[Spotify] Token refreshed, expires in", data.expires_in, "s");
  return spotifyToken!;
}

interface SpotifyTrack {
  spotifyId: string;
  title: string;
  artist: string;
  album: string;
  cover: string | null;
  duration: number; // ms
  previewUrl: string | null;
}

async function searchSpotify(query: string, limit = 10): Promise<SpotifyTrack[]> {
  const token = await getSpotifyToken();
  const url = new URL(`${SPOTIFY_API}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("type", "track");
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) throw new Error(`Spotify search error: ${res.status}`);
  const data = await res.json();

  return data.tracks.items.map((track: any) => ({
    spotifyId: track.id,
    title: track.name,
    artist: track.artists.map((a: any) => a.name).join(", "),
    album: track.album.name,
    cover: track.album.images[1]?.url ?? track.album.images[0]?.url ?? null,
    duration: track.duration_ms,
    previewUrl: track.preview_url,
  }));
}

// Simple in-memory rate limiter
const rateLimiter = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimiter.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimiter.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) return false;
  entry.count++;
  return true;
}

// Clean up rate limiter every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimiter) {
    if (now > entry.resetAt) rateLimiter.delete(key);
  }
}, 5 * 60 * 1000);

/** Sanitize string for safe use (strip shell-dangerous chars) */
function sanitizeInput(str: string, maxLen = 200): string {
  return str.slice(0, maxLen).replace(/[^\w\s\-.',"!?()&+:;@#%/\\áéíóúñüöäàèìòùâêîôûëïãõ]/gi, '').trim();
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingInterval: 10000,
    pingTimeout: 20000,
    transports: ["websocket", "polling"],
    allowUpgrades: true,
  });

  const PORT = parseInt(process.env.PORT || "3463");

  // ===================== FILE UPLOAD =====================
  const uploadDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const storage = multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${randomUUID()}${ext}`);
    },
  });
  const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith("audio/")) {
        cb(null, true);
      } else {
        cb(new Error("Only audio files allowed"));
      }
    },
  });

  // Uploaded files metadata (in-memory, cleared on restart)
  const uploadedFiles = new Map<string, { path: string; originalName: string; duration?: number }>();

  // Upload endpoint
  app.post("/api/upload", upload.single("audio"), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    const fileId = path.basename(req.file.filename, path.extname(req.file.filename));
    uploadedFiles.set(fileId, {
      path: req.file.path,
      originalName: req.file.originalname,
    });
    res.json({
      id: fileId,
      title: req.file.originalname.replace(/\.[^.]+$/, ""),
      url: `/api/uploaded/${fileId}`,
    });
  });

  // Serve uploaded files
  app.get("/api/uploaded/:id", (req, res) => {
    const file = uploadedFiles.get(req.params.id);
    if (!file || !fs.existsSync(file.path)) {
      return res.status(404).send("File not found");
    }
    res.sendFile(file.path);
  });

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
    // WebRTC mode
    webrtcHostPeerId?: string;
    // Radio mode
    radioPlaying: boolean;
    radioPosition: number;
    radioStartTime: number;
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
    clients: Map<string, { res: any; interval: any; byteOffset: number }>;
  }

  const liveStreams = new Map<string, LiveStream>();
  
  // ===================== AUDIO BROADCASTER (SCALABILITY) =====================
  // Efficient broadcasting to 50-200+ listeners per room
  class AudioBroadcaster {
    private roomId: string;
    private listeners: Set<string> = new Set();
    private chunkBuffer: Buffer[] = [];
    private maxChunks = 50; // ~1 second of 20ms chunks
    private currentSeq = 0;
    
    constructor(roomId: string) {
      this.roomId = roomId;
    }
    
    addListener(socketId: string): void {
      this.listeners.add(socketId);
      console.log(`[Broadcaster] ${this.roomId}: Added listener ${socketId}, total: ${this.listeners.size}`);
    }
    
    removeListener(socketId: string): void {
      this.listeners.delete(socketId);
      console.log(`[Broadcaster] ${this.roomId}: Removed listener ${socketId}, total: ${this.listeners.size}`);
    }
    
    getListenerCount(): number {
      return this.listeners.size;
    }
    
    // Broadcast audio chunk to all listeners efficiently
    broadcastChunk(chunk: Buffer, timestamp: number): void {
      if (this.listeners.size === 0) return;
      
      // Create header: seq(4) + timestamp(8) + length(4)
      const header = Buffer.alloc(16);
      header.writeUInt32LE(this.currentSeq++, 0);
      header.writeDoubleLE(timestamp, 4);
      header.writeUInt32LE(chunk.length, 12);
      
      const packet = Buffer.concat([header, chunk]);
      
      // Store in buffer for late joiners
      this.chunkBuffer.push(packet);
      if (this.chunkBuffer.length > this.maxChunks) {
        this.chunkBuffer.shift();
      }
      
      // Broadcast via Socket.IO room (efficient)
      io.to(this.roomId).emit('audio_chunk', packet);
    }
    
    // Send buffered chunks to late joiner
    sendBufferedChunks(socketId: string): void {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket) return;
      
      for (const chunk of this.chunkBuffer) {
        socket.emit('audio_chunk', chunk);
      }
    }
    
    clear(): void {
      this.listeners.clear();
      this.chunkBuffer = [];
      this.currentSeq = 0;
    }
  }
  
  const broadcasters = new Map<string, AudioBroadcaster>();
  
  function getBroadcaster(roomId: string): AudioBroadcaster {
    let broadcaster = broadcasters.get(roomId);
    if (!broadcaster) {
      broadcaster = new AudioBroadcaster(roomId);
      broadcasters.set(roomId, broadcaster);
    }
    return broadcaster;
  }

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
      currentTime: 0,
    });
    // Schedule synchronized play 2 seconds after track is ready
    // This gives all clients time to load the audio file
    const scheduledTime = Date.now() + 2000;
    io.to(stream.roomId).emit('sync_play', { scheduledTime, position: 0 });
    console.log(`[Sync] New track → sync_play scheduled at +2s`);
  }

  // Track buffer cache — don't re-download same track
  const trackCache = new Map<string, Buffer>();
  const TRACK_CACHE_MAX = 20;

  async function downloadAndConvert(videoId: string): Promise<Buffer> {
    // Check cache first
    const cached = trackCache.get(videoId);
    if (cached) {
      console.log(`[Live] Cache hit for ${videoId} (${(cached.length / 1024 / 1024).toFixed(1)}MB)`);
      return cached;
    }

    return new Promise((resolve, reject) => {
      const env = { ...process.env, PATH: `/root/.deno/bin:${process.env.PATH}` };
      const cmd = `${YT_DLP} -o - -f "bestaudio" "https://www.youtube.com/watch?v=${videoId}" 2>/dev/null | /usr/bin/ffmpeg -i pipe:0 -f mp3 -ab 192k -v quiet pipe:1`;
      exec(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: 60000, env, encoding: 'buffer' }, (err, stdout) => {
        if (err) { reject(new Error(`Failed to load track: ${err.message}`)); return; }
        if (!stdout || stdout.length < 1000) { reject(new Error('Empty audio output')); return; }
        console.log(`[Live] Track downloaded: ${(stdout.length / 1024 / 1024).toFixed(1)}MB MP3`);
        // Evict oldest if cache full
        if (trackCache.size >= TRACK_CACHE_MAX) {
          const oldest = trackCache.keys().next().value;
          if (oldest) trackCache.delete(oldest);
        }
        trackCache.set(videoId, stdout);
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
      let mp3Buffer: Buffer;
      try {
        mp3Buffer = await downloadAndConvert(videoId);
      } catch (firstErr: any) {
        console.warn(`[Live] First download attempt failed: ${firstErr.message}, retrying...`);
        mp3Buffer = await downloadAndConvert(videoId);
      }
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
      liveStreamUrl: liveStreams.has(room.id) && liveStreams.get(room.id)!.buffer
        ? `/api/live/${room.id}` : null,
      liveStreamDuration: liveStreams.has(room.id) ? liveStreams.get(room.id)!.duration : 0,
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

  /** Search YouTube via yt-dlp (using execFile for safety — no shell injection) */
  async function searchYouTube(query: string, limit = 10): Promise<any[]> {
    const safeQuery = sanitizeInput(query, 150);
    if (!safeQuery) return [];

    return new Promise((resolve) => {
      const env = { ...process.env, PATH: `${path.dirname(DENO_PATH)}:${process.env.PATH}` };
      const args = [
        '--dump-json',
        '--flat-playlist',
        '--no-download',
        `ytsearch${limit}:${safeQuery}`,
      ];
      execFile(YT_DLP, args, { timeout: 20000, maxBuffer: 5 * 1024 * 1024, env }, (err, stdout) => {
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
      });
    });
  }

  // ===================== SOCKET.IO =====================

  // Track RTT per socket for sync scheduling
  const socketRTT = new Map<string, number>();

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
    
    // === RTT measurement for precise sync ===
    socket.on("ntp_ping", (data: { t0: number }) => {
      const rtt = Date.now() - data.t0;
      socketRTT.set(socket.id, rtt);
      socket.emit("ntp_pong", { t0: data.t0, serverTime: Date.now() });
    });
    
    // === Phase-coherent time sync (NTP-like intersection algorithm) ===
    // Used by time-sync.worker.ts for high-precision clock synchronization
    socket.on("sync_ping", (data: { t0: number }) => {
      const t1 = performance.timeOrigin + performance.now();
      // Minimal processing between t1 and t2
      const t2 = performance.timeOrigin + performance.now();
      socket.emit("sync_pong", { t0: data.t0, t1, t2 });
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
          radioPlaying: false,
          radioPosition: 0,
          radioStartTime: 0,
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

      // Reconnect recovery: if room has an active live stream, send it to the joining socket
      const activeStream = liveStreams.get(roomId);
      if (activeStream && activeStream.buffer && activeStream.isPlaying) {
        const currentPos = getCurrentByte(activeStream) / activeStream.byteRate;
        socket.emit('live_stream_ready', {
          trackId: activeStream.trackId,
          duration: activeStream.duration,
          url: `/api/live/${roomId}`,
          currentTime: currentPos,
        });
        // Delayed sync_play so client has time to download the buffer
        setTimeout(() => {
          const posNow = getCurrentByte(activeStream) / activeStream.byteRate;
          const scheduledTime = Date.now() + 2000;
          socket.emit('sync_play', { scheduledTime, position: posNow });
          console.log(`[Sync] Late joiner ${socket.id} → sync_play at pos ${posNow.toFixed(1)}s`);
        }, 1500);
      }
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

      // Broadcast to all listeners (both formats for compatibility)
      socket.to(currentRoomId!).emit("position_broadcast", {
        position: data.position,
        timestamp: Date.now(),
      });
    });
    
    // === Host broadcasts time (from useUnifiedAudio) ===
    socket.on("host_time", (data: { position: number; duration: number; isPlaying: boolean; timestamp?: number }) => {
      const room = getRoom();
      if (!room || socket.id !== room.hostSocketId) return;

      // Store host's current position
      room.positionAtStart = data.position;
      room.playbackStartedAt = Date.now();
      room.isPlaying = data.isPlaying;

      // Broadcast to all listeners — pass through timestamp for latency calc
      socket.to(currentRoomId!).emit("host_time", {
        position: data.position,
        duration: data.duration,
        isPlaying: data.isPlaying,
        timestamp: data.timestamp || Date.now(),
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
      
      // If room is playing, send sync_play command so listener starts
      if (room.isPlaying && currentRoomId) {
        const activeStream = liveStreams.get(currentRoomId);
        if (activeStream && activeStream.isPlaying) {
          const currentPos = getCurrentByte(activeStream) / activeStream.byteRate;
          const scheduledTime = Date.now() + 500; // Start in 500ms
          socket.emit('sync_play', { scheduledTime, position: currentPos });
          console.log(`[Sync] request_sync → sync_play at pos ${currentPos.toFixed(1)}s`);
        }
      }
    });
    
    // === Chat (rate limited: 5 messages per 5s per socket) ===
    socket.on("chat_message", (data: { text: string }) => {
      const room = getRoom();
      const user = room?.users.get(socket.id);
      if (!room || !user) return;

      // Rate limit chat messages
      if (!checkRateLimit(`chat:${socket.id}`, 5, 5000)) return;

      // Sanitize and validate
      const text = (data.text || '').trim().slice(0, 500);
      if (!text) return;

      const message: ChatMessage = {
        id: nanoid(),
        text,
        userId: user.userId,
        userName: user.name,
        timestamp: Date.now(),
      };

      room.messages.push(message);
      if (room.messages.length > 100) {
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

    // === Reactions (rate limited: 3 per 2s per socket) ===
    socket.on("reaction", (data: { emoji: string }) => {
      if (!currentRoomId) return;
      if (!checkRateLimit(`reaction:${socket.id}`, 3, 2000)) return;

      const validEmojis = ['fire', 'heart', 'clap', 'music', 'spark'];
      if (!validEmojis.includes(data.emoji)) return;

      io.to(currentRoomId).emit("reaction", {
        id: nanoid(8),
        emoji: data.emoji,
        x: Math.random() * 80 + 10,
      });
    });

    // === Synchronized Play/Pause/Seek ===
    // The key: server tells ALL clients to start playing at a specific future moment
    // This gives everyone time to prepare and start simultaneously
    
    socket.on("live_play", (data?: { position?: number }) => {
      const room = getRoom();
      if (!room || socket.id !== room.hostSocketId) return;
      const stream = liveStreams.get(currentRoomId!);
      if (stream) {
        stream.isPlaying = true;
        stream.playStartedAt = Date.now();
        stream.playStartByte = Math.floor((data?.position ?? 0) * stream.byteRate);
      }
      room.isPlaying = true;
      
      // Schedule play with RTT-aware timing
      // Get max RTT of all clients in room for synchronized start
      const roomSockets = Array.from(room.users.keys());
      const rtts = roomSockets.map(sid => socketRTT.get(sid) || 100);
      const maxRTT = Math.max(...rtts, 100);
      
      // Base delay + max RTT to ensure all clients are ready
      const baseDelay = 2000;
      const scheduledTime = Date.now() + baseDelay + maxRTT;
      const position = data?.position ?? 0;
      
      io.to(currentRoomId!).emit('sync_play', { scheduledTime, position });
      console.log(`[Sync] Play scheduled at +${baseDelay + maxRTT}ms (maxRTT: ${maxRTT}ms), position: ${position.toFixed(2)}s`);
    });

    socket.on("live_pause", () => {
      const room = getRoom();
      if (!room || socket.id !== room.hostSocketId) return;
      const stream = liveStreams.get(currentRoomId!);
      let position = 0;
      if (stream) {
        position = getCurrentByte(stream) / stream.byteRate;
        stream.isPlaying = false;
        stream.playStartByte = getCurrentByte(stream);
      }
      room.isPlaying = false;
      
      io.to(currentRoomId!).emit('sync_pause', { position });
    });

    socket.on("live_seek", (data: { position: number }) => {
      const room = getRoom();
      if (!room || socket.id !== room.hostSocketId) return;
      const stream = liveStreams.get(currentRoomId!);
      if (stream) {
        stream.playStartByte = Math.floor(data.position * stream.byteRate);
        stream.playStartedAt = Date.now();
      }
      
      // RTT-aware seek
      const roomSockets = Array.from(room.users.keys());
      const rtts = roomSockets.map(sid => socketRTT.get(sid) || 100);
      const maxRTT = Math.max(...rtts, 100);
      const scheduledTime = Date.now() + 1500 + maxRTT;
      io.to(currentRoomId!).emit('sync_seek', { scheduledTime, position: data.position });
    });

    socket.on("live_time", (data: { currentTime: number; duration: number }) => {
      if (!currentRoomId) return;
      socket.to(currentRoomId).emit('live_time', data);
    });

    // === Simple Sync Mode (host broadcasts, listeners follow) ===
    socket.on("host_time", (data: { position: number; duration: number; isPlaying: boolean }) => {
      if (!currentRoomId) return;
      const room = getRoom();
      if (!room || socket.id !== room.hostSocketId) return;
      
      // Update room state
      room.isPlaying = data.isPlaying;
      room.positionAtStart = data.position;
      room.playbackStartedAt = Date.now();
      
      // Broadcast to all listeners
      socket.to(currentRoomId).emit('host_time', data);
    });

    socket.on("simple_play", (data: { position: number }) => {
      if (!currentRoomId) return;
      const room = getRoom();
      if (!room || socket.id !== room.hostSocketId) return;
      
      room.isPlaying = true;
      room.positionAtStart = data.position;
      room.playbackStartedAt = Date.now();
      
      // Schedule playback 2s in future so all clients can prepare
      const serverStartTime = Date.now() + 2000;
      io.to(currentRoomId).emit('scheduled_play', {
        position: data.position,
        serverStartTime,
        serverTime: Date.now(),
      });
      console.log(`[Sync] Play scheduled at +2s, pos=${data.position.toFixed(2)}s`);
    });

    socket.on("simple_pause", (data: { position: number }) => {
      if (!currentRoomId) return;
      const room = getRoom();
      if (!room || socket.id !== room.hostSocketId) return;
      
      room.isPlaying = false;
      room.positionAtStart = data.position;
      room.playbackStartedAt = Date.now();
      
      io.to(currentRoomId).emit('scheduled_pause', {
        position: data.position,
        serverTime: Date.now(),
      });
      console.log(`[Sync] Pause at ${data.position.toFixed(2)}s`);
    });

    socket.on("simple_seek", (data: { position: number }) => {
      if (!currentRoomId) return;
      const room = getRoom();
      if (!room || socket.id !== room.hostSocketId) return;
      
      room.positionAtStart = data.position;
      if (room.isPlaying) room.playbackStartedAt = Date.now();
      
      const serverStartTime = Date.now() + 1500;
      io.to(currentRoomId).emit('scheduled_seek', {
        position: data.position,
        serverStartTime,
        serverTime: Date.now(),
      });
    });

    // === WebRTC Signaling ===
    socket.on("webrtc_host_ready", (data: { peerId: string }) => {
      const room = getRoom();
      if (!room) return;
      room.webrtcHostPeerId = data.peerId;
      socket.to(currentRoomId!).emit('webrtc_host_ready', { peerId: data.peerId });
      console.log(`[WebRTC] Host ready: ${data.peerId}`);
    });

    socket.on("webrtc_get_host", () => {
      const room = getRoom();
      if (!room || !room.webrtcHostPeerId) return;
      socket.emit('webrtc_host_ready', { peerId: room.webrtcHostPeerId });
    });

    socket.on("webrtc_listener_join", (data: { peerId: string }) => {
      const room = getRoom();
      if (!room || !room.hostSocketId) return;
      io.to(room.hostSocketId).emit('webrtc_listener_joined', { peerId: data.peerId });
      console.log(`[WebRTC] Listener joining: ${data.peerId}`);
    });

    socket.on("webrtc_time", (data: { currentTime: number; duration: number }) => {
      if (!currentRoomId) return;
      socket.to(currentRoomId).emit('webrtc_time', data);
    });

    socket.on("webrtc_play", (data: { position: number }) => {
      if (!currentRoomId) return;
      socket.to(currentRoomId).emit('webrtc_play', data);
    });

    socket.on("webrtc_pause", () => {
      if (!currentRoomId) return;
      socket.to(currentRoomId).emit('webrtc_pause');
    });

    socket.on("webrtc_seek", (data: { position: number }) => {
      if (!currentRoomId) return;
      socket.to(currentRoomId).emit('webrtc_seek', data);
    });

    // === Radio Mode ===
    socket.on("radio_play", (data: { position?: number }) => {
      const room = getRoom();
      if (!room || socket.id !== room.hostSocketId) return;
      room.radioPlaying = true;
      room.radioPosition = data.position ?? 0;
      room.radioStartTime = Date.now();
      io.to(currentRoomId!).emit('radio_started');
      console.log(`[Radio] Play from ${room.radioPosition.toFixed(1)}s`);
    });

    socket.on("radio_pause", () => {
      const room = getRoom();
      if (!room || socket.id !== room.hostSocketId) return;
      if (room.radioPlaying) {
        const elapsed = (Date.now() - room.radioStartTime) / 1000;
        room.radioPosition += elapsed;
      }
      room.radioPlaying = false;
      io.to(currentRoomId!).emit('radio_stopped');
      console.log(`[Radio] Paused at ${room.radioPosition.toFixed(1)}s`);
    });

    socket.on("radio_seek", (data: { position: number }) => {
      const room = getRoom();
      if (!room || socket.id !== room.hostSocketId) return;
      room.radioPosition = data.position;
      room.radioStartTime = Date.now();
      io.to(currentRoomId!).emit('radio_seeked', { position: data.position });
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
                clearInterval(client.interval);
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

  // NTP-style time sync endpoint
  app.get("/api/time", (_req, res) => {
    res.json({ serverTime: Date.now() });
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", rooms: rooms.size, uptime: process.uptime() });
  });

  // Search YouTube (rate limited: 10 requests per 30s per IP)
  // Primary search: Spotify (better metadata + covers)
  app.get("/api/search", async (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(`search:${clientIp}`, 15, 30000)) {
      return res.status(429).json({ error: "Too many requests. Try again in a moment." });
    }

    const q = (req.query.q as string) || "";
    const source = (req.query.source as string) || "spotify";
    if (!q.trim()) return res.json({ results: [], tracks: [] });
    if (q.length > 200) return res.status(400).json({ error: "Query too long" });

    try {
      if (source === "youtube") {
        // Legacy YouTube search
        const results = await searchYouTube(q, 15);
        res.json({ results });
      } else {
        // Spotify search (default)
        const tracks = await searchSpotify(q, 15);
        res.json({ tracks });
      }
    } catch (e: any) {
      console.error("Search API error:", e.message);
      // Fallback to YouTube if Spotify fails
      try {
        const results = await searchYouTube(q, 15);
        res.json({ results, fallback: true });
      } catch {
        res.status(500).json({ error: "Search failed. Please try again." });
      }
    }
  });

  // Resolve audio stream URL for a YouTube video
  app.get("/api/resolve/:videoId", async (req, res) => {
    const videoId = req.params.videoId.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 20);
    if (!videoId) return res.status(400).json({ error: "Invalid video ID" });

    try {
      const url = await resolveYouTubeUrl(videoId);
      res.json({ url });
    } catch (e: any) {
      res.status(500).json({ error: "Failed to resolve track" });
    }
  });

  // Resolve Spotify track → find best YouTube match by duration
  app.get("/api/resolve-spotify", async (req, res) => {
    const { artist, title, duration } = req.query as { artist?: string; title?: string; duration?: string };
    if (!artist || !title) {
      return res.status(400).json({ error: "artist and title required" });
    }

    const spotifyDurationMs = parseInt(duration || "0", 10);
    const query = `${artist} - ${title}`;

    try {
      // Search YouTube for candidates
      const candidates = await new Promise<{ videoId: string; title: string; duration: number }[]>((resolve, reject) => {
        execFile(YT_DLP, [
          `ytsearch5:${query}`,
          "--print", "%(id)s\t%(title)s\t%(duration)s",
          "--no-download",
          "--no-playlist",
          "--match-filter", "!is_live",
        ], { timeout: 30000 }, (err, stdout, stderr) => {
          if (err) return reject(new Error(stderr || err.message));
          const results = stdout.trim().split("\n").filter(Boolean).map(line => {
            const [videoId, title, durStr] = line.split("\t");
            return { videoId, title, duration: parseFloat(durStr) || 0 };
          }).filter(c => c.videoId && c.duration > 0);
          resolve(results);
        });
      });

      if (candidates.length === 0) {
        return res.status(404).json({ error: "No YouTube match found" });
      }

      // Pick best match by duration
      const targetSec = spotifyDurationMs / 1000;
      const best = candidates.reduce((a, b) => 
        Math.abs(a.duration - targetSec) < Math.abs(b.duration - targetSec) ? a : b
      );

      const durationDiff = Math.abs(best.duration - targetSec).toFixed(1);
      console.log(`[Spotify→YT] "${query}" → ${best.videoId} (diff: ${durationDiff}s)`);

      res.json({ 
        videoId: best.videoId, 
        youtubeTitle: best.title,
        duration: best.duration,
        durationDiff: parseFloat(durationDiff),
      });
    } catch (e: any) {
      console.error("Resolve Spotify error:", e.message);
      res.status(500).json({ error: "Failed to resolve track" });
    }
  });

  // Proxy audio stream via native https (rate limited: 5 per 10s per IP)
  app.get("/api/stream/:videoId", async (req, res) => {
    const videoId = req.params.videoId.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 20);
    if (!videoId) return res.status(400).json({ error: "Invalid video ID" });

    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(`stream:${clientIp}`, 5, 10000)) {
      return res.status(429).json({ error: "Too many requests" });
    }

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
          urlCache.delete(videoId);
          resolveYouTubeUrl(videoId).then(freshUrl => {
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
          urlCache.delete(videoId);
          resolveYouTubeUrl(videoId).then(freshUrl => {
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
    const totalBytes = stream.buffer.length;

    // Serve full MP3 file — sync handled via socket events
    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1]);
        const end = match[2] ? parseInt(match[2]) : totalBytes - 1;
        res.writeHead(206, {
          'Content-Type': 'audio/mpeg',
          'Content-Range': `bytes ${start}-${end}/${totalBytes}`,
          'Content-Length': end - start + 1,
          'Accept-Ranges': 'bytes',
        });
        res.end(stream.buffer.slice(start, end + 1));
        return;
      }
    }
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Content-Length': totalBytes,
      'Accept-Ranges': 'bytes',
    });
    res.end(stream.buffer);
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
    const landingPath = path.join(process.cwd(), "landing");

    // Serve landing static assets
    app.use("/landing", express.static(landingPath));

    // Serve app static assets
    app.use("/app", express.static(distPath));

    // Landing page at root
    app.get("/", (_req, res) => {
      res.sendFile(path.join(landingPath, "index.html"));
    });

    // App routes — SPA fallback
    app.get("/app", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    app.get("/app/*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });

    // Legacy: ?room=XXX redirects to app
    app.get("*", (req, res) => {
      if (req.query.room) {
        return res.redirect(`/app?room=${req.query.room}`);
      }
      // Default: serve app for any other route (backwards compat)
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Global error handler (catches URIError, multer errors, etc.)
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error('[Express] Error:', err.message);
    if (!res.headersSent) {
      res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
    }
  });

  // Heartbeat: broadcast server time + position to active rooms every 5s
  setInterval(() => {
    const serverTime = Date.now();
    for (const [roomId, room] of rooms.entries()) {
      if (!room.isPlaying) continue;
      const position = getCurrentPosition(room);
      io.to(roomId).emit('heartbeat', { serverTime, trackPosition: position });
    }
  }, 5000);

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`🔊 Soound server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
