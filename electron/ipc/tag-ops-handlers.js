/**
 * @module TagOpsHandlers
 * @description 标签批量操作（重命名 / 合并 / 移除）的 IPC 入口。
 *
 * 只做三件事：校验入参 → 解析出数据库路径与备份目录 → 交给 services/tag-ops 干活。
 * 真正的逻辑与写库都在 services/tag-ops.js（那边是纯函数 + 单事务，可单独测试）。
 *
 * IPC 处理器:
 * - `tag-op-apply`: 执行一次标签操作（全库同类型记录），返回受影响条数与被改动的明细
 * - `tag-op-undo`: 撤销一次标签操作（默认撤销最近一次）
 * - `tag-op-last-backup`: 查询最近一次可撤销的操作（左栏「撤销」入口用）
 */

const sqlite = require('../database/sqlite')
const tagOps = require('../services/tag-ops')

/** 把渲染层传来的资源类型（game/Game/video/…）解析成数据表名 */
function resolveTableName(resourceType) {
  if (!resourceType || typeof resourceType !== 'string') return null
  const key = resourceType.trim()
  if (!key) return null
  const mapped = sqlite.mapResourceTypeToTableName(key)
  // 命中映射表（如 'game' → 'games'）；否则再试一次小写（页面配置里给的是 'Game' 这种首字母大写）
  if (mapped !== key) return mapped
  return sqlite.mapResourceTypeToTableName(key.toLowerCase())
}

/**
 * 注册标签操作相关的 IPC 处理器。
 * @param {object} ipcMain - Electron 的 ipcMain
 */
function registerIpcHandlers(ipcMain) {
  ipcMain.handle('tag-op-apply', async (event, payload = {}) => {
    const { resourceType, field, action, from = [], to = null, allowExisting = false, dryRun = false } = payload || {}
    const tableName = resolveTableName(resourceType)
    if (!tableName) {
      return { ok: false, code: 'bad-resource', message: `未知的资源类型：${resourceType}` }
    }
    if (typeof field !== 'string' || !field) {
      return { ok: false, code: 'bad-args', message: '缺少字段名' }
    }
    if (!Array.isArray(from) || from.some(name => typeof name !== 'string')) {
      return { ok: false, code: 'bad-args', message: '源标签列表格式不对' }
    }
    if (from.length > 200) {
      return { ok: false, code: 'bad-args', message: '一次合并的标签太多了' }
    }

    const dbPath = sqlite.getDatabasePath()
    const backupDir = tagOps.resolveBackupDir(sqlite.getSaveDataDirectory())
    return tagOps.applyTagOperation({
      dbPath,
      tableName,
      backupDir,
      field,
      action,
      from,
      to: typeof to === 'string' ? to : null,
      allowExisting: !!allowExisting,
      // ⚠️ dryRun 必须透传：漏掉它的话，"预览影响面"会变成真的改库
      //    （移除标签的预览会直接删标签、合并的预览会白写一遍并留一个假备份）
      dryRun: !!dryRun
    })
  })

  ipcMain.handle('tag-op-undo', async (event, payload = {}) => {
    const { resourceType, backupPath = null } = payload || {}
    const tableName = resolveTableName(resourceType)
    const backupDir = tagOps.resolveBackupDir(sqlite.getSaveDataDirectory())
    let target = backupPath
    if (!target) {
      const latest = tagOps.listLatestBackup(backupDir, tableName)
      if (!latest) return { ok: false, code: 'backup-missing', message: '没有可撤销的标签操作' }
      target = latest.path
    }
    return tagOps.undoTagOperation({ dbPath: sqlite.getDatabasePath(), backupPath: target, tableName })
  })

  ipcMain.handle('tag-op-last-backup', async (event, payload = {}) => {
    const { resourceType } = payload || {}
    const tableName = resolveTableName(resourceType)
    const backupDir = tagOps.resolveBackupDir(sqlite.getSaveDataDirectory())
    return { ok: true, backup: tagOps.listLatestBackup(backupDir, tableName) }
  })
}

module.exports = { registerIpcHandlers, resolveTableName }
