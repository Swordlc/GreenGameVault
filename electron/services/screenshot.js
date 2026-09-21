/**
 * @module Screenshot
 * @description 管理应用程序的截图功能，包括窗口截图、截图目录管理和窗口列表获取。
 *
 * 主要功能:
 * 1. 截取当前聚焦窗口的截图，支持多种格式（PNG、JPEG、WebP）和质量设置。
 * 2. 根据运行中的游戏信息自动匹配窗口标题，并按游戏名称组织截图文件夹。
 * 3. 过滤系统窗口和通知窗口，只截取应用程序窗口。
 * 4. 管理截图保存目录，支持自定义目录设置。
 * 5. 获取可用窗口列表和当前活跃窗口信息。
 * 6. 注册与截图相关的 IPC 处理器。
 *
 * 导出的函数:
 * - `registerIpcHandlers(ipcMain, getMainWindow, app)`: 注册 IPC 处理器。
 *
 * 内部函数:
 * - `takeScreenshot(customDirectory, format, quality, runningGamesInfo, app)`: 执行截图操作。
 * - `renameScreenshotFolderIfNeeded(baseScreenshotsDir, gameId, expectedFolderName)`: 查找并重命名游戏截图文件夹（如果需要）。
 * - `getScreenshotsDirectory(app)`: 获取默认截图目录。
 * - `setScreenshotsDirectory(getMainWindow, dialog)`: 设置截图目录。
 * - `getAvailableWindows(desktopCapturer)`: 获取可用窗口列表。
 * - `getActiveWindow(desktopCapturer)`: 获取当前活跃窗口。
 *
 * IPC 处理器:
 * - `take-screenshot`: 执行截图操作。
 * - `get-screenshots-directory`: 获取截图保存目录。
 * - `set-screenshots-directory`: 设置截图保存目录。
 * - `get-available-windows`: 获取可用窗口列表。
 * - `get-active-window`: 获取当前活跃窗口。
 *
 * 截图功能特性:
 * - 自动识别游戏窗口（通过窗口标题匹配）。
 * - 按游戏名称或窗口名称组织截图文件夹。
 * - 支持 PNG（无损）、JPEG（有损）、WebP（有损）格式。
 * - 可配置的图片质量（仅适用于 JPEG 和 WebP）。
 * - 自动创建截图保存目录。
 * - 使用时间戳生成唯一的文件名。
 */

const { desktopCapturer, app, dialog } = require('electron')
const fs = require('fs')
const path = require('path')
const windowsUtils = require('../utils/windows-utils')

/**
 * 查找并重命名游戏截图文件夹（如果需要）
 * 查找以 gameId_ 开头的文件夹，如果名称不匹配则重命名为新名称
 * @param {string} baseScreenshotsDir - 基础截图目录
 * @param {string} gameId - 游戏ID
 * @param {string} expectedFolderName - 期望的文件夹名称（格式：ID_游戏名）
 * @returns {{screenshotsDir: string, foundExistingFolder: boolean}} 返回最终的文件夹路径和是否找到现有文件夹
 */
