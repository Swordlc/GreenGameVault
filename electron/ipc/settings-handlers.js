/**
 * @module SettingsHandlers
 * @description 管理应用程序的设置相关的 IPC 处理器。
 *
 * 主要功能:
 * 1. 获取和设置存档目录路径。
 * 2. 复制存档数据到新目录。
 * 3. 设置和获取开机自启状态。
 * 4. 注册与设置相关的 IPC 处理器。
 *
 * 导出的函数:
 * - `registerIpcHandlers(ipcMain, app, dialog, getMainWindow)`: 注册 IPC 处理器。
 *
 * IPC 处理器:
 * - `get-save-data-directory`: 获取存档目录路径。
 * - `set-save-data-directory`: 设置存档目录（包含目录复制逻辑）。
 * - `set-auto-start`: 设置开机自启。
 * - `get-auto-start`: 获取开机自启状态。
 */

const fs = require('fs')
const path = require('path')

/**
 * 复制存档数据到新目录。
 * @param {string} newDirectory - 新目录路径。
 * @returns {Promise<{success: boolean, message?: string, copiedFiles?: number, copiedFolders?: number, newSaveDataDir?: string, useExistingData?: boolean, error?: string}>} 复制结果。
 */
async function copySaveDataToNewDirectory(newDirectory) {
  try {
    console.log('=== 开始复制存档数据 ===')
    console.log('目标目录:', newDirectory)

    // 获取当前存档目录
    const currentSaveDataDir = path.join(process.cwd(), 'SaveData')
    console.log('当前存档目录:', currentSaveDataDir)

    // 检查当前存档目录是否存在
    if (!fs.existsSync(currentSaveDataDir)) {
      console.log('当前存档目录不存在，无需复制')
      return { success: true, message: '当前存档目录不存在，无需复制' }
    }

    // 创建新的SaveData目录
    const newSaveDataDir = path.join(newDirectory, 'SaveData')
    console.log('新存档目录:', newSaveDataDir)

    // 检查是否选择了相同的目录
    const currentDirNormalized = path.resolve(currentSaveDataDir)
    const newDirNormalized = path.resolve(newSaveDataDir)

    if (currentDirNormalized === newDirNormalized) {
      console.log('选择了与根目录相同的存档目录，无需复制')
      return {
        success: false,
        error: '不能选择与当前存档目录相同的目录。请选择其他目录。'
      }
    }

    // 检查是否与当前使用的自定义目录相同
    try {
      const settingsPath = path.join(currentSaveDataDir, 'Settings', 'settings.json')
      if (fs.existsSync(settingsPath)) {
        const settingsData = fs.readFileSync(settingsPath, 'utf8')
        const settings = JSON.parse(settingsData)

        if (settings.settings && settings.settings.saveDataLocation === 'custom' && settings.settings.saveDataPath) {
          const currentCustomDir = path.resolve(path.join(settings.settings.saveDataPath, 'SaveData'))
          if (currentCustomDir === newDirNormalized) {
            console.log('选择了与当前自定义目录相同的存档目录，无需复制')
            return {
              success: false,
              error: '不能选择与当前存档目录相同的目录。请选择其他目录。'
            }
          }
        }
      }
    } catch (error) {
      console.warn('检查当前自定义目录失败:', error)
    }

    // 检查目标目录是否已经包含存档数据
    let useExistingData = false
    if (fs.existsSync(newSaveDataDir)) {
      const existingFiles = fs.readdirSync(newSaveDataDir)
      if (existingFiles.length > 0) {
        console.log('目标目录已包含存档数据，将使用现有数据')
        useExistingData = true
      }
    }

    // 确保新目录存在
    if (!fs.existsSync(newSaveDataDir)) {
      fs.mkdirSync(newSaveDataDir, { recursive: true })
      console.log('创建新存档目录:', newSaveDataDir)
    }

    // 复制文件和文件夹
    let copiedFiles = 0
    let copiedFolders = 0

    const copyRecursive = (src, dest) => {
      const stats = fs.statSync(src)

      if (stats.isDirectory()) {
        if (!fs.existsSync(dest)) {
          fs.mkdirSync(dest, { recursive: true })
          copiedFolders++
        }

        const items = fs.readdirSync(src)
        for (const item of items) {
          const srcPath = path.join(src, item)
          const destPath = path.join(dest, item)
          copyRecursive(srcPath, destPath)
        }
      } else {
        fs.copyFileSync(src, dest)
        copiedFiles++
      }
    }

    // 开始复制（只有在不使用现有数据时才复制）
    if (!useExistingData) {
      copyRecursive(currentSaveDataDir, newSaveDataDir)
    } else {
      console.log('跳过复制，使用现有存档数据')
    }

    // 复制完成后，更新设置文件
    try {
      const settingsPath = path.join(currentSaveDataDir, 'Settings', 'settings.json')
      const newSettingsPath = path.join(newSaveDataDir, 'Settings', 'settings.json')

      let settings = {}
      if (fs.existsSync(settingsPath)) {
        const settingsData = fs.readFileSync(settingsPath, 'utf8')
        settings = JSON.parse(settingsData)
      }

      // 更新设置，指向新的自定义目录
      if (settings.settings) {
        settings.settings.saveDataLocation = 'custom'
        settings.settings.saveDataPath = newDirectory
      } else {
        settings.settings = {
          saveDataLocation: 'custom',
          saveDataPath: newDirectory
        }
      }

      // 确保新设置目录存在
      const newSettingsDir = path.dirname(newSettingsPath)
      if (!fs.existsSync(newSettingsDir)) {
        fs.mkdirSync(newSettingsDir, { recursive: true })
      }

      // 保存设置到新位置
      fs.writeFileSync(newSettingsPath, JSON.stringify(settings, null, 2))
      console.log('✅ 新位置设置文件已更新')

      // 同时更新根目录的设置文件（保持同步）
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
      console.log('✅ 根目录设置文件已同步')
    } catch (error) {
      console.warn('更新设置文件失败:', error)
    }

    console.log('=== 存档目录设置完成 ===')
    console.log('操作统计:')
    console.log('  - 复制文件数:', copiedFiles)
    console.log('  - 复制文件夹数:', copiedFolders)
    console.log('  - 新存档目录:', newSaveDataDir)
    console.log('  - 使用现有数据:', useExistingData)

    let message = ''
    if (useExistingData) {
      message = `已切换到现有存档目录，设置已同步`
    } else {
      message = `成功复制 ${copiedFiles} 个文件和 ${copiedFolders} 个文件夹到新存档目录，设置已同步`
    }

    return {
      success: true,
      message: message,
      copiedFiles: copiedFiles,
      copiedFolders: copiedFolders,
      newSaveDataDir: newSaveDataDir,
      useExistingData: useExistingData
    }
  } catch (error) {
    console.error('复制存档数据失败:', error)
    return {
      success: false,
      error: `复制存档数据失败: ${error.message}`
    }
  }
}

