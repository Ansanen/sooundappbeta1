import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export const getSocket = () => {
  if (!socket) {
    // In development/production, the socket connects to the same host
    socket = io({
      path: "/socket.io/",
      transports: ["websocket", "polling"],
    });
  }
  return socket;
};
