import { defineConfig } from 'vite';

// The game server (rooms, matchmaking, WebSocket) that `npm run dev` starts next to Vite.
const SERVER_PORT = Number(process.env.PORT) || 2567;

export default defineConfig({
  // Relative URLs so the built client works behind any hostname (Cloudflare Tunnel).
  base: './',
  server: {
    // MB_CLIENT_PORT lets tests and tools pick a free port; 5173 is the usual dev port.
    port: Number(process.env.MB_CLIENT_PORT) || 5173,
    strictPort: true,
    // In dev the page and the game server are different origins. The client always talks to the
    // origin its page came from, so Vite forwards the server's three kinds of request.
    proxy: {
      '/matchmake': `http://localhost:${SERVER_PORT}`,
      '/healthz': `http://localhost:${SERVER_PORT}`,
      // The WebSocket path is /<process id>/<room code>?sessionId=...
      '^/[A-Za-z0-9_-]+/[A-Z]{4}(\\?|$)': { target: `ws://localhost:${SERVER_PORT}`, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    // Built code goes to dist/app so it never mixes with the game assets copied to dist/assets.
    assetsDir: 'app',
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
});
