import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: false,
    restoreMocks: true,
    unstubGlobals: true,
    // Behind UTC on purpose: that is where parsing a date-only string as UTC
    // shows up as the previous day, so the date tests cannot pass by accident.
    env: { TZ: 'America/Los_Angeles' },
  },
  server: {
    port: 5173,
    // The API is proxied so the browser sees one origin. That keeps the
    // httpOnly refresh cookie same-site in development, matching how it will
    // behave behind a single domain in production.
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE_URL ?? 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