/**
 * 注册与设置相关的 IPC 处理器。
 * @param {Object} ipcMain - Electron 的 ipcMain 对象。
 * @param {Object} app - Electron 的 app 对象。
 * @param {Object} dialog - Electron 的 dialog 对象。
 * @param {Function} getMainWindow - 获取主窗口的函数。
 */
function registerIpcHandlers(ipcMain, app, dialog, getMainWindow) {
  // 获取存档目录路径
  ipcMain.handle('get-save-data-directory', () => {
    return path.join(process.cwd(), 'SaveData')
  })

  // 设置存档文件夹目录
  ipcMain.handle('set-save-data-directory', async () => {
    try {
      const mainWindow = getMainWindow()
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择存档保存目录',
        properties: ['openDirectory', 'createDirectory']
      })

      if (!result.canceled && result.filePaths.length > 0) {
        const newDirectory = result.filePaths[0]

        // 复制现有存档数据到新目录
        const copyResult = await copySaveDataToNewDirectory(newDirectory)
        if (copyResult.success) {
          console.log('存档数据复制成功:', copyResult.message)
          return {
            success: true,
            directory: newDirectory,
            message: copyResult.message,
            copiedFiles: copyResult.copiedFiles || 0
          }
        } else {
          console.error('存档数据复制失败:', copyResult.error)
          return {
            success: false,
            error: copyResult.error
          }
        }
      }
      return null
    } catch (error) {
      console.error('选择存档目录失败:', error)
      throw error
    }
  })

  // 设置开机自启
  ipcMain.handle('set-auto-start', async (event, enabled) => {
    try {
      console.log('设置开机自启:', enabled)

      if (enabled) {
        // 启用开机自启
        app.setLoginItemSettings({
          openAtLogin: true,
          openAsHidden: false
        })
        console.log('✅ 开机自启已启用')
      } else {
        // 禁用开机自启
        app.setLoginItemSettings({
          openAtLogin: false
        })
        console.log('✅ 开机自启已禁用')
      }

      return { success: true }
    } catch (error) {
      console.error('设置开机自启失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 获取开机自启状态
  ipcMain.handle('get-auto-start', async () => {
    try {
      const loginItemSettings = app.getLoginItemSettings()
      const enabled = loginItemSettings.openAtLogin
      console.log('当前开机自启状态:', enabled)
      return { success: true, enabled: enabled }
    } catch (error) {
      console.error('获取开机自启状态失败:', error)
      return { success: false, error: error.message }
    }
  })
}

module.exports = {
  registerIpcHandlers
}

