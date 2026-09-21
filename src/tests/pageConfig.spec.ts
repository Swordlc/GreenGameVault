/**
 * 页面配置文件的一致性测试
 *
 * 配置是「查表」驱动的：JSON 里写错一个 id，代码不会报错，只会静默地不排序 / 丢页。
 * 所以这里把几条容易踩的约定钉死在测试里（对应 memory/project-ggv.md §6 的命名约定）。
 */
import { describe, it, expect } from 'vitest'
import gamePage from '../../configs/pages/gamePage.json'
import pageOrder from '../../configs/pages/pageOrder.json'

interface SortOption {
  id: string
  label: string
  field: string
  order: 'asc' | 'desc'
}

describe('gamePage.json', () => {
  const sortOptions = gamePage.sortOptions as SortOption[]

  it('默认排序是「最近游玩」（lastPlayed 降序）', () => {
    expect((gamePage as any).defaultSortBy).toBe('lastPlayed-desc')
  })

  it('defaultSortBy 必须是 sortOptions 里真实存在的 id，否则排序会静默失效', () => {
    const ids = sortOptions.map(option => option.id)
    expect(ids).toContain((gamePage as any).defaultSortBy)
  })

  it('lastPlayed-desc 这一项确实是「最后游玩时间」的降序（正在玩的排最前）', () => {
    const option = sortOptions.find(item => item.id === 'lastPlayed-desc')
    expect(option).toBeTruthy()
    expect(option!.field).toBe('lastPlayed')
    expect(option!.order).toBe('desc')
  })

  it('sortOptions 的 id 不重复', () => {
    const ids = sortOptions.map(option => option.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('filterConfig 里保留了标签筛选（主页抓阄的标签语义与它一致）', () => {
    const tagFilter = gamePage.filterConfig.find(item => item.key === 'tags')
    expect(tagFilter?.isArray).toBe(true)
    expect((tagFilter as any)?.params?.field).toBe('tags')
  })
})

describe('pageOrder.json', () => {
  it('挂了 gamePage.json，且文件名是小写开头驼峰（大小写敏感文件系统上的老坑）', () => {
    const files = (pageOrder as Array<{ fileName: string }>).map(item => item.fileName)
    expect(files).toContain('gamePage.json')
    for (const file of files) {
      expect(file[0]).toBe(file[0].toLowerCase())
    }
  })
})
