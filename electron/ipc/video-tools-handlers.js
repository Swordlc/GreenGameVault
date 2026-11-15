/**
 * @module VideoToolsHandlers
 * @description 「视频页 › 多选批量」的两个新工具的 IPC 层（主人 2026-10-10 需求）：
 *
 * 1. **加入 PotPlayer 播放列表** —— 写一份具名 `.dpl` 并交给 PotPlayer（追加到它当前列表末尾），
 *    见 `electron/services/potplayer-playlist.js`。
 * 2. **复制文件到剪贴板** —— 等同在资源管理器按 Ctrl+C，GGV 不碰文件本体，
 *    见 `electron/services/clipboard-files.js`。
 *
 * IPC 处理器:
 * - `potplayer-info`           : 探测安装位置 / 是否在运行 / 默认列表文件
 * - `potplayer-write-playlist` : 把选中的视频写进具名播放列表（可顺带交给 PotPlayer）
 * - `clipboard-copy-files`     : 把选中的文件放进剪贴板，等主人去目标文件夹粘贴
 * - `clipboard-read-files`     : 回读剪贴板里的文件列表（自检 / 诊断）
 */

const potPlayer = require('../services/potplayer-playlist')
const clipboardFiles = require('../services/clipboard-files')

/**
 * 解析「PotPlayer 装在哪」的依据路径。
 *
 * 优先用渲染进程传来的 `exePath`；没有就**直接读库里的设置**（`settings.potPlayerPath`）——
 * 设置本来就是渲染进程存进 SQLite 的，主进程自己读一份比让渲染进程每次带过来更省事，
 * 也顺带保证「设置里改了路径」立刻生效。
 *
 * @param {{ exePath?: string }} payload
 * @returns {Promise<string>} 空字符串 = 交给自动探测
 */
async function resolveExePath(payload = {}) {
  const explicit = String(payload.exePath || '').trim()
  if (explicit) return explicit
  try {
    const result = await require('../database/sqlite').getSettingsFromSqlite()
    const settings = result && result.ok ? result.settings : null
    return String(settings?.potPlayerPath || '').trim()
  } catch (_) {
    return ''
  }
}

/**
 * 从入参里取出「待处理的视频绝对路径」并筛掉磁盘上已经不在的。
 * @param {any} payload
 * @returns {{ files: string[], missing: string[] }}
 */
function pickFiles(payload = {}) {
  const raw = Array.isArray(payload.files) ? payload.files : []
  return potPlayer.collectExistingFiles(raw)
}

/**
 * @param {import('electron').IpcMain} ipcMain
 */
function registerIpcHandlers(ipcMain) {
  /** 探测 PotPlayer：装在哪、在不在跑、默认列表文件叫什么 */
  ipcMain.handle('potplayer-info', async (event, payload = {}) => {
    try {
      return await potPlayer.getInfo(await resolveExePath(payload))
    } catch (error) {
      return { ok: false, source: 'error', message: error.message || String(error) }
    }
  })

  /**
   * 把选中的视频写进一份**具名播放列表**，并（可选）交给 PotPlayer。
   *
   * 只做这一件事：~~覆盖默认列表~~那条路已用真机实测淘汰（默认列表文件是 PotPlayer 的
   * 输出、不是输入，它启动时根本不读），详见 electron/services/potplayer-playlist.js 头部表格。
   *
   * 入参: {
   *   files: string[],        视频绝对路径
   *   tagNames?: string[],    命名依据（用第一个标签，多个收成"等N个"）
   *   fallbackName?: string,  没有标签时的兜底名（如「搜索-xx」/「全部视频」）
   *   exePath?: string,       设置里手填的 PotPlayer 路径（留空则读库里的设置/自动探测）
   *   open?: boolean,         写完是否交给 PotPlayer（/add 追加到它当前列表末尾）
   * }
   */
  ipcMain.handle('potplayer-write-playlist', async (event, payload = {}) => {
    try {
      const install = await potPlayer.resolveInstall(await resolveExePath(payload))
      if (!install.ok) return { ok: false, ...install }

      const { files, missing } = pickFiles(payload)
      if (files.length === 0) {
        return {
          ok: false,
          message:
            missing.length > 0
              ? `选中的 ${missing.length} 个文件在磁盘上都不存在了（可在回收站里「重新关联到…」接回来）`
              : '没有可加入播放列表的视频'
        }
      }

      const fileName = potPlayer.buildNamedPlaylistFileName(payload.tagNames, payload.fallbackName || '视频')
      const target = require('path').join(install.playlistDir, fileName)
      // backup：主人可能在 PotPlayer 里手工调过这份 GGV 列表的顺序，覆盖前留一份到临时目录
      const written = potPlayer.writePlaylistFile(target, files, { backup: true })
      if (!written.ok) return { ok: false, message: written.message }

      const running = await potPlayer.listPotPlayerProcesses()

      let opened = false
      let openMessage
      if (payload.open) {
        const openResult = await potPlayer.openPlaylistInPotPlayer(install.exePath, target)
        opened = Boolean(openResult.ok)
        openMessage = openResult.ok ? undefined : openResult.message
      }

      return {
        ok: true,
        path: written.path,
        fileName,
        count: written.count,
        missingCount: missing.length,
        runningCount: running.length,
        backupPath: written.backupPath,
        opened,
        openMessage
      }
    } catch (error) {
      return { ok: false, message: error.message || String(error) }
    }
  })

  /** 把文件放进剪贴板（等同资源管理器里 Ctrl+C），等主人自己去粘贴 */
  ipcMain.handle('clipboard-copy-files', async (event, payload = {}) => {
    try {
      const files = Array.isArray(payload.files) ? payload.files : []
      const result = await clipboardFiles.copyFilesToClipboard(files, {
        verify: payload.verify !== false
      })
      return result
    } catch (error) {
      return { ok: false, count: 0, missing: [], message: error.message || String(error) }
    }
  })

  /** 回读剪贴板里的文件列表（自检 / 诊断用） */
  ipcMain.handle('clipboard-read-files', async () => {
    try {
      const files = await clipboardFiles.readClipboardFileList()
      return { ok: true, files }
    } catch (error) {
      return { ok: false, files: [], message: error.message || String(error) }
    }
  })
}

module.exports = { registerIpcHandlers }