function renameScreenshotFolderIfNeeded(baseScreenshotsDir, gameId, expectedFolderName) {
  const expectedScreenshotsDir = path.join(baseScreenshotsDir, expectedFolderName)
  let screenshotsDir = expectedScreenshotsDir
  let foundExistingFolder = false

  try {
    if (fs.existsSync(baseScreenshotsDir)) {
      const files = fs.readdirSync(baseScreenshotsDir)
      // 清理游戏ID中的非法字符，用于匹配
      const cleanGameId = gameId.replace(/[<>:"/\\|?*]/g, '_').trim()
      
      // 查找所有以 gameId_ 开头的文件夹
      const matchingFolder = files.find(folder => {
        const folderPath = path.join(baseScreenshotsDir, folder)
        const stats = fs.statSync(folderPath)
        return stats.isDirectory() && folder.startsWith(`${cleanGameId}_`)
      })

      if (matchingFolder) {
        const existingFolderPath = path.join(baseScreenshotsDir, matchingFolder)
        console.log(`找到以ID开头的截图文件夹: ${matchingFolder}`)
        
        // 如果找到的文件夹名称与期望的不一致，重命名它
        if (matchingFolder !== expectedFolderName) {
          try {
            fs.renameSync(existingFolderPath, expectedScreenshotsDir)
            console.log(`✅ 已重命名截图文件夹: "${matchingFolder}" -> "${expectedFolderName}"`)
            screenshotsDir = expectedScreenshotsDir
          } catch (renameError) {
            console.warn(`⚠️ 重命名截图文件夹失败:`, renameError.message)
            // 重命名失败，使用现有文件夹
            screenshotsDir = existingFolderPath
          }
        } else {
          screenshotsDir = existingFolderPath
        }
        foundExistingFolder = true
      }
    }
  } catch (error) {
    console.warn('查找截图文件夹失败:', error.message)
  }

  return { screenshotsDir, foundExistingFolder }
}

/**
 * 过滤系统窗口和通知窗口，返回非系统窗口列表。
 * @param {Array} sources - 窗口源列表。
 * @returns {Array} 过滤后的非系统窗口列表。
 */
function filterSystemWindows(sources) {
  return sources.filter(source => {
    const name = source.name.toLowerCase()
    return !name.includes('desktop') &&
           !name.includes('taskbar') &&
           !name.includes('start menu') &&
           // GreenGameVault：排除应用自身窗口（保留旧名 butter manager 以兼容历史行为）
           !name.includes('greengamevault') &&
           !name.includes('green game vault') &&
           !name.includes('butter manager') &&
           !name.includes('electron') &&
           !name.includes('chrome') &&
           !name.includes('browser') &&
           !name.includes('system') &&
           !name.includes('windows') &&
           !name.includes('notification') &&
           !name.includes('通知') &&
           !name.includes('新通知') &&
           !name.includes('electron.app.electron')
  })
}

/**
 * 执行截图操作。
 * 
 * 截图逻辑（修正版）：
 * 1. 先找到所有运行中的游戏的窗口
 * 2. 获取当前聚焦窗口的 PID（用于判断哪个游戏窗口被聚焦）
 * 3. 在所有游戏窗口中，找到正在被聚焦的那个
 * 4. 截图聚焦的游戏窗口
 * 5. 如果没有聚焦的游戏窗口，但只有一个游戏在运行，截图那个游戏
 * 
 * @param {string|null} customDirectory - 自定义截图目录。
 * @param {string} format - 图片格式（png、jpg、jpeg、webp）。
 * @param {number} quality - 图片质量（1-100，仅适用于 JPEG 和 WebP）。
 * @param {Object} runningGamesInfo - 运行中的游戏信息对象。每个游戏包含 pid、windowTitles、gameName 等字段。
 * @param {Object} appInstance - Electron app 实例。
 * @returns {Promise<{success: boolean, filepath?: string, filename?: string, windowName?: string, gameFolder?: string, screenshotsDir?: string, matchedGame?: string, error?: string}>} 截图结果。
 */
async function takeScreenshot(customDirectory, format = 'png', quality = 90, runningGamesInfo = {}, appInstance) {
  try {
    console.log('开始截图，格式:', format, '质量:', quality, '运行中的游戏信息:', runningGamesInfo)

    // 检查是否有运行中的游戏
    if (!runningGamesInfo || Object.keys(runningGamesInfo).length === 0) {
      throw new Error('没有运行中的游戏')
    }

    // 获取所有窗口源
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1920, height: 1080 }
    })

    if (sources.length === 0) {
      throw new Error('无法获取窗口源')
    }

    // 过滤掉系统窗口和通知窗口
    const nonSystemWindows = filterSystemWindows(sources)

    // 获取当前聚焦窗口的 PID（Windows 平台）
    let focusedWindowPID = null
    let focusedWindowTitle = null
    if (process.platform === 'win32') {
      try {
        focusedWindowPID = await windowsUtils.getActiveWindowPID()
        console.log('当前聚焦窗口的 PID:', focusedWindowPID)
        
        // 获取聚焦窗口的标题（用于后续匹配）
        focusedWindowTitle = await windowsUtils.getWindowTitleByPID(focusedWindowPID)
        console.log('当前聚焦窗口的标题:', focusedWindowTitle)
      } catch (error) {
        console.warn('获取聚焦窗口 PID 失败:', error.message)
        // 如果获取失败，使用第一个非系统窗口作为聚焦窗口的备用方案
        if (nonSystemWindows.length > 0) {
          focusedWindowTitle = nonSystemWindows[0].name
          console.log('使用第一个非系统窗口作为聚焦窗口:', focusedWindowTitle)
        }
      }
    } else {
      // 非 Windows 平台，使用第一个非系统窗口作为聚焦窗口
      if (nonSystemWindows.length > 0) {
        focusedWindowTitle = nonSystemWindows[0].name
        console.log('非 Windows 平台，使用第一个非系统窗口作为聚焦窗口:', focusedWindowTitle)
      }
    }

    // 添加调试：打印所有窗口源
    console.log('------------------------------')
    console.log('所有可用窗口源 (共', sources.length, '个):')
    sources.slice(0, 20).forEach((source, index) => {
      console.log(`  [${index}] "${source.name}" (长度: ${source.name.length})`)
    })
    if (sources.length > 20) {
      console.log(`  ... 还有 ${sources.length - 20} 个窗口`)
    }
    console.log('------------------------------')

    // 第一步：找到所有运行中游戏的窗口
    const gameWindows = [] // [{ gameId, gameData, windowTitle, source, isFocused }]

    for (const [gameId, gameData] of Object.entries(runningGamesInfo)) {
      const gamePid = gameData.pid
      const gameWindowTitles = gameData.windowTitles || []
      const gameName = gameData.gameName || gameId

      console.log(`查找游戏 "${gameName}" (PID: ${gamePid}) 的窗口...`)
      console.log(`  游戏窗口标题列表 (共 ${gameWindowTitles.length} 个):`)
      gameWindowTitles.forEach((title, index) => {
        console.log(`    [${index}] "${title}" (长度: ${title.length}, 字符编码: ${JSON.stringify(title)})`)
      })

      // 检查游戏的 PID 是否匹配聚焦窗口的 PID（如果匹配，说明该游戏的某个窗口是聚焦的）
      const gamePidMatchesFocused = focusedWindowPID && gamePid === focusedWindowPID

      // 先尝试通过PID获取正确的窗口标题（处理编码问题）
      let pidWindowTitles = []
      if (gamePid && process.platform === 'win32') {
        try {
          // 通过PID获取窗口标题（使用正确的编码）
          const pidTitle = await windowsUtils.getWindowTitleByPID(gamePid)
          if (pidTitle) {
            pidWindowTitles.push(pidTitle)
            console.log(`  📋 通过PID获取到的窗口标题: "${pidTitle}"`)
          }
        } catch (error) {
          console.warn(`  获取PID ${gamePid} 的窗口标题失败:`, error.message)
        }
      }

      // 合并窗口标题列表（优先使用PID获取的标题）
      const allWindowTitles = [...new Set([...pidWindowTitles, ...gameWindowTitles])]
      
      // 在窗口源中查找匹配的游戏窗口
      let matchedSource = null
      let matchedWindowTitle = null
      
      for (const windowTitle of allWindowTitles) {
        // 尝试多种匹配方式来处理编码问题
        
        // 方式1：严格匹配
        matchedSource = sources.find(source => source.name === windowTitle)
        
        // 方式2：如果严格匹配失败，尝试包含匹配（处理编码问题或标题变化）
        if (!matchedSource) {
          matchedSource = sources.find(source => {
            // 去除首尾空格后比较
            const sourceNameNormalized = source.name.trim()
            const windowTitleNormalized = windowTitle.trim()
            
            // 完全匹配
            if (sourceNameNormalized === windowTitleNormalized) return true
            
            // 包含匹配（任一方向）
            if (sourceNameNormalized.includes(windowTitleNormalized) || 
                windowTitleNormalized.includes(sourceNameNormalized)) {
              return true
            }
            
            // 尝试解码后匹配（处理可能的编码问题）
            try {
              // 如果窗口标题包含非ASCII字符，可能是编码问题
              // 尝试将两个字符串都转换为UTF-8后再比较
              const sourceBuffer = Buffer.from(sourceNameNormalized, 'utf8')
              const titleBuffer = Buffer.from(windowTitleNormalized, 'utf8')
              
              // 如果缓冲区相同，说明是编码显示问题但实际相同
              if (sourceBuffer.equals(titleBuffer)) return true
              
              // 尝试包含匹配（缓冲区层面）
              if (sourceBuffer.includes(titleBuffer) || titleBuffer.includes(sourceBuffer)) {
                return true
              }
            } catch (e) {
              // 编码转换失败，忽略
            }
            
            return false
          })
        }
        
        if (matchedSource) {
          matchedWindowTitle = windowTitle
          break // 找到匹配的窗口，退出循环
        }
      }
      
      // 如果仍然没找到，但PID匹配聚焦窗口，尝试使用PID获取的标题再次匹配
      if (!matchedSource && gamePidMatchesFocused && pidWindowTitles.length > 0) {
        console.log(`  🔄 窗口标题匹配失败，但PID匹配聚焦窗口，尝试使用PID获取的标题匹配`)
        for (const pidTitle of pidWindowTitles) {
          matchedSource = sources.find(source => {
            const sourceNameNormalized = source.name.trim()
            const pidTitleNormalized = pidTitle.trim()
            return sourceNameNormalized === pidTitleNormalized ||
                   sourceNameNormalized.includes(pidTitleNormalized) ||
                   pidTitleNormalized.includes(sourceNameNormalized)
          })
          if (matchedSource) {
            matchedWindowTitle = pidTitle
            break
          }
        }
      }
      
      // 如果仍然没找到，但PID匹配聚焦窗口，尝试通过部分字符匹配（处理编码问题）
      if (!matchedSource && gamePidMatchesFocused) {
        console.log(`  🔄 窗口标题完全匹配失败，但PID匹配聚焦窗口，尝试部分字符匹配`)
        // 尝试从已知的窗口标题中提取可打印的ASCII字符进行匹配
        for (const windowTitle of allWindowTitles) {
          // 提取可打印的ASCII字符（去除乱码）
          const asciiChars = windowTitle.replace(/[^\x20-\x7E]/g, '').trim()
          if (asciiChars.length > 0) {
            matchedSource = sources.find(source => {
              const sourceNameNormalized = source.name.trim()
              // 检查是否包含这些ASCII字符
              return sourceNameNormalized.includes(asciiChars) || 
                     asciiChars.includes(sourceNameNormalized.replace(/[^\x20-\x7E]/g, '').trim())
            })
            if (matchedSource) {
              matchedWindowTitle = windowTitle
              console.log(`  ✅ 通过部分字符匹配找到窗口: "${asciiChars}" -> "${matchedSource.name}"`)
              break
            }
          }
        }
      }
      
      // 如果仍然没找到，但PID匹配聚焦窗口，尝试使用非系统窗口中的第一个（作为最后的备用方案）
      if (!matchedSource && gamePidMatchesFocused && nonSystemWindows.length > 0) {
        console.log(`  ⚠️ 窗口标题匹配完全失败，但PID匹配聚焦窗口，使用第一个非系统窗口作为备用方案`)
        // 检查是否有其他游戏已经匹配了这个窗口
        const alreadyMatched = gameWindows.some(gw => gw.source.id === nonSystemWindows[0].id)
        if (!alreadyMatched) {
          matchedSource = nonSystemWindows[0]
          matchedWindowTitle = matchedSource.name
          console.log(`  ✅ 使用备用窗口: "${matchedWindowTitle}"`)
        }
      }
        
      if (matchedSource) {
          console.log(`  ✅ 找到匹配的窗口: "${matchedWindowTitle}" -> "${matchedSource.name}"`)
          
          // 判断这个窗口是否是聚焦窗口
          // 方式1：如果游戏的PID匹配聚焦窗口的PID，并且窗口标题也匹配，则确定是聚焦窗口
          // 方式2：如果窗口标题直接匹配聚焦窗口的标题，也是聚焦窗口
          let isFocused = false
          if (gamePidMatchesFocused) {
            // 如果PID匹配，检查窗口标题是否匹配（使用灵活的匹配方式）
            if (focusedWindowTitle) {
              const sourceNameNormalized = matchedSource.name.trim()
              const focusedTitleNormalized = focusedWindowTitle.trim()
              
              if (sourceNameNormalized === focusedTitleNormalized ||
                  sourceNameNormalized.includes(focusedTitleNormalized) ||
                  focusedTitleNormalized.includes(sourceNameNormalized)) {
                isFocused = true
                console.log(`  ✅ 游戏窗口通过 PID + 窗口标题匹配到聚焦窗口`)
              }
            } else {
              // PID匹配但无法获取聚焦窗口标题，假设是聚焦的
              isFocused = true
              console.log(`  ✅ 游戏窗口通过 PID 匹配到聚焦窗口`)
            }
          } else if (focusedWindowTitle) {
            // PID不匹配，尝试通过窗口标题匹配
            const sourceNameNormalized = matchedSource.name.trim()
            const focusedTitleNormalized = focusedWindowTitle.trim()
            
            if (sourceNameNormalized === focusedTitleNormalized ||
                sourceNameNormalized.includes(focusedTitleNormalized) ||
                focusedTitleNormalized.includes(sourceNameNormalized)) {
              isFocused = true
              console.log(`  ✅ 游戏窗口通过窗口标题匹配到聚焦窗口`)
            }
          }

          gameWindows.push({
            gameId,
            gameData,
            windowTitle: matchedWindowTitle || matchedSource.name,
            source: matchedSource,
            isFocused
          })
          console.log(`  ✅ 添加游戏窗口: "${matchedWindowTitle}" -> "${matchedSource.name}" (聚焦: ${isFocused})`)
        }
      
      // 如果没有找到匹配的窗口，记录日志
      if (!matchedSource) {
        console.log(`  ❌ 未找到匹配的窗口，尝试过的窗口标题:`, allWindowTitles)
      }
    }

    if (gameWindows.length === 0) {
      throw new Error('未找到任何运行中游戏的窗口')
    }

    // 第二步：找到正在被聚焦的游戏窗口
    let targetGameWindow = gameWindows.find(gw => gw.isFocused)

    // 如果没有聚焦的游戏窗口，但只有一个游戏窗口，使用它
    if (!targetGameWindow && gameWindows.length === 1) {
      targetGameWindow = gameWindows[0]
      console.log('⚠️ 没有聚焦的游戏窗口，但只有一个游戏窗口，使用它')
    }
    // 如果有多个游戏窗口但没有聚焦的，选择第一个
    else if (!targetGameWindow && gameWindows.length > 1) {
      console.log('⚠️ 多个游戏窗口但没有聚焦的，选择第一个游戏窗口')
      targetGameWindow = gameWindows[0]
    }

    if (!targetGameWindow) {
      throw new Error('无法确定要截图的游戏窗口')
    }

    const { gameData, windowTitle, source: targetSource, isFocused } = targetGameWindow
    const matchedGameName = gameData.gameName || targetGameWindow.gameId
    const windowName = targetSource.name
    // 获取游戏ID（唯一标识符）
    const gameId = targetGameWindow.gameId || gameData.id || 'unknown'
    const thumbnail = targetSource.thumbnail

    console.log('------------------------------')
    console.log('最终选择截图窗口:')
    console.log('  游戏ID:', gameId)
    console.log('  游戏名称:', matchedGameName)
    console.log('  窗口标题:', windowName)
    console.log('  是否聚焦:', isFocused)
    console.log('------------------------------')

    // 确定截图保存目录
    let baseScreenshotsDir
    if (customDirectory && customDirectory.trim()) {
      baseScreenshotsDir = customDirectory.trim()
    } else {
      baseScreenshotsDir = path.join(appInstance.getPath('documents'), 'Butter Manager', 'Screenshots')
    }

    // 使用 "ID_游戏名" 格式作为文件夹名，既保证唯一性又方便识别
    // 清理非法字符
    const cleanGameId = gameId.replace(/[<>:"/\\|?*]/g, '_').trim()
    const cleanGameName = (matchedGameName || windowName || 'Screenshots').replace(/[<>:"/\\|?*]/g, '_').trim()
    const expectedFolderName = `${cleanGameId}_${cleanGameName}`

    // 查找并重命名截图文件夹（如果需要）
    const { screenshotsDir, foundExistingFolder } = renameScreenshotFolderIfNeeded(
      baseScreenshotsDir,
      gameId,
      expectedFolderName
    )

    // 如果没找到现有文件夹，创建新文件夹
    if (!foundExistingFolder) {
      if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true })
        console.log('创建游戏截图文件夹:', screenshotsDir)
      }
    }

    // 生成文件名，使用匹配的游戏名称或窗口名称
    // 使用更易读的时间格式：YYYY-MM-DD_HH-MM-SS
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const hours = String(now.getHours()).padStart(2, '0')
    const minutes = String(now.getMinutes()).padStart(2, '0')
    const seconds = String(now.getSeconds()).padStart(2, '0')
    const timestamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`
    
    const fileNameBase = matchedGameName || windowName || 'Screenshot'
    const filename = `${fileNameBase.replace(/[<>:"/\\|?*]/g, '_')}_${timestamp}.${format}`
    const filepath = path.join(screenshotsDir, filename)

    // 根据格式保存截图
    let buffer
    switch (format.toLowerCase()) {
      case 'jpg':
      case 'jpeg':
        buffer = thumbnail.toJPEG(quality)
        break
      case 'webp':
        buffer = thumbnail.toWebP(quality)
        break
      case 'png':
      default:
        buffer = thumbnail.toPNG()
        break
    }

    fs.writeFileSync(filepath, buffer)

    console.log('截图已保存:', filepath, '窗口:', targetSource.name)

    // 从 screenshotsDir 中提取文件夹名称
    const gameFolderName = path.basename(screenshotsDir)

    return {
      success: true,
      filepath: filepath,
      filename: filename,
      windowName: windowName,
      gameFolder: gameFolderName,
      screenshotsDir: screenshotsDir,
      matchedGame: matchedGameName || null,
      gameId: gameId || null // 返回游戏ID，用于更新封面图
    }
  } catch (error) {
    console.error('截图失败:', error)
    return {
      success: false,
      error: error.message
    }
  }
}

/**
 * 获取默认截图保存目录。
 * @param {Object} appInstance - Electron app 实例。
 * @returns {string} 截图保存目录路径。
 */
function getScreenshotsDirectory(appInstance) {
  return path.join(appInstance.getPath('documents'), 'Butter Manager', 'Screenshots')
}

/**
 * 设置截图保存目录（通过对话框选择）。
 * @param {Function} getMainWindow - 获取主窗口的函数。
 * @param {Object} dialogInstance - Electron dialog 实例。
 * @returns {Promise<string|null>} 选择的目录路径或 null。
 */
async function setScreenshotsDirectory(getMainWindow, dialogInstance) {
  try {
    const mainWindow = getMainWindow()
    const result = await dialogInstance.showOpenDialog(mainWindow, {
      title: '选择截图保存目录',
      properties: ['openDirectory', 'createDirectory']
    })

    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0]
    }
    return null
  } catch (error) {
    console.error('选择截图目录失败:', error)
    throw error
  }
}

/**
 * 获取可用窗口列表。
 * @returns {Promise<{success: boolean, windows?: Array, error?: string}>} 窗口列表结果。
 */
async function getAvailableWindows() {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 200, height: 150 }
    })

    // 过滤掉系统窗口和通知窗口
    const windows = filterSystemWindows(sources)
      .map(source => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL()
      }))

    return { success: true, windows }
  } catch (error) {
    console.error('获取窗口列表失败:', error)
    return { success: false, error: error.message }
  }
}

