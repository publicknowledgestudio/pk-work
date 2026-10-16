import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    // Let the dev server be opened from Tailscale hosts (phones, a remote dev box)
    allowedHosts: ['gyanserver', '.ts.net'],
  },
  test: {
    globals: true,
    environment: 'happy-dom',
  },
})