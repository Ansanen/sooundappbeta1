import express from "express";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Room state management
  interface Track {
    id: string;
    title: string;
    artist: string;
    url: string;
    cover: string;
  }

  interface RoomState {
    id: string;
    hostId: string;
    currentTrack: Track | null;
    isPlaying: boolean;
    currentTime: number;
    lastUpdateTime: number;
    users: Map<string, string>; // socket.id -> userId
    queue: Track[];
  }

  const rooms = new Map<string, RoomState>();

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);
    let currentRoom: string | null = null;

    socket.on("join_room", (payload: { roomId: string, userId: string }) => {
      // Fallback for old clients during transition
      const roomId = typeof payload === 'string' ? payload : payload.roomId;
      const userId = typeof payload === 'string' ? socket.id : payload.userId;

      if (currentRoom) {
        socket.leave(currentRoom);
        if (rooms.has(currentRoom)) {
          const room = rooms.get(currentRoom)!;
          room.users.delete(socket.id);
          const uniqueUsers = new Set(Array.from(room.users.values()));
          io.to(currentRoom).emit("user_count", uniqueUsers.size);
        }
      }

      socket.join(roomId);
      currentRoom = roomId;

      if (!rooms.has(roomId)) {
        rooms.set(roomId, {
          id: roomId,
          hostId: userId,
          currentTrack: {
            id: "1",
            title: "Lofi Study",
            artist: "FASSounds",
            url: "https://cdn.pixabay.com/audio/2022/05/27/audio_1808fbf07a.mp3",
            cover: "https://images.unsplash.com/photo-1518609878373-06d740f60d8b?auto=format&fit=crop&q=80&w=500&h=500"
          },
          isPlaying: false,
          currentTime: 0,
          lastUpdateTime: Date.now(),
          users: new Map(),
          queue: []
        });
      }

      const room = rooms.get(roomId)!;
      room.users.set(socket.id, userId);

      // Reassign host if the current host is missing (e.g., room was empty)
      const isHostPresent = Array.from(room.users.values()).includes(room.hostId);
      if (!isHostPresent) {
        room.hostId = userId;
        io.to(roomId).emit("host_changed", { hostId: room.hostId });
      }

      // Send current state to the new user
      socket.emit("room_state", {
        hostId: room.hostId,
        currentTrack: room.currentTrack,
        isPlaying: room.isPlaying,
        currentTime: room.currentTime,
        lastUpdateTime: room.lastUpdateTime,
        serverTime: Date.now(),
        queue: room.queue
      });

      const uniqueUsers = new Set(Array.from(room.users.values()));
      io.to(roomId).emit("user_count", uniqueUsers.size);
    });

    socket.on("play", (data: { currentTime: number, userId?: string }) => {
      if (!currentRoom) return;
      const room = rooms.get(currentRoom);
      const userId = data.userId || socket.id;
      if (room && room.hostId === userId) {
        room.isPlaying = true;
        room.currentTime = data.currentTime;
        room.lastUpdateTime = Date.now();
        socket.to(currentRoom).emit("play", {
          currentTime: room.currentTime,
          serverTime: room.lastUpdateTime
        });
      }
    });

    socket.on("pause", (data: { currentTime: number, userId?: string }) => {
      if (!currentRoom) return;
      const room = rooms.get(currentRoom);
      const userId = data.userId || socket.id;
      if (room && room.hostId === userId) {
        room.isPlaying = false;
        room.currentTime = data.currentTime;
        room.lastUpdateTime = Date.now();
        socket.to(currentRoom).emit("pause", {
          currentTime: room.currentTime,
          serverTime: room.lastUpdateTime
        });
      }
    });

    socket.on("seek", (data: { currentTime: number, userId?: string }) => {
      if (!currentRoom) return;
      const room = rooms.get(currentRoom);
      const userId = data.userId || socket.id;
      if (room && room.hostId === userId) {
        room.currentTime = data.currentTime;
        room.lastUpdateTime = Date.now();
        socket.to(currentRoom).emit("seek", {
          currentTime: room.currentTime,
          serverTime: room.lastUpdateTime
        });
      }
    });

    socket.on("change_track", (data: { track: Track, userId?: string }) => {
      if (!currentRoom) return;
      const room = rooms.get(currentRoom);
      const userId = data.userId || socket.id;
      if (room && room.hostId === userId) {
        room.currentTrack = data.track;
        room.isPlaying = false;
        room.currentTime = 0;
        room.lastUpdateTime = Date.now();
        io.to(currentRoom).emit("track_changed", {
          track: room.currentTrack
        });
      }
    });

    socket.on("add_to_queue", (data: { track: Track }) => {
      if (!currentRoom) return;
      const room = rooms.get(currentRoom);
      if (room) {
        room.queue.push(data.track);
        io.to(currentRoom).emit("queue_updated", { queue: room.queue });
      }
    });

    socket.on("remove_from_queue", (data: { index: number }) => {
      if (!currentRoom) return;
      const room = rooms.get(currentRoom);
      if (room && data.index >= 0 && data.index < room.queue.length) {
        room.queue.splice(data.index, 1);
        io.to(currentRoom).emit("queue_updated", { queue: room.queue });
      }
    });

    socket.on("play_next", (data?: { userId?: string }) => {
      if (!currentRoom) return;
      const room = rooms.get(currentRoom);
      const userId = data?.userId || socket.id;
      if (room && room.hostId === userId && room.queue.length > 0) {
        const nextTrack = room.queue.shift()!;
        room.currentTrack = nextTrack;
        room.isPlaying = true;
        room.currentTime = 0;
        room.lastUpdateTime = Date.now();
        
        io.to(currentRoom).emit("track_changed", { track: room.currentTrack });
        io.to(currentRoom).emit("queue_updated", { queue: room.queue });
        io.to(currentRoom).emit("play", { currentTime: 0, serverTime: room.lastUpdateTime });
      }
    });

    socket.on("reaction", (data: { emoji: string }) => {
      if (!currentRoom) return;
      io.to(currentRoom).emit("reaction", { 
        id: Math.random().toString(36).substr(2, 9),
        emoji: data.emoji,
        x: Math.random() * 80 + 10
      });
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      if (currentRoom && rooms.has(currentRoom)) {
        const room = rooms.get(currentRoom)!;
        const disconnectedUserId = room.users.get(socket.id);
        room.users.delete(socket.id);
        
        const uniqueUsers = new Set(Array.from(room.users.values()));
        io.to(currentRoom).emit("user_count", uniqueUsers.size);
        
        if (disconnectedUserId && room.hostId === disconnectedUserId && !uniqueUsers.has(disconnectedUserId) && uniqueUsers.size > 0) {
          room.hostId = Array.from(uniqueUsers)[0];
          io.to(currentRoom).emit("host_changed", { hostId: room.hostId });
        }

        if (uniqueUsers.size === 0) {
          // Clean up empty rooms after a delay
          setTimeout(() => {
            if (rooms.has(currentRoom!) && rooms.get(currentRoom!)!.users.size === 0) {
              rooms.delete(currentRoom!);
            }
          }, 1000 * 60 * 5); // 5 minutes
        }
      }
    });
  });

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
