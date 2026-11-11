import { defineConfig } from 'vite';

// PLACEHOLDER config: enough to serve and build the client with '@mb/shared' from source.
// The client workers extend it (dev proxy to the game server, chunking, asset handling).
export default defineConfig({
  // Relative URLs so the built client works behind any hostname or path (Cloudflare Tunnel).
  base: './',
  server: {
    // MB_CLIENT_PORT lets tests and tools pick a free port; 5173 is the usual dev port.
    port: Number(process.env.MB_CLIENT_PORT) || 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    // Built code goes to dist/app so it never mixes with the game assets copied to dist/assets.
    assetsDir: 'app',
    target: 'es2022',
    sourcemap: true,
  },
});
