/**
 * 视频页「标签格式刷」的纯逻辑
 *
 * 语义：从一张卡上**复制**标签 + 作者（取色），再**粘贴**到 1 张或多张卡上（上色）。
 *
 * 为什么单独抽成模块：
 *   合并与覆盖的差别很大 —— 覆盖会**清掉目标原有的标签**，属于不可撤销操作。
 *   这种"算错就会毁数据"的判断必须能单测，所以这里只做纯计算，
 *   弹确认框、落库、提示都留给调用方（见 GenericResourceView.vue）。
 *
 * 兼容两种字段形态：`ResourceField` 包装（`.value`）与裸属性。
 *   ⚠️ 读取时 `item.tags?.value ?? item.tags` 是必须的：
 *      视频页的 items 是 `reactive(new Video())`，字段都在 `.value` 里；
 *      但从 DB/JSON 复原的普通对象上没有 `.value`。两个入口都不能踩空。
 */

/** 一份「格式」：标签与作者 */
export interface TagFormatSnapshot {
  tags: string[]
  author: string[]
}

/** 粘贴方式：merge = 并集（不动目标原有的）；overwrite = 整片覆盖（清掉目标原有的） */
export type TagFormatPasteMode = 'merge' | 'overwrite'

/**
 * 把任意形态的字段值规范化成「去空白 + 去重」的字符串数组。
 * 非数组的标量会被当成单元素数组；空值得到空数组。
 */
export function normalizeFormatList(value: unknown): string[] {
  const raw = unwrapFieldValue(value)
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : (raw === undefined || raw === null || raw === '' ? [] : [raw])

  const out: string[] = []
  for (const entry of list) {
    const text = String(entry ?? '').trim()
    if (text && !out.includes(text)) out.push(text)
  }
  return out
}

/** 取出 ResourceField 的 `.value`；不是包装就原样返回 */
function unwrapFieldValue(value: unknown): unknown {
  if (value && typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
    return (value as { value: unknown }).value
  }
  return value
}

/**
 * 从一条记录里读出标签 + 作者
 * @returns 两者都为空时返回 null（表示"这张卡没东西可当格式刷"）
 */
export function readTagFormat(item: any): TagFormatSnapshot | null {
  if (!item) return null
  const tags = normalizeFormatList(item.tags?.value ?? item.tags)
  const author = normalizeFormatList(item.author?.value ?? item.author)
  if (tags.length === 0 && author.length === 0) return null
  return { tags, author }
}

/** 两个数组是否完全一致（含顺序） */
export function isSameList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((entry, index) => entry === b[index])
}

/**
 * 算出粘贴后的字段值
 * @param current 目标当前的标签/作者
 * @param clip 刷子上的标签/作者
 * @param mode merge = 并集 | overwrite = 覆盖
 * @returns `changed` 为 false 表示目标本来就是这个样子，调用方可以跳过不落库
 */
export function computeTagFormatPaste(
  current: TagFormatSnapshot,
  clip: TagFormatSnapshot,
  mode: TagFormatPasteMode
): { tags: string[]; author: string[]; changed: boolean } {
  const tags = mode === 'overwrite'
    ? [...clip.tags]
    : [...new Set([...current.tags, ...clip.tags])]
  const author = mode === 'overwrite'
    ? [...clip.author]
    : [...new Set([...current.author, ...clip.author])]

  const changed = !(isSameList(tags, current.tags) && isSameList(author, current.author))
  return { tags, author, changed }
}

/**
 * 把一个字段写回去（ResourceField 包装写 `.value`，裸属性直接赋值）
 *
 * ⚠️ 必须走 `.value`：直接给 ResourceField 对象整体赋值会打断响应式链
 *    （卡片不会刷新，用户会以为"粘贴没生效"）。
 */
export function writeFormatField(item: any, key: 'tags' | 'author', value: string[]): void {
  if (!item) return
  const field = item[key]
  if (field && typeof field === 'object' && 'value' in field) {
    field.value = value
  } else {
    item[key] = value
  }
}

/** 从记录里读出一个字段的当前值（与 writeFormatField 对称） */
export function readFormatField(item: any, key: 'tags' | 'author'): string[] {
  if (!item) return []
  return normalizeFormatList(item[key]?.value ?? item[key])
}
