/**
 * @module TagOps
 * @description 标签级批量操作（重命名 / 合并 / 移除）—— 直接改写资源表里的字段值。
 *
 * 背景（主人 2026-10-13 提出的 1.5.0 需求之一）：
 *   左栏筛选器里的标签（标签/开发商/作者/发行商/引擎等）以前只能"点来筛选"，
 *   要改名只能一条条进编辑对话框；一个标签动辄几百上千条记录（实测视频页「3D」=913 条），
 *   人工改不现实，于是有了这个模块。
 *
 * 三条铁律：
 *   1. **先备份再写**：写库前把"哪些 id、改前是什么、改后是什么"落成 JSON 备份；
 *      万一主人后悔，「撤销上一次标签操作」能按 id 精确还原。
 *   2. **只改受影响的行**：不做整页重写（视频页 5500+ 行整页保存约 800ms，
 *      而一次标签操作真正要动的通常只有几十到几百行）。
 *   3. **纯逻辑与 IO 分离**：`planTagOperation` / `validateTagOperation` 是纯函数，
 *      不碰数据库、不碰 Electron，可以单独跑单测；只有 apply/undo 才 require better-sqlite3。
 *
 * 字段类型说明（实测数据）：
 *   - 数组字段：`video.tags` / `video.author` / `game.developers` → 移除 = 从数组里删掉，
 *     合并 = 命中的元素替换成新名再去重（同一条记录里 A、B 都有时不会变成两个 C）。
 *   - 单值字段：`game.publisher` / `game.engine` → 移除 = 清空成 ''，改名/合并 = 命中就替换。
 *   按"这条记录里该字段实际是什么"逐条判断，不强行按配置走，避免历史脏数据被判错。
 */

const fs = require('fs')
const path = require('path')

/** 备份目录名（放在存档目录下，跟存档一起走） */
const BACKUP_DIR_NAME = 'TagOpsBackup'
/** 最多保留多少份备份（超出按时间删最旧的） */
const MAX_BACKUPS = 20
/** 备份文件格式版本 */
const BACKUP_FORMAT_VERSION = 1

const ACTIONS = ['rename', 'merge', 'remove']

/**
 * 读取记录里某字段的"真实值"。
 * 兼容三种形态：纯值（数据库里的样子）、`{ value }` 包装、ResourceField 实例。
 * @param {object} record - 资源对象
 * @param {string} field - 字段名
 * @returns {*} 字段值
 */
function readFieldValue(record, field) {
  const raw = record == null ? undefined : record[field]
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw) {
    return raw.value
  }
  return raw
}

/**
 * 按动作把"一条记录的一个字段值"算成新值（纯函数，不改原值）。
 *
 * @param {*} value - 原字段值（数组或单值）
 * @param {object} plan - `{ action, from, to }`
 * @returns {{ changed: boolean, value: * }} 新值；`changed=false` 表示这条记录不受影响
 */
function applyToValue(value, plan) {
  const { action, from, to } = plan
  const fromSet = new Set(from)

  // 数组字段
  if (Array.isArray(value)) {
    const next = []
    let hit = false
    for (const item of value) {
      const name = typeof item === 'string' ? item : String(item)
      if (fromSet.has(name)) {
        hit = true
        if (action === 'remove') continue // 移除：直接丢掉
        next.push(to) // 改名 / 合并：替换成目标名
      } else {
        next.push(item)
      }
    }
    if (!hit) return { changed: false, value }
    // 去重（保持首次出现顺序）：合并时同一条记录里 A、B 都有，只会留下一个 C
    const deduped = []
    const seen = new Set()
    for (const item of next) {
      const key = typeof item === 'string' ? item : String(item)
      if (seen.has(key)) continue
      seen.add(key)
      deduped.push(item)
    }
    return { changed: true, value: deduped }
  }

  // 单值字段
  const name = value == null ? '' : String(value)
  if (!fromSet.has(name)) return { changed: false, value }
  return { changed: true, value: action === 'remove' ? '' : to }
}

/**
 * 根据一批记录算出"要改哪些行、改成什么"（纯函数）。
 *
 * @param {Array<{id: string}>} records - 记录数组（已解析的对象，每条至少含 id 与目标字段）
 * @param {object} options - `{ field, action, from, to }`
 * @returns {{ changes: Array<{id: string, before: *, after: *}>, affected: number, scanned: number, inventory: string[] }}
 *   - `changes`：仅有变化的记录
 *   - `inventory`：该字段在全库出现过的所有取值（用于改名撞名检测）
 */
