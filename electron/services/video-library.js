/**
 * @module VideoLibraryService
 * @description 「视频」页的主进程服务：绑定目录的实时监听 + 相关 IPC 处理器。
 *
 * 实时更新策略：
 *   - 每个绑定根目录挂一个 fs.watch(recursive)（Windows 原生支持递归监听）；
 *   - 任意文件系统事件都先攒进 debounce 窗口（默认 1500ms），窗口结束后只通知渲染层**一次**，
 *     避免解压/复制一批视频时把渲染层刷爆；
 *   - 监听失败（网络盘、ENOSPC、超深目录）不抛错，而是把错误上报给渲染层，
 *     由前端降级为「进页面扫描 + 手动刷新」（见 useVideoLibrary 的 watcherHealthy）。
 */

const fs = require('fs')
const path = require('path')
const videoUtils = require('../utils/video-utils')

/** 事件合并窗口（毫秒） */
const DEBOUNCE_MS = 1500

/** @type {Map<string, fs.FSWatcher>} root -> watcher */
const watchers = new Map()
/** @type {NodeJS.Timeout|null} */
let debounceTimer = null
/** @type {Set<string>} 本次窗口内变动过的根目录 */
let pendingRoots = new Set()
/** @type {import('electron').WebContents|null} */
let targetWebContents = null

/**
 * 把变更通知发给渲染层（窗口已销毁则静默丢弃）
 */
function notifyRenderer(payload) {
  try {
    if (targetWebContents && !targetWebContents.isDestroyed()) {
      targetWebContents.send('video-library-changed', payload)
    }
  } catch (error) {
    console.warn('[VideoLibrary] 通知渲染层失败:', error.message)
  }
}

function flushPending() {
  debounceTimer = null
  const roots = Array.from(pendingRoots)
  pendingRoots = new Set()
  if (roots.length === 0) return
  notifyRenderer({ type: 'change', roots, at: new Date().toISOString() })
}

function scheduleFlush() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(flushPending, DEBOUNCE_MS)
}

/**
 * 开始监听给定根目录（重复调用会先停掉旧的）
 * @param {string[]} roots
 * @param {import('electron').WebContents|null} webContents
 * @returns {{ok: boolean, watching: string[], errors: Array<{root: string, error: string}>}}
 */
function startWatch(roots, webContents) {
  stopWatch()
  targetWebContents = webContents || null

  const list = Array.isArray(roots) ? roots.filter(r => typeof r === 'string' && r.trim() !== '') : []
  const watching = []
  const errors = []

  for (const root of list) {
    try {
      if (!fs.existsSync(root)) {
        errors.push({ root, error: '目录不存在或未挂载' })
        continue
      }
      const watcher = fs.watch(root, { recursive: true, persistent: false }, (eventType, fileName) => {
        pendingRoots.add(root)
        scheduleFlush()
        // 文件名只用于日志，不参与业务判断（各平台行为不一致）
        void eventType
        void fileName
      })
      watcher.on('error', error => {
        errors.push({ root, error: error.message })
        notifyRenderer({ type: 'error', roots: [root], message: error.message })
        try {
          watcher.close()
        } catch (_) {
          // 忽略
        }
        watchers.delete(root)
      })
      watchers.set(root, watcher)
      watching.push(root)
    } catch (error) {
      errors.push({ root, error: error.message })
    }
  }

  console.log('[VideoLibrary] 监听启动:', { watching, errors })
  return { ok: errors.length === 0, watching, errors }
}

/** 停止全部监听 */
function stopWatch() {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  pendingRoots = new Set()
  for (const [root, watcher] of watchers.entries()) {
    try {
      watcher.close()
    } catch (_) {
      // 忽略
    }
    watchers.delete(root)
  }
}

/**
 * 注册视频库相关的 IPC 处理器
 * @param {import('electron').IpcMain} ipcMain
 * @param {import('electron').Shell} shell
 * @param {() => import('electron').WebContents|null} getWebContents
 */
