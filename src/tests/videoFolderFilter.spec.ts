/**
 * 视频「文件夹」在标签筛选 / 搜索下的可见性测试
 *
 * 主人 2026-10-04 的需求：
 *   「文件夹（仅本身，不含上下级）拥有其内视频标签的并集；这样在筛选条件下仍能显示文件夹」
 */
import { describe, it, expect } from 'vitest'
import {
  collectFolderTags,
  filterVisibleFolders,
  folderNameMatches,
  isFolderVisible,
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

describe('collectFolderTags（只取直接子级，不含上下级）', () => {
  const videos = [
    makeVideo(ROOT, '根下的.mp4', ['根标签']),
    makeVideo(ROOT, '子目录A\\a1.mp4', ['3D作品', '收藏']),
    makeVideo(ROOT, '子目录A\\a2.mp4', ['2D作品']),
    // 更深一层：不该算进「子目录A」的并集
    makeVideo(ROOT, '子目录A\\深层B\\b1.mp4', ['深层标签']),
    // 兄弟目录：也不该算
    makeVideo(ROOT, '子目录C\\c1.mp4', ['另一个标签'])
  ]

  it('folder 卡片：只并集它**直接**包含的视频标签，不含更深一层', () => {
    const tags = collectFolderTags(videos, makeFolder(), folderPathOf, rootOf, tagsOf)
    expect(tags).toEqual(['2D作品', '3D作品', '收藏'].sort((a, b) => a.localeCompare(b, 'zh-CN')))
    expect(tags).not.toContain('深层标签')
    expect(tags).not.toContain('根标签')
    expect(tags).not.toContain('另一个标签')
  })

  it('root 卡片：只并集「直接散在根目录下」的视频标签', () => {
    const rootCard = makeFolder({ kind: 'root', name: ROOT, rel: '', fullPath: ROOT })
    const tags = collectFolderTags(videos, rootCard, folderPathOf, rootOf, tagsOf)
    expect(tags).toEqual(['根标签'])
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

describe('isFolderVisible', () => {
  const baseCtx = {
    query: '',
    tagFilter: { include: [], exclude: [] },
    matchVideo: () => true,
    tagsOfVideo: tagsOf,
    directVideosOf: () => []
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
      directVideosOf: () => []
    })).toBe(true)
  })

  it('搜索命中文件夹内的视频 → 显示；完全不沾边 → 隐藏', () => {
    const folder = makeFolder({ name: '子目录A', tags: [] })
    const hitCtx = {
      ...baseCtx,
      query: '第二部',
      matchVideo: (video: any) => String(video.name).includes('第二部'),
      directVideosOf: () => [{ name: '第二部_改名了' }]
    }
    expect(isFolderVisible(folder, hitCtx)).toBe(true)

    const missCtx = { ...hitCtx, directVideosOf: () => [{ name: '第三个' }] }
    expect(isFolderVisible(folder, missCtx)).toBe(false)
  })

  it('搜索时不看子文件夹里的视频（只看直接子级，与标签并集口径一致）', () => {
    const folder = makeFolder({ name: '子目录A', tags: [] })
    // directVideosOf 只给直接子级；这里模拟"命中视频在更深一层"
    const ctx = {
      ...baseCtx,
      query: '深层',
      matchVideo: (video: any) => String(video.name).includes('深层'),
      directVideosOf: () => []
    }
    expect(isFolderVisible(folder, ctx)).toBe(false)
  })

  it('搜索 + 标签筛选同时生效', () => {
    const folder = makeFolder({ name: '子目录A', tags: ['像素风'] })
    const ctx = {
      ...baseCtx,
      query: '第一',
      tagFilter: { include: ['3D作品'], exclude: [] },
      matchVideo: () => true,
      directVideosOf: () => [{ name: '第一集' }]
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
      directVideosOf: () => []
    }
    expect(filterVisibleFolders(folders, ctx).map(f => f.key)).toEqual(['a', 'c'])
  })

  it('空数组安全', () => {
    expect(filterVisibleFolders([], {
      query: '',
      tagFilter: { include: [], exclude: [] },
      matchVideo: () => true,
      tagsOfVideo: tagsOf,
      directVideosOf: () => []
    })).toEqual([])
  })
})
