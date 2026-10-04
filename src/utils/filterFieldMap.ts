/**
 * 「按字段名」的标签候选列表
 *
 * 背景（主人 2026-10-04 报的小问题）：给视频打了 4 个标签后，编辑对话框右侧的
 * **作者**一栏里也冒出了那 4 个标签。
 *
 * 原因：`ResourcesEditDialog` 是按**资源字段名**取候选的（`availableTagsByField[fieldKey]`，
 * 如 `tags` / `author`），而页面筛选器的 **key 不一定等于字段名** ——
 * 视频页的「作者筛选」key 是 `authors`、字段却是 `author`（单数），
 * 于是对话框取不到作者候选，退化成"拿标签列表兜底"（`availableTags`），作者栏就被标签污染了。
 *
 * 这里统一补一份「按字段名索引」的映射，key 与字段名不一致也不会再静默退化成兜底数据。
 */

/** 只用到这几个字段，避免和完整类型耦合 */
export interface FilterConfigLike {
  key: string
  params?: any
  isArray?: boolean
}

/** 筛选器条目（与 `src/types/filter.ts` 的 FilterItem 同形） */
export interface FilterItemLike {
  name: string
  count?: number
}

/**
 * 把「按筛选器 key 索引的候选列表」补一份「按字段名索引」的
 * @param filterConfig 页面配置里的 filterConfig
 * @param itemsByFilterKey 各筛选器当前提取出的条目（key → items）
 * @returns 同时含「筛选器 key」与「字段名」两套键的映射
 */
export function buildTagsByField(
  filterConfig: FilterConfigLike[] | undefined,
  itemsByFilterKey: Record<string, FilterItemLike[]>
): Record<string, FilterItemLike[]> {
  const map: Record<string, FilterItemLike[]> = {}

  // 1) 按筛选器 key 放一份（保持原有用法）
  for (const [key, items] of Object.entries(itemsByFilterKey || {})) {
    map[key] = sanitizeItems(items)
  }

  // 2) 再按「字段名」放一份（key ≠ field 时这才是对话框真正要找的键）
  for (const config of filterConfig || []) {
    const field = config?.params?.field
    if (!field || typeof field !== 'string') continue
    // ① key 与字段名相同时，上面那份就是它，**不能再合并一次**（会把 count 翻倍）
    if (field === config.key) continue
    const items = itemsByFilterKey?.[config.key]
    if (!Array.isArray(items)) continue
    map[field] = mergeItems(map[field], sanitizeItems(items))
  }

  return map
}

/** 去掉脏条目（非对象 / 名字为空），其余原样保留（不改 count，避免和 mergeItems 语义混淆） */
function sanitizeItems(items: unknown): FilterItemLike[] {
  if (!Array.isArray(items)) return []
  return items.filter(
    (item): item is FilterItemLike =>
      !!item && typeof item === 'object' && typeof (item as FilterItemLike).name === 'string' && (item as FilterItemLike).name !== ''
  )
}

/**
 * 合并两个候选列表：按名字去重、count 相加、按名字排序。
 * （同一个字段被多个筛选器引用时的兜底，正常配置下用不到）
 */
function mergeItems(a: FilterItemLike[] | undefined, b: FilterItemLike[]): FilterItemLike[] {
  if (!Array.isArray(a) || a.length === 0) return [...b]

  const counter = new Map<string, number>()
  for (const item of [...a, ...b]) {
    if (!item || typeof item.name !== 'string' || item.name === '') continue
    counter.set(item.name, (counter.get(item.name) || 0) + (Number(item.count) || 0))
  }
  return Array.from(counter.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((x, y) => x.name.localeCompare(y.name, 'zh-CN'))
}
