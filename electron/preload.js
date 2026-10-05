const { contextBridge, ipcRenderer } = require('electron')

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 系统信息
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  listLogicalDrives: () => ipcRenderer.invoke('list-logical-drives'),
  
  // 窗口控制
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  
  // 窗口内容控制
  reloadWindow: () => ipcRenderer.invoke('reload-window'),
  forceReloadWindow: () => ipcRenderer.invoke('force-reload-window'),
  toggleDevTools: () => ipcRenderer.invoke('toggle-dev-tools'),
  setFullscreen: (fullscreen) => ipcRenderer.invoke('set-fullscreen', fullscreen),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  
  // 缩放控制
  setZoomLevel: (zoomLevel) => ipcRenderer.invoke('set-zoom-level', zoomLevel),
  getZoomLevel: () => ipcRenderer.invoke('get-zoom-level'),
  zoomIn: () => ipcRenderer.invoke('zoom-in'),
  zoomOut: () => ipcRenderer.invoke('zoom-out'),
  resetZoom: () => ipcRenderer.invoke('reset-zoom'),
  // 监听应用缩放变化（菜单/快捷键触发时由主进程发送，用于显示“缩放至 XX%”提示）
  onAppZoomChanged: (callback) => {
    const fn = (event, data) => callback(data)
    ipcRenderer.on('app-zoom-changed', fn)
    return () => ipcRenderer.removeListener('app-zoom-changed', fn)
  },
  
  // 文件操作（已移除 openFile 和 saveFile，因为 electron.js 中没有对应的 IPC 处理程序）
  
  // JSON 文件操作
  writeJsonFile: (filePath, data) => ipcRenderer.invoke('write-json-file', filePath, data),
  readJsonFile: (filePath) => ipcRenderer.invoke('read-json-file', filePath),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  deleteDirectory: (dirPath) => ipcRenderer.invoke('delete-directory', dirPath),
  ensureDirectory: (dirPath) => ipcRenderer.invoke('ensure-directory', dirPath),
  renameFolder: (oldPath, newPath) => ipcRenderer.invoke('rename-folder', oldPath, newPath),
  
  // 文件操作
  writeFile: (filePath, buffer) => ipcRenderer.invoke('write-file', filePath, buffer),
  saveThumbnail: (filePath, dataUrl) => ipcRenderer.invoke('save-thumbnail', filePath, dataUrl),
  getFileStats: (filePath) => ipcRenderer.invoke('get-file-stats', filePath),
  listFiles: (dirPath) => ipcRenderer.invoke('list-files', dirPath),
  searchMatchingFiles: (rootDir, extensions) => ipcRenderer.invoke('search-matching-files', rootDir, extensions),
  
  // 伪装图片功能
  readDisguiseImages: () => ipcRenderer.invoke('read-disguise-images'),
  getAppRootPath: () => ipcRenderer.invoke('get-app-root-path'),
  
  // 文件选择对话框
  selectExecutableFile: () => ipcRenderer.invoke('select-executable-file'),
  detectLocaleEmulator: () => ipcRenderer.invoke('detect-locale-emulator'),
  selectImageFile: (defaultPath) => ipcRenderer.invoke('select-image-file', defaultPath),
  selectScreenshotImage: (screenshotDir) => ipcRenderer.invoke('select-screenshot-image', screenshotDir),
  selectVideoFile: (defaultPath) => ipcRenderer.invoke('select-video-file', defaultPath),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  // 根据过滤器数组选择文件（统一入口）
  selectFileWithExtensions: (filters, defaultPath, title) => ipcRenderer.invoke('select-file-with-extensions', filters, defaultPath, title),
  listImageFiles: (folderPath) => ipcRenderer.invoke('list-image-files', folderPath),
  listImageFilesInArchive: (archivePath) => ipcRenderer.invoke('list-image-files-in-archive', archivePath),
  getFolderSize: (filePath) => ipcRenderer.invoke('get-folder-size', filePath),
  checkFileExists: (filePath) => ipcRenderer.invoke('check-file-exists', filePath),
  
  // 文件URL处理
  getFileUrl: (filePath) => ipcRenderer.invoke('get-file-url', filePath),
  // 将本地文件读为 data:URL（用于在 http 源下安全显示本地图片）
  readFileAsDataUrl: (filePath) => ipcRenderer.invoke('read-file-as-data-url', filePath),
  openExternal: (filePath) => ipcRenderer.invoke('open-external', filePath),
  
  // 游戏启动
  launchGame: (executablePath, gameName) => ipcRenderer.invoke('launch-game', executablePath, gameName),
  // 使用转区工具启动游戏（LEProc -run）
  launchGameWithLocale: (localeEmulatorPath, executablePath, gameName) => ipcRenderer.invoke('launch-game-with-locale', localeEmulatorPath, executablePath, gameName),
  // 强制结束游戏
  terminateGame: (executablePath, gameName) => ipcRenderer.invoke('terminate-game', executablePath, gameName),
  // 通过 PID 获取所有窗口标题
  getAllWindowTitlesByPID: (pid) => ipcRenderer.invoke('get-all-window-titles-by-pid', pid),
  
  // 系统信息
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  
  // 磁盘信息
  getDiskInfo: () => ipcRenderer.invoke('get-disk-info'),
  getDiskTypeByPath: (filePath) => ipcRenderer.invoke('get-disk-type-by-path', filePath),
  getLogicalDrivesInfo: () => ipcRenderer.invoke('get-logical-drives-info'),

  // SQLite demo 数据（数据库页面展示）
  sqliteGetAllTablesData: () => ipcRenderer.invoke('sqlite-get-all-tables-data'),
  // 从数据库读取页面数据
  sqliteGetPageData: (pageId) => ipcRenderer.invoke('sqlite-get-page-data', pageId),
  // 保存资源到数据库
  sqliteSaveResource: (resourceType, resource) => ipcRenderer.invoke('sqlite-save-resource', resourceType, resource),
  // 添加资源到页面索引
  sqliteAddResourceToPage: (pageId, resourceType, resourceId) => ipcRenderer.invoke('sqlite-add-resource-to-page', pageId, resourceType, resourceId),
  // 保存页面资源（批量）
  sqliteSavePageResources: (pageId, resources) => ipcRenderer.invoke('sqlite-save-page-resources', pageId, resources),
  // 从数据库删除资源
  sqliteDeleteResource: (tableName, resourceId) => ipcRenderer.invoke('sqlite-delete-resource', tableName, resourceId),
  // 将旧格式 SQL 迁移为 id+jsonData 格式
  sqliteMigrateToJsonFormat: () => ipcRenderer.invoke('sqlite-migrate-to-json-format'),
  // 从 JSON 迁移成就数据到 SQLite
  sqliteMigrateAchievements: (customSaveDataPath) => ipcRenderer.invoke('sqlite-migrate-achievements', customSaveDataPath),
  // 从 JSON 迁移设置数据到 SQLite
  sqliteMigrateSettings: (customSaveDataPath) => ipcRenderer.invoke('sqlite-migrate-settings', customSaveDataPath),
  // 从 SQLite 读取设置数据
  sqliteGetSettings: () => ipcRenderer.invoke('sqlite-get-settings'),
  // 保存设置数据到 SQLite
  sqliteSaveSettings: (settings) => ipcRenderer.invoke('sqlite-save-settings', settings),
  // 从 JSON 迁移用户数据到 SQLite
  sqliteMigrateUser: (customSaveDataPath) => ipcRenderer.invoke('sqlite-migrate-user', customSaveDataPath),
  // 从 SQLite 读取用户数据
  sqliteGetUser: () => ipcRenderer.invoke('sqlite-get-user'),
  // 保存用户数据到 SQLite
  sqliteSaveUser: (user) => ipcRenderer.invoke('sqlite-save-user', user),
  
  // 刮削库数据库操作
  
  // 获取文件图标
  getFileIcon: (filePath, size) => ipcRenderer.invoke('get-file-icon', filePath, size),
  
  // 通知
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', title, body),
  
  // 截图功能
  takeScreenshot: (directory, format, quality, runningGameNames) => ipcRenderer.invoke('take-screenshot', directory, format, quality, runningGameNames),
  getScreenshotsDirectory: () => ipcRenderer.invoke('get-screenshots-directory'),
  setScreenshotsDirectory: () => ipcRenderer.invoke('set-screenshots-directory'),
  
  // 存档文件夹功能
  getSaveDataDirectory: () => ipcRenderer.invoke('get-save-data-directory'),
  setSaveDataDirectory: () => ipcRenderer.invoke('set-save-data-directory'),
  
  openFolder: (filePath) => ipcRenderer.invoke('open-folder', filePath),
  getAvailableWindows: () => ipcRenderer.invoke('get-available-windows'),
  getActiveWindow: () => ipcRenderer.invoke('get-active-window'),
  updateGlobalShortcut: (newKey) => ipcRenderer.invoke('update-global-shortcut', newKey),
  checkGlobalShortcutAvailable: (key) => ipcRenderer.invoke('check-global-shortcut-available', key),
  updateShowWindowShortcut: (newKey) => ipcRenderer.invoke('update-show-window-shortcut', newKey),
  
  // 选择音频文件
  selectAudioFile: () => ipcRenderer.invoke('select-audio-file'),
  
  // 选择小说文件
  selectNovelFile: () => ipcRenderer.invoke('select-novel-file'),
  
  // 读取文本文件内容
  readTextFile: (filePath) => ipcRenderer.invoke('read-text-file', filePath),
  
  // 打开文件所在文件夹
  openFileFolder: (filePath) => ipcRenderer.invoke('open-file-folder', filePath),
  
  // 开机自启功能
  setAutoStart: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),
  getAutoStart: () => ipcRenderer.invoke('get-auto-start'),
  
  // 系统托盘功能
  createTray: () => ipcRenderer.invoke('create-tray'),
  destroyTray: () => ipcRenderer.invoke('destroy-tray'),
  setTrayTooltip: (tooltip) => ipcRenderer.invoke('set-tray-tooltip', tooltip),
  setTrayContextMenu: (menuTemplate) => ipcRenderer.invoke('set-tray-context-menu', menuTemplate),
  minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),
  restoreFromTray: () => ipcRenderer.invoke('restore-from-tray'),
  setMinimizeToTray: (enabled) => ipcRenderer.invoke('set-minimize-to-tray', enabled),
  getMinimizeToTray: () => ipcRenderer.invoke('get-minimize-to-tray'),
  
  // 监听事件
  onMenuAction: (callback) => ipcRenderer.on('menu-action', callback),
  onGameProcessEnded: (callback) => ipcRenderer.on('game-process-ended', callback),
  onGlobalScreenshotTrigger: (callback) => ipcRenderer.on('global-screenshot-trigger', callback),
  
  // 移除事件监听器
  removeGlobalScreenshotListener: () => ipcRenderer.removeAllListeners('global-screenshot-trigger'),
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
  
  // 安全键功能
  setSafetyKey: (enabled, url) => ipcRenderer.invoke('set-safety-key', enabled, url),
  onSafetyKeyTriggered: (callback) => ipcRenderer.on('safety-key-triggered', callback),
  
  // 备份整个存档目录
  backupSaveDataDirectory: (saveDataDir, maxBackups) => ipcRenderer.invoke('backup-save-data-directory', saveDataDir, maxBackups),
  
  // 封面管理
  saveCoverToFolder: (sourceImagePath, saveDataDir, resourceType, resourceId) => ipcRenderer.invoke('save-cover-to-folder', sourceImagePath, saveDataDir, resourceType, resourceId),
  saveCoverFromDataUrl: (dataUrl, saveDataDir, resourceType, resourceId) => ipcRenderer.invoke('save-cover-from-dataurl', dataUrl, saveDataDir, resourceType, resourceId),
  getCoverFullPath: (coverPath, saveDataDir) => ipcRenderer.invoke('get-cover-full-path', coverPath, saveDataDir),

  // ===== 视频页（绑定文件夹 / 实时监听 / 抽帧封面 / 打开次数）=====
  // 递归扫描绑定目录下的全部视频文件
  videoScan: (payload) => ipcRenderer.invoke('video-scan', payload),
  // 开始 / 停止监听绑定目录（变化时主进程推 video-library-changed 事件）
  videoWatchStart: (roots) => ipcRenderer.invoke('video-watch-start', roots),
  videoWatchStop: () => ipcRenderer.invoke('video-watch-stop'),
  // ffmpeg 可用性（抽帧优先用 ffmpeg，不可用时回退 canvas）
  videoFfmpegInfo: () => ipcRenderer.invoke('video-ffmpeg-info'),
  // 随机抽 1 帧并【覆盖】写入封面（固定文件名，不膨胀）
  videoGrabCover: (payload) => ipcRenderer.invoke('video-grab-cover', payload),
  // canvas 回退：把 dataURL 覆盖写入封面
  videoSaveCoverDataUrl: (payload) => ipcRenderer.invoke('video-save-cover-dataurl', payload),
  // 删除封面
  videoDeleteCover: (payload) => ipcRenderer.invoke('video-delete-cover', payload),
  // 用系统默认播放器打开视频
  videoOpen: (payload) => ipcRenderer.invoke('video-open', payload),
  // 打开文件所在文件夹并选中
  videoReveal: (filePath) => ipcRenderer.invoke('video-reveal', filePath),
  // 外部播放统计（PotStats 子进程，走 PotPlayer 官方 IPC）的挂载状态
  potStatsStatus: () => ipcRenderer.invoke('potstats-status'),
  // 立刻做一次 ini 全库对账（「重新扫描」时用；ini 是外部播放统计的唯一事实来源）
  potStatsSync: (payload) => ipcRenderer.invoke('potstats-sync', payload),
  // 「重新关联到…」：校验用户挑的新文件并算出该记录应有的字段
  videoRelink: (payload) => ipcRenderer.invoke('video-relink', payload),
  // 「整个文件夹重新关联到…」：指认丢失目录的新位置，批量算好每条的字段
  videoRelinkBatch: (payload) => ipcRenderer.invoke('video-relink-batch', payload),
  // 监听绑定目录的变化
  onVideoLibraryChanged: (callback) => {
    const fn = (event, data) => callback(data)
    ipcRenderer.on('video-library-changed', fn)
    return () => ipcRenderer.removeListener('video-library-changed', fn)
  }
})

// 监听来自主进程的消息
ipcRenderer.on('app-ready', () => {
  console.log('Electron应用已准备就绪')
})

// 监听窗口事件
window.addEventListener('DOMContentLoaded', () => {
  console.log('Vue应用已加载完成')
})
