/**
 * ============================================================================
 * 系统托盘管理模块 (System Tray Manager)
 * ============================================================================
 * 
 * 功能说明：
 * 本模块负责管理系统托盘（系统通知区域图标），提供应用的后台运行和快速访问功能。
 * 支持最小化到托盘、托盘菜单、托盘通知等功能。
 * 
 * 主要功能：
 * 1. 创建和管理系统托盘图标
 * 2. 托盘右键菜单（显示主窗口、最小化到托盘、设置、退出）
 * 3. 托盘图标交互（单击、双击显示/隐藏主窗口）
 * 4. 托盘通知（显示系统通知气泡）
 * 5. 最小化到托盘功能管理
 * 6. 注册托盘相关的 IPC 处理器
 * 
 * 导出的函数：
 * - createTray()                创建系统托盘
 * - destroyTray()               销毁系统托盘
 * - getTray()                   获取托盘实例
 * - displayBalloon()            显示托盘通知
 * - registerIpcHandlers()      注册托盘相关的 IPC 处理器
 * 
 * IPC 处理器：
 * - create-tray                 创建系统托盘
 * - destroy-tray                销毁系统托盘
 * - set-tray-tooltip            设置托盘提示文本
 * - set-tray-context-menu       设置托盘右键菜单
 * - minimize-to-tray            最小化到托盘
 * - restore-from-tray           从托盘恢复
 * - set-minimize-to-tray        设置最小化到托盘功能
 * - get-minimize-to-tray        获取最小化到托盘功能状态
 * 
 * 托盘菜单功能：
 * - 显示主窗口：显示并聚焦主窗口
 * - 最小化到托盘：隐藏主窗口到托盘
 * - 设置：显示主窗口并跳转到设置页面
 * - 退出：退出应用
 * 
 * 托盘图标交互：
 * - 单击：切换主窗口显示/隐藏状态
 * - 双击：切换主窗口显示/隐藏状态
 * 
 * ============================================================================
 */

const { Tray, Menu, nativeImage, app } = require('electron')
const path = require('path')

// 托盘实例
let tray = null

/**
 * 创建系统托盘
 * @param {BrowserWindow} mainWindow - 主窗口实例
 * @param {Function} getMinimizeToTrayEnabled - 获取最小化到托盘功能状态
 * @param {Function} setMinimizeToTrayEnabled - 设置最小化到托盘功能状态
 */
function createTray(mainWindow, getMinimizeToTrayEnabled, setMinimizeToTrayEnabled) {
  try {
    // 如果托盘已存在，先销毁
    if (tray) {
      tray.destroy()
      tray = null
    }

    // 创建托盘图标
    const iconPath = path.join(__dirname, '../../public/butter-icon.ico')
    const trayIcon = nativeImage.createFromPath(iconPath)
    
    // 如果ICO图标创建失败，尝试使用PNG图标
    if (trayIcon.isEmpty()) {
      const pngIconPath = path.join(__dirname, '../../public/butter-icon.png')
      const pngTrayIcon = nativeImage.createFromPath(pngIconPath)
      if (!pngTrayIcon.isEmpty()) {
        tray = new Tray(pngTrayIcon)
      } else {
        console.warn('无法创建托盘图标，使用默认图标')
        // 创建一个简单的默认图标
        const defaultIcon = nativeImage.createEmpty()
        tray = new Tray(defaultIcon)
      }
    } else {
      tray = new Tray(trayIcon)
    }
    
    // 设置托盘提示文本
    tray.setToolTip('GreenGameVault')
    
    // 创建托盘右键菜单
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show()
            mainWindow.focus()
          }
        }
      },
      {
        label: '最小化到托盘',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.hide()
          }
        }
      },
      { type: 'separator' },
      {
        label: '设置',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show()
            mainWindow.focus()
            // 跳转到设置页面
            mainWindow.webContents.send('navigate-to-settings')
          }
        }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          // 禁用最小化到托盘功能，然后退出
          if (setMinimizeToTrayEnabled) {
            setMinimizeToTrayEnabled(false)
          }
          app.quit()
        }
      }
    ])
    
    tray.setContextMenu(contextMenu)
    
    // 双击托盘图标显示主窗口
    tray.on('double-click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isVisible()) {
          mainWindow.hide()
        } else {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    })
    
    // 单击托盘图标显示/隐藏主窗口
    tray.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isVisible()) {
          mainWindow.hide()
        } else {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    })
    
    console.log('系统托盘创建成功')
    return tray
  } catch (error) {
    console.error('创建系统托盘失败:', error)
    throw error
  }
}

