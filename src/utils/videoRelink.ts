/**
 * 「整夹重新关联」用到的纯逻辑（可单测）
 *
 * 背景（主人 2026-10-05 反馈）：
 *   把一个子文件夹改名后，库里那批记录全被标成「丢失」，
 *   同时扫描又照着新路径**新建**了一批记录 —— 于是同一批文件在库里有两份：
 *   旧的那份带着标签/打开次数但"文件不存在"，新的那份干干净净但没有标签。
 *
 * 回收站里「整个文件夹重新关联到…」要做两件事：
 *   1. 把旧记录按**内层相对路径**对号入座到新文件夹（`planFolderRelink`）；
 *   2. 如果目标路径上已经有一条扫描新建的记录，就把它**合并**进来再删掉，
 *      免得库里出现两条指向同一文件的记录（`mergeVideoRecords`）。
 */

/** 取 ResourceField / 普通值 */
export function fieldValue(field: any): any {
  if (field && typeof field === 'object' && 'value' in field) return field.value
  return field
}

/** 写 ResourceField / 普通值 */
export function setField(item: any, key: string, value: any): void {
  if (!item) return
  const current = item[key]
  if (current && typeof current === 'object' && 'value' in current) {
    current.value = value
  } else {
    item[key] = value
  }
}

/** 这条记录是不是「文件已丢失」 */
export function isMissingItem(item: any): boolean {
  return fieldValue(item?.fileExists) === false
}

/** 取相对路径所在目录（'A/b/x.mp4' → 'A/b'；根下 → ''） */
export function parentFolderOf(relPath: unknown): string {
  const rel = String(relPath ?? '').replace(/\\/g, '/')
  const index = rel.lastIndexOf('/')
  return index > 0 ? rel.slice(0, index) : ''
}

/**
 * 取「相对某个文件夹」的内层相对路径。
 * 不在该文件夹下时返回 ''。
 */
