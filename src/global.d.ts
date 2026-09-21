declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

// Electron 环境中的 File 扩展
// 注意：path 属性已被 Electron 官方弃用，建议未来使用 webUtils.getPathForFile
declare global {
  interface File {
    /** @deprecated 使用 webUtils.getPathForFile 替代 */
    path?: string
  }
}

// Electron API 类型声明
declare global {
  interface Window {
    electronAPI?: {
      // 应用信息
      getAppVersion: () => Promise<string>
      getSystemInfo: () => Promise<any>
      
      // 窗口控制
      minimizeWindow: () => Promise<any>
      maximizeWindow: () => Promise<any>
      closeWindow: () => Promise<any>
      
      // 窗口内容控制
      reloadWindow: () => Promise<void>
      forceReloadWindow: () => Promise<void>
      toggleDevTools: () => Promise<void>
      setFullscreen: (fullscreen: boolean) => Promise<void>
      toggleFullscreen: () => Promise<void>
      
      // 缩放控制
      setZoomLevel: (zoomLevel: number) => Promise<void>
      getZoomLevel: () => Promise<number>
      zoomIn: () => Promise<void>
      zoomOut: () => Promise<void>
      resetZoom: () => Promise<void>
      onAppZoomChanged: (callback: (data: { zoomLevel: number }) => void) => () => void
      
      // 文件操作
      selectExecutableFile: () => Promise<string | null>
      detectLocaleEmulator: () => Promise<string | null>
      selectImageFile: (defaultPath?: string) => Promise<string | null>
      selectScreenshotImage: (screenshotDir?: string) => Promise<string | null>
      selectVideoFile: () => Promise<string | null>
      selectAudioFile: () => Promise<string | null>
      selectNovelFile: () => Promise<string | null>
      selectFolder: () => Promise<{ success: boolean; path?: string; error?: string }>
      // 根据过滤器数组选择文件（统一入口）
      selectFileWithExtensions: (filters?: FileSelectFilter[], defaultPath?: string | null, title?: string) => Promise<string | null>
      
      // 文件系统操作
      checkFileExists: (filePath: string) => Promise<{ success: boolean; exists?: boolean; error?: string }>
      ensureDirectory: (dirPath: string) => Promise<{ success: boolean; error?: string }>
      getFolderSize: (filePath: string) => Promise<{ success: boolean; size?: number; error?: string }>
      openFileFolder: (filePath: string) => Promise<{ success: boolean; folderPath?: string; error?: string }>
      openFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>
      renameFolder: (oldPath: string, newPath: string) => Promise<{ success: boolean; error?: string }>
      openExternal: (urlOrPath: string) => Promise<{ success: boolean; error?: string }>
      getFileIcon: (filePath: string, size?: number) => Promise<{ success: boolean; icon?: string; error?: string }>
      
      // JSON 文件操作
      writeJsonFile: (filePath: string, data: any) => Promise<{ success: boolean; error?: string }>
      readJsonFile: (filePath: string) => Promise<{ success: boolean; data?: any; error?: string }>
      // 备份整个存档目录
      backupSaveDataDirectory: (saveDataDir: string, maxBackups?: number) => Promise<{ success: boolean; backupPath?: string; backupNumber?: number; copiedFiles?: number; copiedFolders?: number; error?: string }>
      deleteFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
      deleteDirectory: (dirPath: string) => Promise<{ success: boolean; error?: string }>
      
      // 文件读写
      writeFile: (filePath: string, buffer: Buffer) => Promise<{ success: boolean; error?: string }>
      saveThumbnail: (filePath: string, dataUrl: string) => Promise<{ success: boolean; error?: string }>
      saveCoverToFolder: (sourceImagePath: string, saveDataDir: string, resourceType: string, resourceId: string) => Promise<{ success: boolean; coverPath?: string; error?: string }>
      saveCoverFromDataUrl: (dataUrl: string, saveDataDir: string, resourceType: string, resourceId: string) => Promise<{ success: boolean; coverPath?: string; error?: string }>
      getFileStats: (filePath: string) => Promise<{ success: boolean; size?: number; isFile?: boolean; isDirectory?: boolean; mtime?: Date; ctime?: Date; atime?: Date; birthtime?: Date; error?: string }>
      listFiles: (dirPath: string) => Promise<{ success: boolean; files?: string[]; error?: string }>
      searchMatchingFiles: (rootDir: string, extensions: string[]) => Promise<{ success: boolean; files?: string[]; error?: string }>
      listImageFiles: (folderPath: string) => Promise<{ success: boolean; files?: string[]; error?: string }>
      listImageFilesInArchive: (archivePath: string) => Promise<{ success: boolean; files?: string[]; error?: string }>
      
      // 文件URL处理
      getFileUrl: (filePath: string) => Promise<{ success: boolean; url?: string; error?: string }>
      readFileAsDataUrl: (filePath: string) => Promise<string | null>
      
      // 文本文件操作
      readTextFile: (filePath: string) => Promise<{ success: boolean; content?: string; fileSize?: number; wordCount?: number; encoding?: string; error?: string }>
      
      // 游戏启动
      launchGame: (executablePath: string, gameName?: string) => Promise<{ success: boolean; pid?: number; windowTitles?: string[]; error?: string }>
      // 使用转区工具启动游戏（LEProc -run）
      launchGameWithLocale: (localeEmulatorPath: string, executablePath: string, gameName?: string) => Promise<{ success: boolean; pid?: number; windowTitles?: string[]; error?: string }>
      // 通过 PID 获取所有窗口标题
      getAllWindowTitlesByPID: (pid: number) => Promise<{ success: boolean; windowTitles?: string[]; error?: string }>
      
      // 系统功能
      showNotification: (title: string, body: string) => Promise<void>
      takeScreenshot: (directory?: string, format?: string, quality?: number, runningGamesInfo?: Record<string, { id: string; pid: number; windowTitles?: string[]; gameName?: string | null; startTime?: number }>) => Promise<{ success: boolean; filepath?: string; filename?: string; windowName?: string; gameFolder?: string; screenshotsDir?: string; matchedGame?: string | null; gameId?: string | null; error?: string }>
      updateGlobalShortcut: (newKey: string) => Promise<{ success: boolean; key?: string; error?: string }>
      checkGlobalShortcutAvailable: (key: string) => Promise<{ success: boolean; available?: boolean; error?: string }>
      
      // 截图目录管理
      getScreenshotsDirectory: () => Promise<string>
      setScreenshotsDirectory: () => Promise<string | null>
      
      // 存档目录管理
      getSaveDataDirectory: () => Promise<string>
      setSaveDataDirectory: () => Promise<{ success: boolean; directory?: string; message?: string; copiedFiles?: number; error?: string } | null>
      
      // 窗口管理
      getAvailableWindows: () => Promise<{ success: boolean; windows?: Array<{ id: string; name: string; thumbnail: string }>; error?: string }>
      getActiveWindow: () => Promise<{ success: boolean; window?: { id: string; name: string; thumbnail: string }; error?: string }>
      
      // 开机自启
      setAutoStart: (enabled: boolean) => Promise<{ success: boolean; enabled?: boolean; error?: string }>
      getAutoStart: () => Promise<{ success: boolean; enabled?: boolean; error?: string }>
      
      // 系统托盘
      createTray: () => Promise<{ success: boolean; message?: string; error?: string }>
      destroyTray: () => Promise<{ success: boolean; message?: string; error?: string }>
      setTrayTooltip: (tooltip: string) => Promise<{ success: boolean; message?: string; error?: string }>
      setTrayContextMenu: (menuTemplate: any) => Promise<{ success: boolean; message?: string; error?: string }>
      minimizeToTray: () => Promise<{ success: boolean; message?: string; error?: string }>
      restoreFromTray: () => Promise<{ success: boolean; message?: string; error?: string }>
      setMinimizeToTray: (enabled: boolean) => Promise<{ success: boolean; enabled?: boolean; error?: string }>
      getMinimizeToTray: () => Promise<{ success: boolean; enabled?: boolean; error?: string }>
      
      // 事件监听
      onMenuAction: (callback: (event: any, data: any) => void) => void
      onGameProcessEnded: (callback: (event: any, data: any) => void) => void
      onGlobalScreenshotTrigger: (callback: () => void) => void
      
      // 移除事件监听器
      removeGlobalScreenshotListener: () => void
      removeAllListeners: (channel: string) => void
      
      // SQLite 数据库操作
      sqliteGetAllTablesData: () => Promise<{ ok: boolean; tables?: Array<{ tableName: string; rows: Array<any> }>; message?: string }>
      sqliteGetPageData: (pageId: string) => Promise<{ ok: boolean; data?: Array<any>; message?: string }>
      sqliteDeleteResource: (tableName: string, resourceId: string) => Promise<{ ok: boolean; message?: string }>
      sqliteSaveResource: (resourceType: string, resource: any) => Promise<{ ok: boolean; message?: string }>
      sqliteAddResourceToPage: (pageId: string, resourceType: string, resourceId: string) => Promise<{ ok: boolean; message?: string }>
      sqliteSavePageResources: (pageId: string, resources: Array<any>) => Promise<{ ok: boolean; message?: string }>
      sqliteMigrateToJsonFormat: () => Promise<{ ok: boolean; migratedTables?: string[]; message?: string }>
      sqliteMigrateAchievements: (customSaveDataPath?: string) => Promise<{ ok: boolean; message?: string; migratedCount?: number }>
      sqliteMigrateSettings: (customSaveDataPath?: string) => Promise<{ ok: boolean; message?: string }>
      sqliteGetSettings: () => Promise<{ ok: boolean; settings?: any; timestamp?: string; version?: string; message?: string }>
      sqliteSaveSettings: (settings: any) => Promise<{ ok: boolean; message?: string }>
      sqliteMigrateUser: (customSaveDataPath?: string) => Promise<{ ok: boolean; message?: string }>
      sqliteGetUser: () => Promise<{ ok: boolean; user?: any; timestamp?: string; version?: string; message?: string }>
      sqliteSaveUser: (user: any) => Promise<{ ok: boolean; message?: string }>
      
      // 刮削库数据库操作
      scraperDbImport: (scrapableFieldsByTable?: Record<string, string[]>, sourceDbPath?: string) => Promise<{ ok: boolean; count?: number; message?: string }>
      scraperDbGetAll: () => Promise<{ ok: boolean; data?: Array<any>; message?: string }>
      scraperDbClear: () => Promise<{ ok: boolean; message?: string }>
      scraperDbSearch: (sourceTable: string, name: string, resourcePath: string) => Promise<{ ok: boolean; matches?: Array<any>; message?: string }>
      scraperDbApply: (sourceTable: string, mainResourceId: number, jsonData: string) => Promise<{ ok: boolean; message?: string }>
      scraperDbReadExternal: (dbPath: string) => Promise<{ ok: boolean; data?: Array<{ _id: number; sourceTable: string; updateTime: string; author: string | null; jsonData: string }>; message?: string }>
      scraperDbMerge: (overwrites: Array<{ localId: number; sourceTable: string; jsonData: string; updateTime: string; author: string | null }>, adds: Array<{ sourceTable: string; jsonData: string; updateTime: string; author: string | null }>) => Promise<{ ok: boolean; overwritten?: number; added?: number; message?: string }>
      
      // 其他方法
      [key: string]: any
    }
  }
}

// 导出空对象，使这个文件成为模块
export {}
  