function planTagOperation(records, options) {
  const { field, action, from = [], to = null } = options || {}
  const list = Array.isArray(records) ? records : []
  const changes = []
  const inventory = new Set()

  for (const record of list) {
    if (!record || record.id == null) continue
    const before = readFieldValue(record, field)
    // 统计库存（整个字段的取值集合，数组逐项展开）
    if (Array.isArray(before)) {
      for (const item of before) inventory.add(typeof item === 'string' ? item : String(item))
    } else if (before != null && before !== '') {
      inventory.add(String(before))
    }

    const result = applyToValue(before, { action, from, to })
    if (!result.changed) continue
    changes.push({ id: String(record.id), before, after: result.value })
  }

  return {
    changes,
    affected: changes.length,
    scanned: list.length,
    inventory: Array.from(inventory).sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }
}

/**
 * 操作前的合法性检查（纯函数）。
 *
 * @param {object} options - `{ action, from, to, inventory, allowExisting }`
 * @returns {{ ok: true } | { ok: false, code: string, message: string }}
 *   - `duplicate`：改名目标已存在 → 引导用「合并标签」
 *   - `unchanged`：目标名和原名叫法一样
 *   - `empty-name` / `invalid-action` / `no-source`
 */
function validateTagOperation(options) {
  const { action, from = [], to = null, inventory = [], allowExisting = false } = options || {}

  if (!ACTIONS.includes(action)) {
    return { ok: false, code: 'invalid-action', message: `未知的标签操作：${action}` }
  }
  const sources = (Array.isArray(from) ? from : [from]).filter(name => typeof name === 'string' && name !== '')
  if (sources.length === 0) {
    return { ok: false, code: 'no-source', message: '没有指定要操作的标签' }
  }

  if (action === 'remove') return { ok: true }

  const target = typeof to === 'string' ? to.trim() : ''
  if (!target) {
    return { ok: false, code: 'empty-name', message: '新标签名不能为空' }
  }
  if (action === 'rename' && sources.length === 1 && sources[0] === target) {
    return { ok: false, code: 'unchanged', message: `新名字和原名一样（${target}）` }
  }
  // 改名撞名：停止，引导去用合并（主人明确要求的行为）
  // 合并则允许目标名已经存在 —— 那正是"并入已有标签"的用法
  const exists = inventory.some(name => name === target)
  if (action === 'rename' && exists && !allowExisting && !sources.includes(target)) {
    return {
      ok: false,
      code: 'duplicate',
      message: `已经存在名为「${target}」的标签，请改用「合并标签」把两者并到一起`
    }
  }
  return { ok: true }
}

/** 生成备份文件名：`20261013-221530-rename-tags.json` */
function buildBackupFileName(date, action, field) {
  const pad = value => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  const safeField = String(field || 'field').replace(/[^\w.-]/g, '_')
  return `${stamp}-${action}-${safeField}.json`
}

/**
 * 组装备份内容（纯函数，便于测试）。
 * @param {object} options - `{ tableName, field, action, from, to, changes, createdAt }`
 * @returns {object} 备份对象
 */
function buildBackupPayload(options) {
  const { tableName, field, action, from = [], to = null, changes = [], createdAt = new Date() } = options || {}
  return {
    version: BACKUP_FORMAT_VERSION,
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : String(createdAt),
    tableName,
    field,
    action,
    from,
    to,
    affected: changes.length,
    changes: changes.map(item => ({ id: item.id, before: item.before, after: item.after }))
  }
}

/** 备份目录（不存在则建） */
function ensureBackupDir(backupDir) {
  if (!backupDir) return null
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })
  return backupDir
}

/** 写一份备份文件，返回绝对路径 */
function writeBackupFile(backupDir, payload, date = new Date()) {
  ensureBackupDir(backupDir)
  const filePath = path.join(backupDir, buildBackupFileName(date, payload.action, payload.field))
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')
  return filePath
}

/** 只保留最近 MAX_BACKUPS 份备份 */
function pruneBackups(backupDir, max = MAX_BACKUPS) {
  if (!backupDir || !fs.existsSync(backupDir)) return []
  const entries = fs.readdirSync(backupDir)
    .filter(name => name.endsWith('.json'))
    .map(name => {
      const full = path.join(backupDir, name)
      let mtime = 0
      try { mtime = fs.statSync(full).mtimeMs } catch { /* 忽略 */ }
      return { full, name, mtime }
    })
    .sort((a, b) => b.mtime - a.mtime)

  const removed = []
  for (const entry of entries.slice(max)) {
    try {
      fs.unlinkSync(entry.full)
      removed.push(entry.name)
    } catch { /* 忽略 */ }
  }
  return removed
}

