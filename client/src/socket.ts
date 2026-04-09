import { io } from 'socket.io-client';

/**
 * - Dev: leave unset — Vite proxies `/socket.io` to the local API.
 * - Prod (single Node server): leave unset — same origin as the app.
 * - Prod (Netlify etc.): set `VITE_SOCKET_URL=https://your-api.example.com` (no trailing slash).
 */
const serverUrl = import.meta.env.VITE_SOCKET_URL || undefined;

export const socket = io(serverUrl, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
});
