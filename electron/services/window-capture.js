/**
 * @module WindowCapture
 * @description 只抓「指定窗口」的一帧画面（2026-10-13，1.5.0 性能优化）。
 *
 * 老做法（已淘汰）：
 *   `desktopCapturer.getSources({ types: ['window'], thumbnailSize: { 1920, 1080 } })`
 *   —— 每次截图都会给**系统里每一个窗口**生成一张 1920×1080 缩略图。
 *   一张 1920×1080 位图约 8.3MB，开 20 个窗口时单次抓取量约 160MB；
 *   Windows 上这条路径走 WGC，每个窗口都会建捕获会话/帧池。
 *   主人在原神里实测：抽帧约 30 次后每截一次掉一帧，50 次左右掉到 20 多帧且不可恢复，
 *   与"每次都在泄漏、永不归还"的行为一致。
 *
 * 新做法：
 *   1. 枚举窗口时 `thumbnailSize: { width: 0, height: 0 }` —— Electron 会跳过缩略图生成；
 *   2. 只对**目标窗口**建一次捕获：隐藏窗口里 getUserMedia/getDisplayMedia 抓一帧画到 canvas；
 *   3. 抓完立刻 `track.stop()`，并把 video 的 srcObject 清空。
 *
 * 失败会如实返回 `{ ok: false, error }`，由调用方决定是否回退到老路径
 * （宁可用老办法截到图，也不能因为新办法失败就不给主人截图）。
 */

const path = require('path')
const { BrowserWindow, session } = require('electron')

/** 抓帧窗口用独立 session，避免给主窗口的会话装上 display-media 处理器 */
const CAPTURE_PARTITION = 'ggv-capture-frame'
/** 抓帧页路径（放在 electron/assets 里，打包后与 electron/ 一起走，不依赖前端构建产物） */
const CAPTURE_PAGE = path.join(__dirname, '..', 'assets', 'capture-frame.html')
/** 抓帧页等首帧的最长时间 */
const CAPTURE_TIMEOUT_MS = 8000
/** 抓到全黑帧时最多重试几次 */
const MAX_BLACK_RETRY = 2

let captureWindow = null
let captureWindowLoaded = null
let handlerInstalled = false
/** getDisplayMedia 回退路径要用：当前这次请求该给哪个源 */
let pendingSource = null

/** 抓帧用的独立 session */
function getCaptureSession() {
  return session.fromPartition(CAPTURE_PARTITION)
}

/**
 * 安装 display-media 请求处理器（只装一次）。
 * 这是 getDisplayMedia 回退路径的"自动选源"：主进程直接指定本次要抓的窗口，不弹选择框。
 */
function ensureDisplayMediaHandler() {
  if (handlerInstalled) return
  try {
    getCaptureSession().setDisplayMediaRequestHandler((request, callback) => {
      if (pendingSource) {
        callback({ video: pendingSource })
      } else {
        callback({})
      }
    })
    handlerInstalled = true
  } catch (error) {
    console.warn('[WindowCapture] 安装 display-media 处理器失败（将只用传统路径）:', error.message)
  }
}

/** 建（或复用）隐藏抓帧窗口 */
function ensureCaptureWindow() {
  if (captureWindow && !captureWindow.isDestroyed()) return captureWindow

  ensureDisplayMediaHandler()
  captureWindow = new BrowserWindow({
    show: false,
    width: 480,
    height: 360,
    skipTaskbar: true,
    webPreferences: {
      partition: CAPTURE_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      // 隐藏窗口默认会被节流，抓帧依赖它继续跑
      backgroundThrottling: false
    }
  })
  captureWindow.on('closed', () => {
    captureWindow = null
    captureWindowLoaded = null
  })
  captureWindowLoaded = captureWindow.loadFile(CAPTURE_PAGE).catch(error => {
    console.error('[WindowCapture] 抓帧页加载失败:', error.message)
    captureWindowLoaded = null
    throw error
  })
  return captureWindow
}

/** 抓帧页是否就绪 */
async function waitCaptureWindowReady() {
  const win = ensureCaptureWindow()
  if (captureWindowLoaded) {
    try { await captureWindowLoaded } catch { /* 让下面再判一次 */ }
  }
  if (!win || win.isDestroyed()) throw new Error('抓帧窗口不可用')
  return win
}

/** 单次抓帧（内部用；调用方负责重试） */
async function captureOnce(source) {
  const win = await waitCaptureWindowReady()
  pendingSource = source
  try {
    const result = await Promise.race([
      win.webContents.executeJavaScript(
        `window.__ggvCapture(${JSON.stringify(String(source.id))})`,
        true
      ),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: 'timeout' }), CAPTURE_TIMEOUT_MS))
    ])
    return result && typeof result === 'object' ? result : { ok: false, error: 'bad-result' }
  } finally {
    pendingSource = null
  }
}

/**
 * 抓一个窗口的一帧。
 *
 * @param {{id: string, name?: string}} source - desktopCapturer 给的窗口源
 * @returns {Promise<{ok: boolean, dataUrl?: string, width?: number, height?: number,
 *                    method?: string, black?: boolean, error?: string}>}
 */
async function captureWindowFrame(source) {
  if (!source || !source.id) return { ok: false, error: '缺少窗口源' }
  let lastError = ''
  for (let attempt = 0; attempt <= MAX_BLACK_RETRY; attempt++) {
    let result
    try {
      result = await captureOnce(source)
    } catch (error) {
      lastError = error && error.message ? error.message : String(error)
      break
    }
    if (result.ok && !result.black) return result
    if (result.ok && result.black) {
      lastError = '抓到全黑画面'
      continue // 全黑就再试一次（有些窗口首帧是全黑）
    }
    lastError = result.error || '抓帧失败'
    // 明确的失败（例如方式 1、2 都不可用）没必要立刻重试三次，留一次机会即可
    if (attempt >= 1) break
  }
  return { ok: false, error: lastError || '抓帧失败' }
}

/** 退出时销毁抓帧窗口 */
function destroyCaptureWindow() {
  try {
    if (captureWindow && !captureWindow.isDestroyed()) captureWindow.destroy()
  } catch (error) {
    console.warn('[WindowCapture] 销毁抓帧窗口失败:', error.message)
  }
  captureWindow = null
  captureWindowLoaded = null
  pendingSource = null
}

module.exports = {
  CAPTURE_PARTITION,
  CAPTURE_PAGE,
  captureWindowFrame,
  destroyCaptureWindow
}