/**
 * 读取最近一份备份的概要（用于界面上的「撤销上一次标签操作」）。
 * @param {string} backupDir - 备份目录
 * @param {string} [tableName] - 只看这个表的备份（不传则看全部）
 * @returns {object|null} `{ path, fileName, createdAt, action, field, from, to, affected, tableName }`
 */
function listLatestBackup(backupDir, tableName = null) {
  if (!backupDir || !fs.existsSync(backupDir)) return null
  const files = fs.readdirSync(backupDir)
    .filter(name => name.endsWith('.json'))
    .map(name => {
      const full = path.join(backupDir, name)
      let mtime = 0
      try { mtime = fs.statSync(full).mtimeMs } catch { /* 忽略 */ }
      return { full, name, mtime }
    })
    .sort((a, b) => b.mtime - a.mtime)

  for (const file of files) {
    try {
      const payload = JSON.parse(fs.readFileSync(file.full, 'utf8'))
      if (tableName && payload.tableName !== tableName) continue
      return {
        path: file.full,
        fileName: file.name,
        createdAt: payload.createdAt || null,
        action: payload.action,
        field: payload.field,
        from: payload.from || [],
        to: payload.to ?? null,
        affected: Number(payload.affected) || (Array.isArray(payload.changes) ? payload.changes.length : 0),
        tableName: payload.tableName
      }
    } catch {
      continue
    }
  }
  return null
}

/**
 * 执行一次标签操作（写库 + 备份）。
 *
 * @param {object} options
 * @param {string} options.dbPath - database.db 路径
 * @param {string} options.tableName - 资源表名（如 'video' / 'games'）
 * @param {string} options.field - 字段名（如 'tags' / 'author' / 'publisher'）
 * @param {'rename'|'merge'|'remove'} options.action - 动作
 * @param {string[]} options.from - 源标签名（合并/移除可多个）
 * @param {string|null} options.to - 目标标签名（移除时为 null）
 * @param {string} [options.backupDir] - 备份目录；不传则不备份（测试用）
 * @param {boolean} [options.allowExisting] - 是否允许目标名已存在（合并用）
 * @param {boolean} [options.dryRun] - 只算不写（用于预览影响面）
 * @returns {Promise<{ok: boolean, [key: string]: any}>}
 */
async function applyTagOperation(options) {
  const {
    dbPath, tableName, field, action, from = [], to = null,
    backupDir = null, allowExisting = false, dryRun = false
  } = options || {}

  if (!dbPath || !fs.existsSync(dbPath)) return { ok: false, code: 'db-missing', message: '找不到数据库文件' }
  if (!tableName || !field) return { ok: false, code: 'bad-args', message: '缺少表名或字段名' }
  if (!ACTIONS.includes(action)) return { ok: false, code: 'invalid-action', message: `未知的标签操作：${action}` }

  let db
  try {
    const Database = require('better-sqlite3')
    db = new Database(dbPath)

    const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(tableName)
    if (!exists) return { ok: false, code: 'table-missing', message: `数据表 ${tableName} 不存在` }

    const rows = db.prepare(`SELECT id, jsonData FROM "${tableName}"`).all()
    const records = []
    let skipped = 0
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.jsonData)
        if (parsed && typeof parsed === 'object') records.push({ ...parsed, id: row.id })
        else skipped++
      } catch {
        skipped++
      }
    }

    const plan = planTagOperation(records, { field, action, from, to })

    // dryRun（预览影响面）只统计、不校验：
    //   界面上"还没输入新名字"的时候也必须能显示"会影响 N 条"，
    //   否则会抛出一句莫名其妙的"新名字和原名一样/名字不能为空"。
    //   真正的合法性由执行时（下面这一步）与界面里的即时提示一起把关。
    if (!dryRun) {
      const check = validateTagOperation({
        action, from, to, inventory: plan.inventory, allowExisting
      })
      if (!check.ok) return { ...check, scanned: plan.scanned, inventorySize: plan.inventory.length }
    }

    if (plan.affected === 0) {
      return {
        ok: false,
        code: 'no-match',
        message: `没有任何记录在使用「${from.join('、')}」`,
        scanned: plan.scanned,
        affected: 0
      }
    }

    if (dryRun) {
      return { ok: true, dryRun: true, affected: plan.affected, scanned: plan.scanned, changes: plan.changes, backupPath: null }
    }

    // 先备份，再写库：顺序不能反
    let backupPath = null
    if (backupDir) {
      const payload = buildBackupPayload({ tableName, field, action, from, to, changes: plan.changes })
      backupPath = writeBackupFile(backupDir, payload)
    }

    const now = new Date().toISOString()
    const updateStmt = db.prepare(`UPDATE "${tableName}" SET jsonData = ?, timestamp = ? WHERE id = ?`)
    const rowCache = new Map(rows.map(row => [row.id, row]))
    const runAll = db.transaction(items => {
      for (const change of items) {
        const row = rowCache.get(change.id)
        if (!row) continue
        let parsed
        try { parsed = JSON.parse(row.jsonData) } catch { continue }
        parsed[field] = change.after
        updateStmt.run(JSON.stringify(parsed), now, change.id)
      }
    })
    runAll(plan.changes)

    if (backupDir) pruneBackups(backupDir)

    return {
      ok: true,
      affected: plan.affected,
      scanned: plan.scanned,
      skipped,
      backupPath,
      changes: plan.changes
    }
  } catch (error) {
    return { ok: false, code: 'db-error', message: error.message }
  } finally {
    try { if (db) db.close() } catch { /* 忽略 */ }
  }
}

