import { defineConfig, sessionDrivers } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    imageService: 'passthrough'
  }),
  session: {
    driver: sessionDrivers.lruCache()
  },
  integrations: [react()],
  prefetch: {
    prefetchAll: false,
    defaultStrategy: 'hover'
  },
  vite: {
    plugins: [tailwindcss()]
  }
});
