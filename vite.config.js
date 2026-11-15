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
  esbuild: {
    // 生产包里剔掉调试日志（Vite 会把这里的选项展开进最终的 esbuild minify 阶段）。
    //
    // 为什么必须剔：保存热路径曾经**按记录**打日志 ——
    // 视频页 6476 条记录 = 每次保存 12954 次 console.log + 一次 ~3MB 对象图 dump，
    // 连续改几十个标签/封面就把渲染层拖垮（整个电脑卡顿、游戏掉帧）。
    // 代码里那份日志已经删了（见 src/components/GenericResourceView.vue 的 saveData），
    // 这里再加一道闸：将来谁忘了，也不会再进发行版。
    //
    // 刻意保留 console.warn / console.error：真出问题时还要靠它们。
    pure: ['console.log', 'console.info', 'console.debug'],
    drop: ['debugger']
  },
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