/**
 * 撤销一次标签操作（按备份里的 id 还原 before 值）。
 *
 * 说明：只还原备份里记录的那些 id —— 如果主人在此之后又手动改过其中某条记录的同一字段，
 * 那条也会被改回旧值（所以返回里给了 `mismatched` 计数，界面会提示）。
 *
 * @param {object} options - `{ dbPath, backupPath, tableName }`
 * @returns {Promise<{ok: boolean, [key: string]: any}>}
 */
async function undoTagOperation(options) {
  const { dbPath, backupPath, tableName = null } = options || {}
  if (!dbPath || !fs.existsSync(dbPath)) return { ok: false, code: 'db-missing', message: '找不到数据库文件' }
  if (!backupPath || !fs.existsSync(backupPath)) return { ok: false, code: 'backup-missing', message: '找不到可撤销的备份' }

  let payload
  try {
    payload = JSON.parse(fs.readFileSync(backupPath, 'utf8'))
  } catch (error) {
    return { ok: false, code: 'backup-broken', message: `备份文件读不出来：${error.message}` }
  }
  const targetTable = payload.tableName || tableName
  const changes = Array.isArray(payload.changes) ? payload.changes : []
  if (!targetTable || changes.length === 0) {
    return { ok: false, code: 'backup-empty', message: '备份里没有可还原的记录' }
  }

  let db
  try {
    const Database = require('better-sqlite3')
    db = new Database(dbPath)
    const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(targetTable)
    if (!exists) return { ok: false, code: 'table-missing', message: `数据表 ${targetTable} 不存在` }

    const readStmt = db.prepare(`SELECT jsonData FROM "${targetTable}" WHERE id = ?`)
    const updateStmt = db.prepare(`UPDATE "${targetTable}" SET jsonData = ?, timestamp = ? WHERE id = ?`)
    const now = new Date().toISOString()
    let restored = 0
    let missing = 0
    let mismatched = 0
    const restoredChanges = []

    const runAll = db.transaction(items => {
      for (const change of items) {
        const row = readStmt.get(change.id)
        if (!row) { missing++; continue }
        let parsed
        try { parsed = JSON.parse(row.jsonData) } catch { missing++; continue }
        const current = readFieldValue(parsed, payload.field)
        if (JSON.stringify(current) !== JSON.stringify(change.after)) mismatched++
        parsed[payload.field] = change.before
        updateStmt.run(JSON.stringify(parsed), now, change.id)
        restoredChanges.push({ id: change.id, before: change.before, after: change.after })
        restored++
      }
    })
    runAll(changes)

    // 撤销成功后作废这份备份，避免重复撤销造成困惑
    try { fs.unlinkSync(backupPath) } catch { /* 忽略 */ }

    return {
      ok: true,
      restored,
      missing,
      mismatched,
      action: payload.action,
      field: payload.field,
      from: payload.from,
      to: payload.to,
      // 与"执行操作"同形的明细：渲染层统一用 changes + pick('before') 把界面改回去
      changes: restoredChanges
    }
  } catch (error) {
    return { ok: false, code: 'db-error', message: error.message }
  } finally {
    try { if (db) db.close() } catch { /* 忽略 */ }
  }
}

/** 备份目录绝对路径（存档目录下） */
function resolveBackupDir(saveDataDir) {
  if (!saveDataDir) return null
  return path.join(saveDataDir, BACKUP_DIR_NAME)
}

module.exports = {
  BACKUP_DIR_NAME,
  MAX_BACKUPS,
  BACKUP_FORMAT_VERSION,
  ACTIONS,
  readFieldValue,
  applyToValue,
  planTagOperation,
  validateTagOperation,
  buildBackupFileName,
  buildBackupPayload,
  ensureBackupDir,
  writeBackupFile,
  pruneBackups,
  listLatestBackup,
  resolveBackupDir,
  applyTagOperation,
  undoTagOperation
}
