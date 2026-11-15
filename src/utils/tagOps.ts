/**
 * 标签编辑（重命名 / 合并 / 移除）的渲染层纯逻辑。
 *
 * 分工：
 *   - 后端 `electron/services/tag-ops.js` 负责**改库**（并给出改了哪些 id、改前改后是什么）；
 *   - 这里负责**改界面内存里的那份数据**：把后端返回的 changes 应用到当前页的 items、
 *     把筛选器里正在选中的名字一起改掉（否则改完名会发现"筛选着 3D，列表却空了"）、
 *     以及生成给人看的文案。
 *
 * 全部是纯函数，方便单测（见 src/tests/tagOps.spec.ts）。
 */

/** 一个字段的变化明细（与后端 changes 同形） */
export interface TagChange {
  id: string
  before: any
  after: any
}

/** 标签操作动作 */
export type TagOpAction = 'rename' | 'merge' | 'remove'

/** 后端 applyTagOperation 的返回（只列用得到的字段） */
export interface TagOpResult {
  ok: boolean
  code?: string
  message?: string
  affected?: number
  scanned?: number
  skipped?: number
  backupPath?: string | null
  changes?: TagChange[]
}

/** 最近一次可撤销操作（左栏「撤销」入口） */
export interface TagOpBackupInfo {
  path: string
  fileName?: string
  createdAt?: string | null
  action: TagOpAction
  field: string
  from: string[]
  to: string | null
  affected: number
  tableName?: string
}

/**
 * 这些字段是**算出来**的，库里并不存在 → 不给「编辑」入口。
 * 例如视频页的「格式筛选」字段是 `ext`（从文件名临时推的），
 * 对它做重命名/移除只会"什么都不发生"，那才是骗人。
 */
export const NON_EDITABLE_TAG_FIELDS = new Set(['ext', 'fileExists', 'folderSize', 'missingResources'])

/** 动作的中文名 */
export const TAG_OP_LABELS: Record<TagOpAction, string> = {
  rename: '重命名',
  merge: '合并',
  remove: '移除'
}

/**
 * 判断一个筛选器分区能不能做标签编辑，并取出它背后的字段信息。
 *
 * 只有 `filterType === 'resourceField'` 且字段真实入库的分区才可编辑；
 * 「丢失的资源」「正在游玩」这类是运行时算出来的，直接排除。
 */
export function resolveTagFieldMeta(config: any): {
  editable: boolean
  field: string | null
  resourceType: string | null
  isArray: boolean
} {
  const field = config?.params?.field ? String(config.params.field) : null
  const resourceType = config?.params?.resource ? String(config.params.resource) : null
  const isArray = config?.isArray === true
  const editable = config?.filterType === 'resourceField'
    && !!field
    && !!resourceType
    && !NON_EDITABLE_TAG_FIELDS.has(field)
  return { editable, field, resourceType, isArray }
}

/** 读取条目上某字段的真实值（兼容 ResourceField 包装 / 纯值） */
export function readItemFieldValue(item: any, field: string): any {
  const raw = item == null ? undefined : item[field]
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw) return raw.value
  return raw
}

/**
 * 把值写回条目（保留 ResourceField 包装，只改 `.value`）。
 * @returns 是否写成功
 */
export function writeItemFieldValue(item: any, field: string, value: any): boolean {
  if (!item || typeof item !== 'object') return false
  const raw = item[field]
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw) {
    raw.value = value
    return true
  }
  item[field] = value
  return true
}

/** 取条目的 id（同样兼容 ResourceField 包装） */
export function readItemId(item: any): string | null {
  const value = readItemFieldValue(item, 'id')
  if (value == null) return null
  return String(value)
}

/**
 * 把后端返回的变化明细压成 `id → 值` 的映射。
 * @param changes 后端 changes
 * @param pick 取 `after`（执行操作后）还是 `before`（撤销回滚时用）
 */
export function changesToValueMap(changes: TagChange[], pick: 'before' | 'after' = 'after'): Map<string, any> {
  const map = new Map<string, any>()
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || change.id == null) continue
    map.set(String(change.id), pick === 'before' ? change.before : change.after)
  }
  return map
}

/**
 * 把「id → 新值」应用到当前页的内存数据上。
 *
 * 只认 id 命中的条目 —— 后端改的是全库，没显示在当前页的那些记录不在这里，
 * 也不该在这里被凭空造出来。
 *
 * @returns 实际改到的条数
 */
export function applyTagValuesToItems(items: any[], field: string, values: Map<string, any>): number {
  if (!Array.isArray(items) || !(values instanceof Map) || values.size === 0) return 0
  let touched = 0
  for (const item of items) {
    const id = readItemId(item)
    if (!id || !values.has(id)) continue
    if (writeItemFieldValue(item, field, values.get(id))) touched++
  }
  return touched
}

