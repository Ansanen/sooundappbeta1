import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

// Keep these exports for backward compatibility (unused by new sync)
export function getServerTimeOffset(): number { return 0; }
export function getServerTimeNow(): number { return Date.now(); }
export function computeTargetPosition(): number { return 0; }

export const getSocket = (): Socket => {
  if (!socket) {
    socket = io({
      path: "/socket.io/",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
    });

    socket.on("connect", () => {
      console.log("[Socket] Connected:", socket?.id);
    });

    socket.on("reconnect", (attempt: number) => {
      console.log(`[Socket] Reconnected after ${attempt} attempts`);
    });

    socket.on("disconnect", (reason) => {
      console.log(`[Socket] Disconnected: ${reason}`);
    });
  }
  return socket;
};
