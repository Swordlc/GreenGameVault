/**
 * 视频「文件夹」在标签筛选 / 搜索下的可见性测试
 *
 * 主人 2026-10-04 的需求：
 *   「文件夹拥有其内视频标签的并集；这样在筛选条件下仍能显示文件夹」
 *
 * 主人 2026-10-05 修正口径（第 1 个问题）：
 *   「当文件夹内部只有子文件夹时（嵌套层级），左侧筛选显示空」——
 *   所以并集与搜索命中判定都改成按**子树**（含更深层级），不再只看直接子级。
 */
import { describe, it, expect } from 'vitest'
import {
  collectFolderTags,
  filterVisibleFolders,
  folderContainsVideo,
  folderNameMatches,
  isFolderVisible,
  normalizeFolderPath,
  satisfiesFolderTagFilter,
  type FolderLike
} from '../utils/videoFolderFilter'

const ROOT = 'D:\\Videos'

function makeFolder(overrides: Partial<FolderLike> = {}): FolderLike {
  return {
    key: 'folder:1',
    name: '子目录A',
    kind: 'folder',
    root: ROOT,
    rel: '子目录A',
    fullPath: `${ROOT}\\子目录A`,
    tags: [],
    ...overrides
  }
}

/** 假的视频条目：{ rootPath, relPath, tags } */
function makeVideo(rootPath: string, relPath: string, tags: string[] = []) {
  return { rootPath, relPath, tags }
}

const folderPathOf = (v: any) => {
  const rel = String(v.relPath || '')
  const i = rel.lastIndexOf('\\')
  return i > 0 ? rel.slice(0, i) : ''
}
const rootOf = (v: any) => String(v.rootPath || '')
const tagsOf = (v: any) => v.tags || []

describe('satisfiesFolderTagFilter（并集语义）', () => {
  it('没有筛选时一律通过', () => {
    expect(satisfiesFolderTagFilter([], { include: [], exclude: [] })).toBe(true)
    expect(satisfiesFolderTagFilter(['3D作品'], { include: [], exclude: [] })).toBe(true)
  })

  it('include：每个被选标签都要在并集里（可以来自不同视频）', () => {
    const tags = ['3D作品', '2D作品', '像素风']
    expect(satisfiesFolderTagFilter(tags, { include: ['3D作品'], exclude: [] })).toBe(true)
    expect(satisfiesFolderTagFilter(tags, { include: ['3D作品', '像素风'], exclude: [] })).toBe(true)
    expect(satisfiesFolderTagFilter(tags, { include: ['3D作品', '不存在'], exclude: [] })).toBe(false)
  })

  it('exclude：并集里出现任何一个被排除标签就隐藏', () => {
    const tags = ['3D作品', '像素风']
    expect(satisfiesFolderTagFilter(tags, { include: [], exclude: ['像素风'] })).toBe(false)
    expect(satisfiesFolderTagFilter(tags, { include: [], exclude: ['别的'] })).toBe(true)
  })

  it('include 与 exclude 同时存在时都要满足', () => {
    const tags = ['3D作品', '2D作品']
    expect(satisfiesFolderTagFilter(tags, { include: ['3D作品'], exclude: ['2D作品'] })).toBe(false)
    expect(satisfiesFolderTagFilter(tags, { include: ['3D作品'], exclude: ['像素风'] })).toBe(true)
  })
})

