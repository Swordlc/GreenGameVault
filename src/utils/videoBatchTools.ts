/**
 * 视频页「多选批量」两个新工具的**纯逻辑**（主人 2026-10-10 需求）：
 *
 *   1. 把标签下选中的一批视频**加入 PotPlayer 播放列表**（写 `.dpl` 交给 PotPlayer）；
 *   2. 把选中的一批视频**复制到剪贴板**（等同在资源管理器按 Ctrl+C，
 *      主人自己去网盘客户端/目标文件夹 Ctrl+V 粘贴，GGV 不碰文件本体）。
 *
 * 这里只放"能拿数据喂出来、能单测"的部分：路径提取、全选范围、命名依据、提示文案。
 * 真正的文件操作全在主进程（`electron/services/potplayer-playlist.js` /
 * `clipboard-files.js`），本文件不碰 fs，也不碰 window。
 */

/** 统一的多选条目形状（视频页的 item 就是这个样子，字段可能是 ResourceField 也可能是裸值） */
export interface BatchToolEntry {
  id?: any
  resourcePath?: any
  [key: string]: any
}

/** 提示条（与 utils/NotificationService.ts 的 toast 参数一致） */
export interface BatchToolToast {
  type: 'success' | 'warning' | 'error'
  title: string
  message: string
}

/**
 * 取字段的裸值：视频页的记录是 `ResourceField`（`.value`），测试里常常给裸值。
 * 两边都认，避免调用方各写一套。
 */
function rawValue(field: any): any {
  if (field && typeof field === 'object' && 'value' in field) return field.value
  return field
}

/**
 * 从条目里取出视频文件的绝对路径。
 * 没有 `resourcePath` 的记录（解绑目录、扫描异常）直接跳过 —— 交给主进程也是白搭。
 *
 * @param entries
 * @returns 去重后的绝对路径
 */
export function extractVideoFilePaths(entries: BatchToolEntry[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const entry of Array.isArray(entries) ? entries : []) {
    const filePath = String(rawValue(entry?.resourcePath) || '').trim()
    if (!filePath || seen.has(filePath)) continue
    seen.add(filePath)
    out.push(filePath)
  }
  return out
}

/**
 * 「全选当前筛选结果」要选哪些条目。
 *
 * 口径（主人 2026-10-10 定）：**当前筛选/搜索命中的全部**（跨分页），
 * 但**排除丢失的记录** —— 那些文件在磁盘上已经没有了，加进播放列表只会得到打不开的条目，
 * 复制更是不可能。回收站模式下因此全选为空，UI 要如实提示而不是假装选中。
 *
 * @param entries 当前筛选结果（`filteredItems`）
 * @param isMissing 判定"记录丢失"的函数（页面传入 isMissingItem）
 */
export function pickSelectableEntries(
  entries: BatchToolEntry[],
  isMissing: (entry: any) => boolean = () => false
): BatchToolEntry[] {
  return (Array.isArray(entries) ? entries : []).filter(entry => {
    try {
      return !isMissing(entry)
    } catch (_) {
      return true
    }
  })
}

/**
 * 具名播放列表的命名依据。
 *
 * 主人定的默认：**自动用标签名**（`GGV-拔作.dpl`）；多个标签时主进程会收成
 * `GGV-拔作等3个.dpl`；一个标签都没有（纯搜索 / 什么都没筛）时用兜底词。
 *
 * @param tagFilter 左栏标签筛选状态（include = 选中的标签）
 * @param searchQuery 页面搜索词
 */
export function resolvePlaylistNaming(
  tagFilter: { include?: string[] } | null | undefined,
  searchQuery: string
): { tagNames: string[], fallbackName: string } {
  const tagNames = (Array.isArray(tagFilter?.include) ? tagFilter!.include : [])
    .map(tag => String(tag || '').trim())
    .filter(Boolean)

  const query = String(searchQuery || '').trim()
  let fallbackName = '全部视频'
  if (tagNames.length === 0 && query) fallbackName = `搜索-${query}`

  return { tagNames, fallbackName }
}

/**
 * 「加入 PotPlayer 播放列表」的结果 → 提示文案。
 * 主进程返回什么就说什么，**不美化**：没交给 PotPlayer 就说没交给，跳过了几个就说几个。
 */
export function describePotPlayerNamedResult(result: any): BatchToolToast {
  if (!result || result.ok !== true) {
    return { type: 'error', title: '加入播放列表失败', message: String(result?.message || '未知错误') }
  }

  const count = Number(result.count) || 0
  const fileName = String(result.fileName || '播放列表')
  const parts: string[] = []

  if (result.opened) {
    parts.push(`${count} 个视频已写入 ${fileName}，并已交给 PotPlayer`)
    parts.push('它们被追加到 PotPlayer 当前播放列表的末尾')
  } else {
    parts.push(`${count} 个视频已写入 ${fileName}`)
    if (result.path) parts.push(`位置：${result.path}`)
    parts.push('在 PotPlayer 的播放列表里打开它即可')
  }
  if (Number(result.missingCount) > 0) parts.push(`跳过 ${result.missingCount} 个磁盘上已不存在的文件`)
  if (result.openMessage) parts.push(String(result.openMessage))

  return { type: 'success', title: '已生成 PotPlayer 播放列表', message: parts.join('；') }
}

/**
 * 「复制文件到剪贴板」的结果 → 提示文案。
 * 成功时必须明确告诉主人**下一步去哪按 Ctrl+V** —— 这正是这个功能存在的意义。
 */
export function describeClipboardResult(result: any): BatchToolToast {
  if (!result || result.ok !== true) {
    return { type: 'error', title: '复制失败', message: String(result?.message || '未知错误') }
  }

  const count = Number(result.count) || 0
  const skipped = Array.isArray(result.missing) ? result.missing.length : 0
  const parts = [`已把 ${count} 个视频放进剪贴板，去目标文件夹（或网盘客户端）按 Ctrl+V 粘贴即可`]
  parts.push('文件的复制粘贴由资源管理器完成，GGV 没有改动任何文件')
  if (skipped > 0) parts.push(`跳过 ${skipped} 个磁盘上已不存在的文件`)

  return { type: 'success', title: '已复制文件', message: parts.join('；') }
}
