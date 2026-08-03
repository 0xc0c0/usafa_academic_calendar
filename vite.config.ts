import react from '@vitejs/plugin-react';
import { vitePrerenderPlugin } from 'vite-prerender-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), vitePrerenderPlugin({ renderTarget: '#root' })],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