describe('collectFolderTags（子树：含自身与所有下级）', () => {
  const videos = [
    makeVideo(ROOT, '根下的.mp4', ['根标签']),
    makeVideo(ROOT, '子目录A\\a1.mp4', ['3D作品', '收藏']),
    makeVideo(ROOT, '子目录A\\a2.mp4', ['2D作品']),
    // 更深一层：**要**算进「子目录A」的并集（嵌套层级的口径）
    makeVideo(ROOT, '子目录A\\深层B\\b1.mp4', ['深层标签']),
    // 兄弟目录：不该算
    makeVideo(ROOT, '子目录C\\c1.mp4', ['另一个标签'])
  ]

  it('folder 卡片：并集整棵子树（含更深层级）的标签', () => {
    const tags = collectFolderTags(videos, makeFolder(), folderPathOf, rootOf, tagsOf)
    expect(tags).toEqual(['2D作品', '3D作品', '深层标签', '收藏'].sort((a, b) => a.localeCompare(b, 'zh-CN')))
    expect(tags).not.toContain('根标签')
    expect(tags).not.toContain('另一个标签')
  })

  it('root 卡片：并集整个根目录下的标签（含所有子文件夹）', () => {
    const rootCard = makeFolder({ kind: 'root', name: ROOT, rel: '', fullPath: ROOT })
    const tags = collectFolderTags(videos, rootCard, folderPathOf, rootOf, tagsOf)
    // 兄弟目录 子目录C 也在同一个根下，所以「另一个标签」也要算进来
    expect(tags).toEqual(
      ['2D作品', '3D作品', '深层标签', '根标签', '收藏', '另一个标签'].sort((a, b) => a.localeCompare(b, 'zh-CN'))
    )
  })

  it('「只有子文件夹、视频全在更深处」的目录也有标签（主人报的那个空左栏）', () => {
    const nested = [makeVideo(ROOT, '外层\\内层\\深一层\\x.mp4', ['深层标签'])]
    const outer = makeFolder({ name: '外层', rel: '外层' })
    expect(collectFolderTags(nested, outer, folderPathOf, rootOf, tagsOf)).toEqual(['深层标签'])
  })

  it('去重且稳定排序，空标签被忽略', () => {
    const dup = [
      makeVideo(ROOT, '子目录A\\a1.mp4', ['A', 'A', '']),
      makeVideo(ROOT, '子目录A\\a2.mp4', ['A', 'B'])
    ]
    expect(collectFolderTags(dup, makeFolder(), folderPathOf, rootOf, tagsOf)).toEqual(['A', 'B'])
  })

  it('不同根目录互不串味', () => {
    const other = [makeVideo('E:\\Other', '子目录A\\x.mp4', ['别的根'])]
    expect(collectFolderTags(other, makeFolder(), folderPathOf, rootOf, tagsOf)).toEqual([])
  })
})

describe('目录包含判定（正/反斜杠都能比）', () => {
  it('normalizeFolderPath 统一分隔符并去掉首尾斜杠', () => {
    expect(normalizeFolderPath('\\A\\B\\')).toBe('A/B')
    expect(normalizeFolderPath('/A/B/')).toBe('A/B')
    expect(normalizeFolderPath('')).toBe('')
  })

  it('folderContainsVideo：自身与更深层级都算，兄弟目录不算', () => {
    expect(folderContainsVideo('A', 'A')).toBe(true)
    expect(folderContainsVideo('A', 'A/B')).toBe(true)
    expect(folderContainsVideo('A', 'A/B/C')).toBe(true)
    expect(folderContainsVideo('A', 'AB')).toBe(false) // 前缀相同但不是子目录
    expect(folderContainsVideo('A', 'A2/B')).toBe(false)
    expect(folderContainsVideo('', '任意/层级')).toBe(true) // 根卡片
  })
})

