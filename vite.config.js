/// <reference types="vitest" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@resources': resolve(__dirname, 'src/configs/resources')
    }
  },
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      // GreenGameVault：仅保留主窗口入口（pet.html / video-player.html 已随非游戏功能移除）
      input: {
        main: resolve(__dirname, 'index.html')
      },
      output: {
        manualChunks: {
          'vue-vendor': ['vue', 'vue-router', 'pinia']
        }
      }
    }
  },
  publicDir: 'public',
  server: {
    port: 5173,
    host: '0.0.0.0',
    strictPort: false,
    open: false
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['src/**/*.{test,spec}.{js,ts,vue}']
  }
})
