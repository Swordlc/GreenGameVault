/**
 * 「按字段名」标签候选映射测试
 *
 * 背景（主人 2026-10-04 报的）：给视频打了 4 个标签后，编辑对话框右侧的**作者**栏里
 * 也显示了那 4 个标签 —— 因为对话框按**字段名**取候选（author），
 * 而筛选器的 key 是 `authors`，取不到就退化成"拿标签列表兜底"。
 */
import { describe, it, expect } from 'vitest'
import { buildTagsByField } from '../utils/filterFieldMap'
import videoPage from '../../configs/pages/videoPage.json'
import gamePage from '../../configs/pages/gamePage.json'

const tags = [
  { name: '3D', count: 1 },
  { name: '原神', count: 1 }
]

describe('buildTagsByField', () => {
  it('筛选器 key 与字段名不一致时，两套键都能取到（作者栏不再被标签污染）', () => {
    const map = buildTagsByField(
      [{ key: 'authors', params: { field: 'author' } }],
      { authors: [{ name: '某社团', count: 2 }], tags }
    )

    expect(map.authors).toEqual([{ name: '某社团', count: 2 }])
    expect(map.author).toEqual([{ name: '某社团', count: 2 }])
    expect(map.tags).toEqual(tags)
  })

  it('key === 字段名时不会重复或丢失', () => {
    const map = buildTagsByField([{ key: 'tags', params: { field: 'tags' } }], { tags })
    expect(map.tags).toEqual(tags)
    expect(Object.keys(map)).toEqual(['tags'])
  })

  it('没有 params.field 的筛选器（如「丢失的资源」）只按 key 放一份', () => {
    const map = buildTagsByField(
      [{ key: 'missing-resources', params: { missingLabel: '丢失的文件' } }],
      { 'missing-resources': [{ name: '丢失的文件', count: 3 }] }
    )
    expect(Object.keys(map)).toEqual(['missing-resources'])
  })

  it('字段在数据里为空（比如还没填过作者）→ 该字段映射为空数组，而不是"没有这个键"', () => {
    const map = buildTagsByField([{ key: 'author', params: { field: 'author' } }], { author: [] })
    expect(Object.prototype.hasOwnProperty.call(map, 'author')).toBe(true)
    expect(map.author).toEqual([])
  })

  it('同一个字段被多个筛选器引用时按名字合并、count 相加', () => {
    const map = buildTagsByField(
      [
        { key: 'tags', params: { field: 'tags' } },
        { key: 'tagsBackup', params: { field: 'tags' } }
      ],
      { tags: [{ name: 'A', count: 1 }], tagsBackup: [{ name: 'A', count: 2 }, { name: 'B', count: 1 }] }
    )
    expect(map.tags).toEqual([{ name: 'A', count: 3 }, { name: 'B', count: 1 }])
  })

  it('脏数据不炸（undefined / 非数组 / 空名字都被剔除）', () => {
    expect(buildTagsByField(undefined, {} as any)).toEqual({})
    const map = buildTagsByField(
      [{ key: 'tags', params: { field: 'tags' } }],
      { tags: [{ name: '', count: 1 }, null as any, { name: 'ok', count: 2 }] as any }
    )
    expect(map.tags).toEqual([{ name: 'ok', count: 2 }])
  })
})

describe('页面配置的筛选器字段名可达性', () => {
  const fieldFilters = (page: any) =>
    (page.filterConfig || []).filter((item: any) => item.filterType === 'resourceField')

  /** 模拟 GenericResourceView：每个筛选器都有条目 */
  const itemsOf = (page: any) => {
    const map: Record<string, any[]> = {}
    for (const filter of page.filterConfig || []) map[filter.key] = [{ name: `${filter.key}-值`, count: 1 }]
    return map
  }

  /**
   * 这条才是真正的契约：编辑对话框是按**字段名**取候选的
   * （`availableTagsByField[fieldKey]`，如 author / tags / publisher），
   * 取不到就会退化成"拿标签列表兜底" —— 主人报的"作者栏里冒出标签"就是这么来的。
   */
  it('视频页：每个字段名都能取到候选', () => {
    const page = videoPage
    const map = buildTagsByField(page.filterConfig, itemsOf(page))
    for (const filter of fieldFilters(page)) {
      expect(Array.isArray(map[filter.params.field]), `${filter.key} → 字段 ${filter.params.field} 取不到候选`).toBe(true)
    }
  })

  it('游戏页：每个字段名都能取到候选（publishers 的字段是 publisher，也照样可达）', () => {
    const page = gamePage
    const map = buildTagsByField(page.filterConfig, itemsOf(page))
    for (const filter of fieldFilters(page)) {
      expect(Array.isArray(map[filter.params.field]), `${filter.key} → 字段 ${filter.params.field} 取不到候选`).toBe(true)
    }
  })

  it('视频页的作者筛选 key 与字段名已统一（key=author=field）', () => {
    const authorFilter = (videoPage.filterConfig || []).find((item: any) => item.params?.field === 'author')
    expect(authorFilter?.key).toBe('author')
  })
})

