/**
 * @module PathHandlers
 * @description 管理应用程序的路径和 URL 转换相关的 IPC 处理器。
 *
 * 主要功能:
 * 1. 将本地文件路径转换为 file:// URL。
 * 2. 将本地文件读取为 Data URL（Base64 编码）。
 * 3. 获取应用根目录路径。
 * 4. 注册与路径/URL 相关的 IPC 处理器。
 *
 * 导出的函数:
 * - `registerIpcHandlers(ipcMain, pathUtils)`: 注册 IPC 处理器。
 *
 * IPC 处理器:
 * - `get-file-url`: 获取文件的 file:// URL。
 * - `read-file-as-data-url`: 将本地文件读取为 Data URL。
 * - `get-app-root-path`: 获取应用根目录路径。
 */

const fs = require('fs')
const path = require('path')

/**
 * 把「相对 SaveData 目录」的路径解析成真实存在的绝对路径。
 *
 * 背景（上游遗留缺陷）：库里大量路径是**相对 SaveData** 的（如 `games/covers/x.png`），
 * 而 `fs.existsSync` 对相对路径是按**进程 cwd** 解析的，会去找
 * `<cwd>/games/covers/x.png` —— 真实文件却在 `<cwd>/SaveData/games/covers/x.png`，
 * 于是被误判为「文件不存在」，图片加载失败（启动日志里那几条 `文件不存在:` 就是它）。
 *
 * 这里按「原样 → 再拼 SaveData」的顺序尝试，找不到才放弃；
 * 对原本就能用的绝对路径、以及已经带 `SaveData` 前缀的路径**零影响**。
 *
 * @param {string} filePath - 待解析路径
 * @returns {string|null} 真实存在的路径，或 null
 */
function resolveExistingFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string' || !filePath.trim()) return null
  const raw = filePath.trim()
  try {
    if (fs.existsSync(raw)) return raw
    if (!path.isAbsolute(raw)) {
      const candidate = path.join(process.cwd(), 'SaveData', raw)
      if (fs.existsSync(candidate)) return candidate
    }
  } catch (e) {
    // 落到失败分支即可
  }
  return null
}

/**
 * 注册与路径/URL 相关的 IPC 处理器。
 * @param {Object} ipcMain - Electron 的 ipcMain 对象。
 * @param {Object} pathUtils - path-utils 模块。
 */
function registerIpcHandlers(ipcMain, pathUtils) {
  // 获取文件URL，用于在渲染进程中正确显示本地文件
  ipcMain.handle('get-file-url', async (event, filePath) => {
    try {
      if (!filePath || filePath.trim() === '') {
        return { success: false, error: '文件路径为空' }
      }

      // 检查文件是否存在（相对 SaveData 的路径会先补全目录再判断）
      const resolvedPath = resolveExistingFilePath(filePath)
      if (!resolvedPath) {
        console.warn('文件不存在:', filePath)
        return { success: false, error: '文件不存在' }
      }

      const fileUrl = pathUtils.getFileUrl(resolvedPath)
      if (!fileUrl) {
        return { success: false, error: '无法生成文件 URL' }
      }

      return { success: true, url: fileUrl }
    } catch (error) {
      console.error('获取文件URL失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 将本地图片转为 data:URL 返回，避免 http(s) 环境下直接加载 file:// 被拦截
  ipcMain.handle('read-file-as-data-url', async (event, filePath) => {
    try {
      // 同一类缺陷：相对 SaveData 的路径也需要先补全，否则读不到图（返回 null）
      const resolvedPath = resolveExistingFilePath(filePath)
      if (!resolvedPath) return null
      const dataUrl = pathUtils.readFileAsDataUrl(resolvedPath)
      if (!dataUrl) {
        return null
      }
      return dataUrl
    } catch (error) {
      console.error('读取文件为 Data URL 失败:', error)
      return null
    }
  })

  // 获取应用根目录路径
  ipcMain.handle('get-app-root-path', async () => {
    try {
      const appRootPath = pathUtils.getAppRootPath()
      console.log('应用根目录路径:', appRootPath)
      return { success: true, path: appRootPath }
    } catch (error) {
      console.error('获取应用根目录路径失败:', error)
      return { success: false, error: error.message }
    }
  })
}

module.exports = {
  registerIpcHandlers
}