/**
 * 获取当前激活的窗口信息。
 * @returns {Promise<{success: boolean, window?: Object, error?: string}>} 活跃窗口结果。
 */
async function getActiveWindow() {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 200, height: 150 }
    })

    if (sources.length === 0) {
      return { success: false, error: '无法获取窗口信息' }
    }

    // 过滤掉系统窗口和通知窗口，选择第一个（通常是当前激活的）
    const activeWindows = filterSystemWindows(sources)

    if (activeWindows.length > 0) {
      return {
        success: true,
        window: {
          id: activeWindows[0].id,
          name: activeWindows[0].name,
          thumbnail: activeWindows[0].thumbnail.toDataURL()
        }
      }
    }

    return { success: false, error: '未找到活跃窗口' }
  } catch (error) {
    console.error('获取活跃窗口失败:', error)
    return { success: false, error: error.message }
  }
}

/**
 * 注册与截图相关的 IPC 处理器。
 * @param {Object} ipcMain - Electron 的 ipcMain 对象。
 * @param {Function} getMainWindow - 获取主窗口的函数。
 * @param {Object} appInstance - Electron app 实例。
 */
function registerIpcHandlers(ipcMain, getMainWindow, appInstance) {
  // 执行截图
  ipcMain.handle('take-screenshot', async (event, customDirectory, format = 'png', quality = 90, runningGamesInfo = {}) => {
    return await takeScreenshot(customDirectory, format, quality, runningGamesInfo, appInstance)
  })

  // 获取截图保存目录
  ipcMain.handle('get-screenshots-directory', () => {
    return getScreenshotsDirectory(appInstance)
  })

  // 设置截图保存目录
  ipcMain.handle('set-screenshots-directory', async () => {
    return await setScreenshotsDirectory(getMainWindow, dialog)
  })

  // 获取可用窗口列表
  ipcMain.handle('get-available-windows', async () => {
    return await getAvailableWindows()
  })

  // 获取当前激活的窗口
  ipcMain.handle('get-active-window', async () => {
    return await getActiveWindow()
  })
}

module.exports = {
  registerIpcHandlers
}

