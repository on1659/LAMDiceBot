import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/horse-app/',
  server: {
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
      '/api': 'http://localhost:3000',
      '/assets': 'http://localhost:3000',
      '/chat-shared.js': 'http://localhost:3000',
      '/ready-shared.js': 'http://localhost:3000',
      '/order-shared.js': 'http://localhost:3000',
      '/ranking-shared.js': 'http://localhost:3000',
      '/server-select-shared.js': 'http://localhost:3000',
      '/page-history-shared.js': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