/**
 * 销毁系统托盘
 */
function destroyTray() {
  if (tray) {
    tray.destroy()
    tray = null
    console.log('系统托盘已销毁')
  }
}

/**
 * 获取托盘实例
 */
function getTray() {
  return tray
}

/**
 * 显示托盘通知
 * @param {Object} options - 通知选项
 * @param {string} options.title - 通知标题
 * @param {string} options.content - 通知内容
 */
function displayBalloon(options = {}) {
  if (tray) {
    const { title, content } = options
    tray.displayBalloon({
      title: title || 'GreenGameVault',
      content: content || '',
      icon: nativeImage.createFromPath(path.join(__dirname, '../../public/butter-icon.ico'))
    })
  }
}

/**
 * 注册系统托盘相关的 IPC 处理器
 * @param {IpcMain} ipcMain - Electron IPC Main 对象
 * @param {Function} getMainWindow - 获取主窗口的函数
 * @param {Function} getMinimizeToTrayEnabled - 获取最小化到托盘功能状态
 * @param {Function} setMinimizeToTrayEnabled - 设置最小化到托盘功能状态
 */
function registerIpcHandlers(ipcMain, getMainWindow, getMinimizeToTrayEnabled, setMinimizeToTrayEnabled) {
  // 创建系统托盘
  ipcMain.handle('create-tray', async () => {
    try {
      if (!tray) {
        const mainWindow = getMainWindow()
        createTray(mainWindow, getMinimizeToTrayEnabled, setMinimizeToTrayEnabled)
        return { success: true, message: '系统托盘创建成功' }
      } else {
        return { success: true, message: '系统托盘已存在' }
      }
    } catch (error) {
      console.error('创建系统托盘失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 销毁系统托盘
  ipcMain.handle('destroy-tray', async () => {
    try {
      if (tray) {
        destroyTray()
        return { success: true, message: '系统托盘已销毁' }
      } else {
        return { success: true, message: '系统托盘不存在' }
      }
    } catch (error) {
      console.error('销毁系统托盘失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 设置托盘提示文本
  ipcMain.handle('set-tray-tooltip', async (event, tooltip) => {
    try {
      if (tray) {
        tray.setToolTip(tooltip)
        return { success: true, message: '托盘提示文本已更新' }
      } else {
        return { success: false, error: '系统托盘不存在' }
      }
    } catch (error) {
      console.error('设置托盘提示文本失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 设置托盘右键菜单
  ipcMain.handle('set-tray-context-menu', async (event, menuTemplate) => {
    try {
      if (tray) {
        const contextMenu = Menu.buildFromTemplate(menuTemplate)
        tray.setContextMenu(contextMenu)
        return { success: true, message: '托盘右键菜单已更新' }
      } else {
        return { success: false, error: '系统托盘不存在' }
      }
    } catch (error) {
      console.error('设置托盘右键菜单失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 最小化到托盘
  ipcMain.handle('minimize-to-tray', async () => {
    try {
      const mainWindow = getMainWindow()
      if (mainWindow && tray) {
        mainWindow.hide()
        return { success: true, message: '已最小化到系统托盘' }
      } else {
        return { success: false, error: '主窗口或系统托盘不存在' }
      }
    } catch (error) {
      console.error('最小化到托盘失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 从托盘恢复
  ipcMain.handle('restore-from-tray', async () => {
    try {
      const mainWindow = getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show()
        mainWindow.focus()
        return { success: true, message: '已从系统托盘恢复' }
      } else {
        return { success: false, error: '主窗口不存在' }
      }
    } catch (error) {
      console.error('从托盘恢复失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 设置最小化到托盘功能
  ipcMain.handle('set-minimize-to-tray', async (event, enabled) => {
    try {
      if (setMinimizeToTrayEnabled) {
        setMinimizeToTrayEnabled(enabled)
      }
      console.log('最小化到托盘功能:', enabled ? '已启用' : '已禁用')
      return { success: true, enabled }
    } catch (error) {
      console.error('设置最小化到托盘功能失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 获取最小化到托盘功能状态
  ipcMain.handle('get-minimize-to-tray', async () => {
    try {
      const enabled = getMinimizeToTrayEnabled ? getMinimizeToTrayEnabled() : false
      return { success: true, enabled }
    } catch (error) {
      console.error('获取最小化到托盘功能状态失败:', error)
      return { success: false, error: error.message }
    }
  })
}

module.exports = {
  createTray,
  destroyTray,
  getTray,
  displayBalloon,
  registerIpcHandlers
}

