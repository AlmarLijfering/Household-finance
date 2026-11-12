import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// BASE_PATH lets the same build run at a domain root or under /repo-name/ on GitHub Pages.
export default defineConfig({
  base: process.env.BASE_PATH || './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Household Finance',
        short_name: 'Finance',
        description: 'Shared household accounts, budgets and forecasts',
        theme_color: '#1C2A39',
        background_color: '#F4F6F5',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'], maximumFileSizeToCacheInBytes: 6 * 1024 * 1024 }
    })
  ],
  test: { environment: 'node' }
} as any);
