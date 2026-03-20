import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const isWeb = process.env.VITE_TARGET === 'web'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  base: isWeb ? '/' : './',
  build: {
    outDir: isWeb ? 'dist' : 'dist-renderer',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: isWeb ? {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/prabala-ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    } : undefined,
  },
})
