/**
 * 视频页「文件夹」在筛选/搜索下的可见性判定
 *
 * 主人 2026-10-04 的需求原话：
 *   「视频附上标签后，它所在的文件夹（仅本身文件夹，不包含上级或下级文件夹）拥有这些标签的并集；
 *     这样能够在筛选条件下仍显示文件夹」
 *
 * 于是规则定成三条：
 *   1. **标签并集**：文件夹的标签 = 它**直接**包含的那些视频的标签并集（不含子文件夹里的）；
 *   2. 左栏标签筛选生效时，文件夹按并集判定：
 *        include —— 每个被选的标签都必须在并集里（文件夹里"至少有一个"带该标签的视频）
 *        exclude —— 并集里出现任何一个被排除的标签就隐藏
 *      （注意：这是"并集语义"，不是"有一个视频同时满足全部条件"，
 *        因为主人要的是"筛选下仍能看到文件夹、进去再挑"）
 *   3. 搜索框：文件夹**自己的名字/路径**命中查询时照样显示；
 *      另外，文件夹里只要有**直接命中查询**的视频，它也要显示（否则搜东西时文件夹全消失，没法往里钻）。
 *
 * 纯函数，专门给单测用（`src/tests/videoFolderFilter.spec.ts`）。
 */

import { matchesFuzzy } from './fuzzySearch'

/** 参与判定的文件夹卡片（videoLib.folderCards 的子集） */
export interface FolderLike {
  key: string
  name: string
  kind: 'root' | 'folder'
  root: string | null
  rel: string
  fullPath: string
  /** 直接包含的视频标签并集（不含子文件夹） */
  tags: string[]
}

/** 标签筛选状态 */
export interface FolderTagFilter {
  include: string[]
  exclude: string[]
}

/**
 * 文件夹的标签并集是否满足标签筛选
 * @param folderTags 该文件夹直接视频的标签并集
 * @param filter include / exclude
 */
export function satisfiesFolderTagFilter(folderTags: string[], filter: FolderTagFilter): boolean {
  const include = filter?.include ?? []
  const exclude = filter?.exclude ?? []
  if (include.length === 0 && exclude.length === 0) return true

  const set = new Set(folderTags || [])
  if (exclude.length > 0 && exclude.some(tag => set.has(tag))) return false
  if (include.length > 0 && !include.every(tag => set.has(tag))) return false
  return true
}

/**
 * 文件夹自己的名字/相对路径是否命中查询
 * （"全部"层的根目录卡片用 fullPath 兜底，folder 卡片用 name + rel）
 */
export function folderNameMatches(folder: FolderLike, query: string): boolean {
  const texts = [folder.name, folder.rel, folder.fullPath].filter(Boolean)
  return matchesFuzzy(texts, query)
}

export interface FolderVisibilityContext {
  /** 搜索词（空 = 没搜索） */
  query: string
  /** 左栏标签筛选 */
  tagFilter: FolderTagFilter
  /** 判断某条视频是否命中当前搜索（由调用方用同一套 searchFields 提供） */
  matchVideo: (video: any) => boolean
  /** 取某条视频的标签（兼容 ResourceField / 数组） */
  tagsOfVideo: (video: any) => string[]
  /** 某一层里、直接属于该文件夹的视频（root 卡片则给它整个根目录下的顶层视频） */
  directVideosOf: (folder: FolderLike) => any[]
}

/**
 * 该文件夹此刻是否应该显示
 */
export function isFolderVisible(folder: FolderLike, context: FolderVisibilityContext): boolean {
  const query = String(context?.query ?? '').trim()

  // 1) 文件夹自己的名字/路径命中 → 直接显示（哪怕它自己是空的）
  if (query && folderNameMatches(folder, query)) return true

  // 2) 标签并集要满足左栏标签筛选
  const tags = Array.isArray(folder.tags) ? folder.tags : []
  if (!satisfiesFolderTagFilter(tags, context.tagFilter)) return false

  // 3) 有搜索词时，还要"里面确实有对得上的视频"，否则搜出来的文件夹点进去是空的
  if (query) {
    const direct = context.directVideosOf(folder) || []
    return direct.some(video => context.matchVideo(video))
  }

  return true
}

/**
 * 批量过滤（顺手把不需要的字段摘掉）
 */
export function filterVisibleFolders(folders: FolderLike[], context: FolderVisibilityContext): FolderLike[] {
  if (!Array.isArray(folders) || folders.length === 0) return []
  return folders.filter(folder => isFolderVisible(folder, context))
}

/**
 * 收集某一层里「直接属于该文件夹」的视频的标签并集。
 *
 * @param videos 候选视频（通常是整个视频库）
 * @param folder 目标文件夹卡片
 * @param folderPathOf 取某条视频所在目录（相对根目录，根下为 ''）
 * @param rootOf 取某条视频所属根目录
 * @param tagsOf 取某条视频的标签
 */
export function collectFolderTags(
  videos: any[],
  folder: FolderLike,
  folderPathOf: (video: any) => string,
  rootOf: (video: any) => string,
  tagsOf: (video: any) => string[]
): string[] {
  const set = new Set<string>()
  const targetRel = folder.rel || ''
  const targetRoot = folder.root

  for (const video of videos || []) {
    const videoRoot = rootOf(video)
    // 根目录卡片：整层（根下直接放着的视频）都算它的
    if (targetRoot !== null && !samePath(videoRoot, targetRoot)) continue
    const folderPath = folderPathOf(video)
    if (folder.kind === 'folder' ? folderPath !== targetRel : folderPath !== '') continue
    for (const tag of tagsOf(video) || []) {
      if (tag) set.add(tag)
    }
  }

  return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

/** 路径比较（Windows 大小写不敏感 + 反斜杠统一） */
function samePath(a: unknown, b: unknown): boolean {
  const normalize = (input: unknown) => String(input ?? '').replace(/\//g, '\\').toLowerCase()
  return normalize(a) === normalize(b)
}