function registerIpcHandlers(ipcMain, shell, getWebContents) {
  /**
   * 扫描绑定目录下的全部视频文件
   * 入参：{ roots: string[], extensions?: string[] }
   */
  ipcMain.handle('video-scan', async (event, payload = {}) => {
    try {
      const roots = payload.roots
      console.log('[VideoLibrary] video-scan 开始:', { roots: Array.isArray(roots) ? roots.length : 0 })
      const result = await videoUtils.scanVideoRoots(roots, { extensions: payload.extensions })
      console.log('[VideoLibrary] video-scan 完成:', {
        totalFiles: result.totalFiles,
        roots: result.roots.map(r => ({ root: r.root, ok: r.ok, exists: r.exists, files: r.files.length, error: r.error }))
      })
      return { ok: true, data: result }
    } catch (error) {
      console.error('[VideoLibrary] 扫描失败:', error)
      return { ok: false, message: error.message }
    }
  })

  /** 开始监听绑定目录 */
  ipcMain.handle('video-watch-start', async (event, roots) => {
    try {
      const webContents = event.sender || (getWebContents ? getWebContents() : null)
      return { ok: true, data: startWatch(roots, webContents) }
    } catch (error) {
      return { ok: false, message: error.message }
    }
  })

  /** 停止监听 */
  ipcMain.handle('video-watch-stop', async () => {
    try {
      stopWatch()
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error.message }
    }
  })

  /** 查询 ffmpeg 可用性（用于前端提示与方案回退） */
  ipcMain.handle('video-ffmpeg-info', async () => {
    try {
      const info = videoUtils.findFfmpeg()
      console.log('[VideoLibrary] ffmpeg 检测:', {
        available: !!info.ffmpeg,
        path: info.ffmpeg,
        source: info.source
      })
      return {
        ok: true,
        data: {
          available: !!info.ffmpeg,
          path: info.ffmpeg,
          probePath: info.ffprobe,
          source: info.source,
          homepage: 'https://www.ffmpeg.org/'
        }
      }
    } catch (error) {
      return { ok: false, message: error.message }
    }
  })

  /**
   * 抽帧并**覆盖**写入封面（固定文件名，永不膨胀）
   * 入参：{ videoPath, saveDataDir, videoId, ratio?, maxWidth? }
   */
  ipcMain.handle('video-grab-cover', async (event, payload = {}) => {
    try {
      const { videoPath, saveDataDir, videoId, ratio, maxWidth } = payload
      if (!videoId) return { ok: false, reason: 'bad-args', message: '缺少 videoId' }

      const resolvedSaveDataDir = path.resolve(saveDataDir || 'SaveData')
      const outFile = videoUtils.getVideoCoverFile(resolvedSaveDataDir, videoId)
      const frame = await videoUtils.grabRandomFrame(videoPath, outFile, { ratio, maxWidth })

      if (!frame.ok) return frame

      return {
        ok: true,
        method: frame.method,
        time: frame.time,
        duration: frame.duration,
        size: frame.size,
        coverPath: videoUtils.getVideoCoverRelativePath(videoId),
        file: outFile
      }
    } catch (error) {
      return { ok: false, reason: 'exception', message: error.message }
    }
  })

  /** canvas 回退方案：把 dataURL 覆盖写入封面 */
  ipcMain.handle('video-save-cover-dataurl', async (event, payload = {}) => {
    try {
      const resolvedSaveDataDir = path.resolve(payload.saveDataDir || 'SaveData')
      const result = await videoUtils.saveVideoCoverFromDataUrl(payload.dataUrl, resolvedSaveDataDir, payload.videoId)
      return result.ok ? { ok: true, coverPath: result.coverPath } : result
    } catch (error) {
      return { ok: false, message: error.message }
    }
  })

  /** 删除封面 */
  ipcMain.handle('video-delete-cover', async (event, payload = {}) => {
    try {
      const resolvedSaveDataDir = path.resolve(payload.saveDataDir || 'SaveData')
      return await videoUtils.deleteVideoCover(resolvedSaveDataDir, payload.videoId)
    } catch (error) {
      return { ok: false, message: error.message }
    }
  })

  /** 用系统默认播放器打开视频，并返回打开前的文件时间戳（用于计数判定） */
  ipcMain.handle('video-open', async (event, payload = {}) => {
    try {
      const filePath = payload.filePath
      if (!filePath) return { ok: false, message: '缺少视频路径' }
      if (!fs.existsSync(filePath)) return { ok: false, missing: true, message: '视频文件不存在' }

      const errorMessage = await shell.openPath(filePath)
      if (errorMessage) return { ok: false, message: errorMessage }
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error.message }
    }
  })

  /** 批量取文件时间戳（atime 兜底统计） */
  ipcMain.handle('video-stat', async (event, filePaths) => {
    try {
      return { ok: true, data: await videoUtils.statVideoFiles(filePaths) }
    } catch (error) {
      return { ok: false, message: error.message }
    }
  })

  /**
   * 「重新关联到…」：校验用户挑的新文件并算出该记录应有的字段
   * 入参：{ roots: string[], filePath: string }
   */
  ipcMain.handle('video-relink', async (event, payload = {}) => {
    try {
      const result = videoUtils.resolveRelinkTarget(payload.roots, payload.filePath)
      console.log('[VideoLibrary] video-relink:', {
        filePath: payload.filePath,
        ok: result.ok,
        insideRoot: result.insideRoot,
        relPath: result.relPath,
        error: result.error
      })
      return result
    } catch (error) {
      return { ok: false, insideRoot: false, error: error.message }
    }
  })

  /** 打开文件所在文件夹并选中 */
  ipcMain.handle('video-reveal', async (event, filePath) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) {
        return { ok: false, message: '文件不存在' }
      }
      shell.showItemInFolder(filePath)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error.message }
    }
  })
}

module.exports = {
  registerIpcHandlers,
  startWatch,
  stopWatch,
  DEBOUNCE_MS
}