/**
 * 便捷入口：直接把后端 changes 应用到内存数据（默认取 after = 操作后的值）。
 * @returns 实际改到的条数
 */
export function applyTagChangesToItems(items: any[], field: string, changes: TagChange[]): number {
  return applyTagValuesToItems(items, field, changesToValueMap(changes, 'after'))
}

/**
 * 改写筛选器里正在选中的名字。
 *
 * 场景：主人正筛选着「3D」，然后把「3D」重命名成「3D动画」——
 * 如果不跟着改，筛选条件就指向了一个已经不存在的标签，列表会莫名其妙变空。
 */
export function rewriteFilterSelection(
  selected: string[],
  excluded: string[],
  op: { action: TagOpAction; from: string[]; to?: string | null }
): { selected: string[]; excluded: string[] } {
  const fromSet = new Set(op.from || [])
  const rewrite = (list: string[]): string[] => {
    const out: string[] = []
    for (const name of Array.isArray(list) ? list : []) {
      if (op.action === 'remove') {
        if (fromSet.has(name)) continue
        out.push(name)
        continue
      }
      const next = fromSet.has(name) ? String(op.to ?? name) : name
      if (!out.includes(next)) out.push(next)
    }
    return out
  }
  return { selected: rewrite(selected), excluded: rewrite(excluded) }
}

/**
 * 合并弹窗里算"这次合并会影响多少"的**界面侧预估**（按当前页数据，实时显示用）。
 * 同一条记录同时挂了 A 和 B 也只算一次（因为合并后它只留下一个 C）。
 * 真正的影响面以后端为准（后端算的是全库）。
 */
export function estimateMergeAffected(
  items: any[],
  field: string,
  from: string[]
): number {
  if (!Array.isArray(items) || from.length === 0) return 0
  const fromSet = new Set(from)
  let count = 0
  for (const item of items) {
    const value = readItemFieldValue(item, field)
    if (Array.isArray(value)) {
      if (value.some(v => fromSet.has(typeof v === 'string' ? v : String(v)))) count++
    } else if (value != null && value !== '' && fromSet.has(String(value))) {
      count++
    }
  }
  return count
}

/** 结果文案：给 toast 用 */
export function describeTagOpResult(
  action: TagOpAction,
  from: string[],
  to: string | null,
  result: TagOpResult,
  options: { pageTouched?: number; hasBackup?: boolean } = {}
): string {
  const affected = Number(result?.affected) || 0
  const fromText = (from || []).map(name => `「${name}」`).join('、')
  const toText = to ? `「${to}」` : ''
  let head: string
  if (action === 'rename') head = `已把 ${fromText} 重命名为 ${toText}`
  else if (action === 'merge') head = `已把 ${fromText} 合并为 ${toText}`
  else head = `已移除标签 ${fromText}`

  const parts = [`${head}，影响 ${affected} 条记录`]
  const pageTouched = Number(options.pageTouched) || 0
  if (pageTouched > 0 && pageTouched !== affected) {
    parts.push(`（当前页显示 ${pageTouched} 条）`)
  }
  if (options.hasBackup) parts.push('已备份，可在左栏撤销')
  return parts.join('')
}

/** 后端错误码 → 人话 */
export function describeTagOpError(result: TagOpResult): string {
  const code = result?.code
  const fallback = result?.message || '操作失败'
  switch (code) {
    case 'duplicate':
      return result?.message || '已经存在同名的标签，请改用「合并标签」'
    case 'no-match':
      return result?.message || '没有记录在使用这个标签'
    case 'unchanged':
      return result?.message || '新名字和原名一样'
    case 'empty-name':
      return result?.message || '新标签名不能为空'
    case 'backup-missing':
      return result?.message || '没有可撤销的标签操作'
    default:
      return fallback
  }
}

/** 撤销结果文案 */
export function describeUndoResult(result: any): string {
  if (!result?.ok) return describeTagOpError(result || {})
  const parts = [`已撤销：还原 ${result.restored || 0} 条记录`]
  if (result.missing) parts.push(`（${result.missing} 条已不存在，跳过）`)
  if (result.mismatched) parts.push(`（其中 ${result.mismatched} 条在撤销前已被手动改过，一并还原）`)
  return parts.join('')
}

/** 左栏「撤销」入口的文案：`撤销：重命名「A」→「B」（913 条）` */
export function formatUndoLabel(backup: TagOpBackupInfo | null): string | null {
  if (!backup || !backup.action) return null
  const label = TAG_OP_LABELS[backup.action] || backup.action
  const fromText = (backup.from || []).map(name => `「${name}」`).join('、')
  const toText = backup.to ? `→「${backup.to}」` : ''
  return `撤销：${label}${fromText}${toText}（${backup.affected || 0} 条）`
}
