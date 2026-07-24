import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'src/mobile'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'out/mobile'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/mobile/index.html')
    }
  },
  resolve: {
    alias: {
      '@mobile': resolve(__dirname, 'src/mobile'),
      '@types': resolve(__dirname, 'src/shared/types')
    }
  }
})
