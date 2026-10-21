import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// In dev the client connects to the backend's WebSocket directly (see
// useChat.ts) rather than through a Vite proxy. VITE_SERVER_PORT is the
// backend's port; `npm run dev` sets it from PORT.
process.env.VITE_SERVER_PORT ||= '4173'

export default defineConfig({
  root: 'client',
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./client/src', import.meta.url)) },
  },
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    host: '0.0.0.0',
    // Images from tool results are served by the backend under /media.
    proxy: { '/media': `http://localhost:${process.env.VITE_SERVER_PORT}` },
  },
})