export function innerRelativeOf(folderRel: unknown, relPath: unknown): string {
  const folder = String(folderRel ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const rel = String(relPath ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!rel) return ''
  if (!folder) return rel
  if (rel === folder) return ''
  if (!rel.startsWith(folder + '/')) return ''
  return rel.slice(folder.length + 1)
}

export interface FolderRelinkPlanEntry {
  item: any
  id: string
  /** 相对「丢失文件夹」的内层路径（主进程据此拼新路径） */
  innerRel: string
  /** 文件名（首选路径不存在时，主进程会退一步试 <新夹>/<文件名>） */
  fileName: string
}

/**
 * 把「丢失文件夹」子树里的记录整理成批量重连的入参。
 * @param items 候选记录（一般是回收站里当前这批丢失记录）
 * @param folderRel 丢失文件夹相对根目录的路径（'' 表示根目录层）
 */
export function planFolderRelink(items: any[], folderRel: string): FolderRelinkPlanEntry[] {
  const folder = String(folderRel ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const plan: FolderRelinkPlanEntry[] = []

  for (const item of items || []) {
    const relPath = String(fieldValue(item?.relPath) || '')
    const innerRel = innerRelativeOf(folder, relPath)
    if (!innerRel) continue // 不在这棵子树里（或就是这个目录本身）
    const id = String(fieldValue(item?.id) || '')
    if (!id) continue
    plan.push({
      item,
      id,
      innerRel,
      fileName: String(fieldValue(item?.fileName) || '')
    })
  }

  return plan
}

/** 数组字段并集（去重 + 稳定：先来的先留） */
function unionArrays(a: unknown, b: unknown): string[] {
  const result: string[] = []
  for (const list of [a, b]) {
    if (!Array.isArray(list)) continue
    for (const value of list) {
      const text = String(value ?? '')
      if (text && !result.includes(text)) result.push(text)
    }
  }
  return result
}

/** 取两个 ISO 时间里更早的那个 */
function earlierIso(a: unknown, b: unknown): string {
  const left = String(a ?? '')
  const right = String(b ?? '')
  if (!left) return right
  if (!right) return left
  return left <= right ? left : right
}

/**
 * 把 `source`（通常是扫描按新路径新建的"空壳"记录）合并进 `target`（带标签的旧记录）。
 *
 * 规则：**用户数据只增不减** —— 标签/作者取并集，打开次数求和，访问记录取并集；
 * 路径相关字段一概不动（由调用方在合并后写入新路径）。
 * 合并完成后调用方应当把 source 从库里删掉，避免同一文件两条记录。
 */
export function mergeVideoRecords(target: any, source: any): void {
  if (!target || !source || target === source) return

  setField(target, 'tags', unionArrays(fieldValue(target.tags), fieldValue(source.tags)))
  setField(target, 'author', unionArrays(fieldValue(target.author), fieldValue(source.author)))

  if (!fieldValue(target.name)) setField(target, 'name', fieldValue(source.name) || '')
  if (!fieldValue(target.description)) setField(target, 'description', fieldValue(source.description) || '')

  const watchCount = Number(fieldValue(target.watchCount) || 0) + Number(fieldValue(source.watchCount) || 0)
  setField(target, 'watchCount', watchCount)

  const sessions = unionArrays(fieldValue(target.visitedSessions), fieldValue(source.visitedSessions))
  sessions.sort()
  setField(target, 'visitedSessions', sessions)

  setField(
    target,
    'lastAccessSeenMs',
    Math.max(Number(fieldValue(target.lastAccessSeenMs) || 0), Number(fieldValue(source.lastAccessSeenMs) || 0))
  )
  setField(target, 'coverUpdatedAt', Math.max(Number(fieldValue(target.coverUpdatedAt) || 0), Number(fieldValue(source.coverUpdatedAt) || 0)))

  if (!fieldValue(target.coverPath)) setField(target, 'coverPath', fieldValue(source.coverPath) || '')
  if (!Number(fieldValue(target.lastFrameTime) || 0)) setField(target, 'lastFrameTime', Number(fieldValue(source.lastFrameTime) || 0))
  if (!Number(fieldValue(target.durationSec) || 0)) setField(target, 'durationSec', Number(fieldValue(source.durationSec) || 0))
  if (!fieldValue(target.addedDate)) setField(target, 'addedDate', fieldValue(source.addedDate) || '')
  else setField(target, 'addedDate', earlierIso(fieldValue(target.addedDate), fieldValue(source.addedDate)))
  if (!fieldValue(target.resourceType)) setField(target, 'resourceType', fieldValue(source.resourceType) || 'video')

  if (!fieldValue(target.rating)) setField(target, 'rating', fieldValue(source.rating) || 0)
  if (!fieldValue(target.comment)) setField(target, 'comment', fieldValue(source.comment) || '')
  if (!fieldValue(target.isFavorite)) setField(target, 'isFavorite', fieldValue(source.isFavorite) || false)
}

/**
 * 把主进程算好的重连结果写进记录（只写路径相关字段 + 文件存在标记）。
 * @param item 目标记录
 * @param resolved 主进程 `video-relink` / `video-relink-batch` 返回的单条结果
 */
export function applyRelinkResult(item: any, resolved: any): void {
  if (!item || !resolved?.ok) return
  setField(item, 'resourcePath', resolved.path || resolved.filePath || fieldValue(item.resourcePath) || '')
  if (resolved.rootPath !== undefined) setField(item, 'rootPath', resolved.rootPath || '')
  if (resolved.relPath !== undefined) setField(item, 'relPath', resolved.relPath || '')
  if (resolved.fileName !== undefined) setField(item, 'fileName', resolved.fileName || '')
  if (resolved.size !== undefined) setField(item, 'fileSize', Number(resolved.size) || 0)
  setField(item, 'fileExists', true)
  // 重新关联是我们"刚刚动过这个文件"，把基线顶到现在
  setField(item, 'lastAccessSeenMs', Date.now())
}
