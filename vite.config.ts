import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

const SERVER_PORT = process.env.PORT || 4173

export default defineConfig({
  root: 'client',
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./client/src', import.meta.url)) },
  },
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    host: '0.0.0.0',
    proxy: { '/ws': { target: `ws://localhost:${SERVER_PORT}`, ws: true } },
  },
})
