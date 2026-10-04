/**
 * 页面配置文件的一致性测试
 *
 * 配置是「查表」驱动的：JSON 里写错一个 id，代码不会报错，只会静默地不排序 / 丢页。
 * 所以这里把几条容易踩的约定钉死在测试里（对应 memory/project-ggv.md §6 的命名约定）。
 */
import { describe, it, expect } from 'vitest'
import gamePage from '../../configs/pages/gamePage.json'
import videoPage from '../../configs/pages/videoPage.json'
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

describe('videoPage.json', () => {
  const sortOptions = videoPage.sortOptions as SortOption[]

  it('页面 id 与资源类型对得上（videos → resourceTypes: ["Video"]）', () => {
    expect(videoPage.id).toBe('videos')
    expect(videoPage.resourceTypes).toEqual(['Video'])
  })

  it('defaultSortBy 必须是 sortOptions 里真实存在的 id', () => {
    expect(sortOptions.map(option => option.id)).toContain((videoPage as any).defaultSortBy)
  })

  it('sortOptions 的 id 不重复', () => {
    const ids = sortOptions.map(option => option.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每个排序字段都必须是 Video 类上真实存在的字段（否则会静默不排序）', () => {
    const allowed = new Set([
      'name', 'author', 'watchCount', 'lastOpened', 'addedDate',
      'fileSize', 'durationSec', 'relPath'
    ])
    for (const option of sortOptions) {
      expect(allowed.has(option.field), `未知排序字段: ${option.field}`).toBe(true)
    }
  })

  it('保留标签筛选（与游戏页同一套语义）', () => {
    const tagFilter = videoPage.filterConfig.find(item => item.key === 'tags')
    expect(tagFilter?.isArray).toBe(true)
    expect((tagFilter as any)?.params?.field).toBe('tags')
  })

  it('保留「丢失的文件」筛选（文件改名/删除后要在左栏出现）', () => {
    const missing = videoPage.filterConfig.find(item => item.key === 'missing-resources')
    expect(missing).toBeTruthy()
    expect(missing?.filterType).toBe('missingResources')
  })

  it('工具栏提供「绑定文件夹」与「重新扫描」，且空状态按钮也指向绑定文件夹', () => {
    const actions = videoPage.toolbarConfig.items.map(item => (item as any).action).filter(Boolean)
    expect(actions).toContain('bindVideoFolder')
    expect(actions).toContain('rescanVideoLibrary')
    expect(videoPage.emptyStateConfig.buttonAction).toBe('bindVideoFolder')
  })

  it('工具栏里不能出现游戏页的「添加/批量导入/截图封面」动作（视频页是只读的）', () => {
    const actions = videoPage.toolbarConfig.items.map(item => (item as any).action).filter(Boolean)
    expect(actions).not.toContain('showAddDialog')
    expect(actions).not.toContain('showBatchImportDialog')
    expect(actions).not.toContain('batchLatestScreenshotCover')
  })

  it('对话框配置关掉了引擎检测与截图封面（游戏专属）', () => {
    expect((videoPage as any).dialogConfig.enableEngineAutoDetect).toBe(false)
    expect((videoPage as any).dialogConfig.enableScreenshotCover).toBe(false)
  })
})

describe('pageOrder.json', () => {
  it('挂了 gamePage.json 与 videoPage.json，且文件名是小写开头驼峰（大小写敏感文件系统上的老坑）', () => {
    const files = (pageOrder as Array<{ fileName: string }>).map(item => item.fileName)
    expect(files).toContain('gamePage.json')
    expect(files).toContain('videoPage.json')
    for (const file of files) {
      expect(file[0]).toBe(file[0].toLowerCase())
    }
  })

  it('order 不重复（导航排序靠它）', () => {
    const orders = (pageOrder as Array<{ order: number }>).map(item => item.order)
    expect(new Set(orders).size).toBe(orders.length)
  })
})