describe('isFolderVisible', () => {
  const baseCtx = {
    query: '',
    tagFilter: { include: [], exclude: [] },
    matchVideo: () => true,
    tagsOfVideo: tagsOf,
    videosInsideOf: () => []
  }

  it('没搜索、没筛选 → 全都显示', () => {
    expect(isFolderVisible(makeFolder({ tags: [] }), baseCtx)).toBe(true)
  })

  it('标签筛选下：并集满足了就继续显示（这就是"筛选后仍能看到文件夹"）', () => {
    const folder = makeFolder({ tags: ['3D作品', '2D作品'] })
    expect(isFolderVisible(folder, { ...baseCtx, tagFilter: { include: ['3D作品'], exclude: [] } })).toBe(true)
    expect(isFolderVisible(folder, { ...baseCtx, tagFilter: { include: ['像素风'], exclude: [] } })).toBe(false)
    expect(isFolderVisible(folder, { ...baseCtx, tagFilter: { include: [], exclude: ['2D作品'] } })).toBe(false)
  })

  it('搜索命中文件夹名 → 哪怕里面没有匹配的视频也显示（方便直接钻进去）', () => {
    const folder = makeFolder({ name: '3D作品', rel: '3D作品', tags: [] })
    expect(isFolderVisible(folder, {
      ...baseCtx,
      query: '3D',
      videosInsideOf: () => []
    })).toBe(true)
  })

  it('搜索命中文件夹内的视频 → 显示；完全不沾边 → 隐藏', () => {
    const folder = makeFolder({ name: '子目录A', tags: [] })
    const hitCtx = {
      ...baseCtx,
      query: '第二部',
      matchVideo: (video: any) => String(video.name).includes('第二部'),
      videosInsideOf: () => [{ name: '第二部_改名了' }]
    }
    expect(isFolderVisible(folder, hitCtx)).toBe(true)

    const missCtx = { ...hitCtx, videosInsideOf: () => [{ name: '第三个' }] }
    expect(isFolderVisible(folder, missCtx)).toBe(false)
  })

  it('搜索时也看子文件夹里的视频（子树口径，否则搜深层文件时上层夹全消失）', () => {
    const folder = makeFolder({ name: '子目录A', tags: [] })
    const ctx = {
      ...baseCtx,
      query: '深层',
      matchVideo: (video: any) => String(video.name).includes('深层'),
      // 这一层的直接子文件是空的，命中的视频在更深一层 —— 文件夹仍要显示
      videosInsideOf: () => [{ name: '深层里的片子' }]
    }
    expect(isFolderVisible(folder, ctx)).toBe(true)
  })

  it('搜索 + 标签筛选同时生效', () => {
    const folder = makeFolder({ name: '子目录A', tags: ['像素风'] })
    const ctx = {
      ...baseCtx,
      query: '第一',
      tagFilter: { include: ['3D作品'], exclude: [] },
      matchVideo: () => true,
      videosInsideOf: () => [{ name: '第一集' }]
    }
    // 标签并集不满足 include → 隐藏（即使里面有名字命中的视频）
    expect(isFolderVisible(folder, ctx)).toBe(false)
  })
})

describe('folderNameMatches / filterVisibleFolders', () => {
  it('文件夹名支持模糊匹配（忽略分隔符、子序列）', () => {
    const folder = makeFolder({ name: '3D作品 合集', rel: '3D作品 合集' })
    expect(folderNameMatches(folder, '3d作品')).toBe(true)
    expect(folderNameMatches(folder, '3D合集')).toBe(true) // 忽略空格
    expect(folderNameMatches(folder, '3合')).toBe(true) // 子序列
    expect(folderNameMatches(folder, 'zzz')).toBe(false)
  })

  it('批量过滤保持顺序', () => {
    const folders = [
      makeFolder({ key: 'a', name: 'A', tags: ['3D作品'] }),
      makeFolder({ key: 'b', name: 'B', tags: ['像素风'] }),
      makeFolder({ key: 'c', name: 'C', tags: ['3D作品', '像素风'] })
    ]
    const ctx = {
      query: '',
      tagFilter: { include: ['3D作品'], exclude: [] },
      matchVideo: () => true,
      tagsOfVideo: tagsOf,
      videosInsideOf: () => []
    }
    expect(filterVisibleFolders(folders, ctx).map(f => f.key)).toEqual(['a', 'c'])
  })

  it('空数组安全', () => {
    expect(filterVisibleFolders([], {
      query: '',
      tagFilter: { include: [], exclude: [] },
      matchVideo: () => true,
      tagsOfVideo: tagsOf,
      videosInsideOf: () => []
    })).toEqual([])
  })
})
