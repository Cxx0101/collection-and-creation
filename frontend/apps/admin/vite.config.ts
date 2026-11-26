import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5184,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8090', changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:8090', changeOrigin: true },
    },
  },
})
