/**
 * 主页「抓阄链路」的视频版
 *
 * 与游戏版的差别只有**打分口径**：
 *   游戏 → 时长(0.7) + 次数(0.3) / 最后游玩 / 空置天数
 *   视频 → 打开次数            / 最后打开 / 空置天数（视频不计时，所以没有时长）
 *
 * 抽签数学（候选池、权重随机、固定席位、重抽避让）**完全复用** `recommendation.ts`
 * 里的 `pickFromScored` —— 一套实现，两个口径，避免两处随机逻辑慢慢分叉。
 * 测试：`src/tests/videoRecommendation.spec.ts`
 */

import {
  DEFAULT_PINNED_SIZE,
  DEFAULT_ROW_SIZE,
  firstNonEmptyString,
  formatDurationText,
  pickFromScored,
  safeTime,
  type ChainPickResult,
  type Scored,
  type TagFilterState
} from './recommendation'

export type VideoChainId = 'most-watched' | 'recent' | 'up-next'

/** 视频链路元信息（UI 用） */
export interface VideoChainMeta {
  id: VideoChainId
  icon: string
  titleKey: string
  hintKey: string
}

export const VIDEO_CHAINS: VideoChainMeta[] = [
  { id: 'most-watched', icon: '🔥', titleKey: 'home.videoChainMostWatched', hintKey: 'home.videoChainMostWatchedHint' },
  { id: 'recent', icon: '🕒', titleKey: 'home.videoChainRecent', hintKey: 'home.videoChainRecentHint' },
  { id: 'up-next', icon: '⏳', titleKey: 'home.videoChainUpNext', hintKey: 'home.videoChainUpNextHint' }
]

/** 主页推荐用的轻量视频视图（从 SQLite 原始 JSON 归一化而来） */
export interface HomeVideo {
  id: string
  name: string
  /** 作者（原「开发商」口径） */
  author: string
  coverPath: string
  tags: string[]
  /** 打开次数 */
  watchCount: number
  /** 最后打开时间（ISO），从未打开为 null */
  lastOpened: string | null
  /** 入库时间（ISO） */
  addedDate: string | null
  /** 时长（秒），未知为 0 */
  durationSec: number
  /** 相对绑定根目录的路径（卡片上展示文件在哪） */
  relPath: string
  /** 文件是否还在（不落库，缺失时为 undefined → 当作在） */
  fileExists: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 把 SQLite 读出的原始视频 JSON 归一化成主页用的轻量结构。
 * 兼容 `author`（数组或字符串）与 `lastOpened` / `visitedSessions` 两种最后打开来源。
 */
export function toHomeVideo(raw: any): HomeVideo {
  const authors = Array.isArray(raw?.author) ? raw.author : []

  // 🔴 外部播放统计**只认 ini**：主进程 potstats-bridge 把 ini 的值写进 `potPlayerStats`。
  // 没有 ini 的视频 → 这里就是 0 次 / 无最后打开 → **不会**进「最常观看 / 最近观看」两条链路
  //（主人 2026-10-05 要求：以 ini 为唯一事实来源，没 ini 就当从未观看、不纳入主页推荐统计）。
  const stats = raw?.potPlayerStats && typeof raw.potPlayerStats === 'object' ? raw.potPlayerStats : null
  const iniLastOpenMs = stats ? Number(stats.lastOpenMs) || 0 : 0
  const iniLastOpen = iniLastOpenMs > 0 ? new Date(iniLastOpenMs).toISOString() : null

  return {
    id: String(raw?.id ?? ''),
    name:
      firstNonEmptyString(raw?.name, raw?.fileName) ??
      '(未命名)',
    author: firstNonEmptyString(authors[0], raw?.author) ?? '',
    coverPath: firstNonEmptyString(raw?.coverPath, raw?.thumbnail) ?? '',
    tags: Array.isArray(raw?.tags)
      ? raw.tags.filter((tag: unknown): tag is string => typeof tag === 'string' && tag !== '')
      : [],
    watchCount: stats ? Number(stats.playCount) || 0 : 0,
    lastOpened: iniLastOpen,
    addedDate: firstNonEmptyString(raw?.addedDate),
    durationSec: Number(raw?.durationSec) || 0,
    relPath: firstNonEmptyString(raw?.relPath) ?? '',
    fileExists: raw?.fileExists !== false
  }
}

/** 空置天数：看过的按最后打开时间，没看过的按入库时间；都没有按 0 天算 */
export function idleDaysOfVideo(video: HomeVideo, now: number): number {
  const anchor = safeTime(video.lastOpened) ?? safeTime(video.addedDate)
  if (anchor === null) return 0
  return Math.max(0, (now - anchor) / DAY_MS)
}

/**
 * 按链路主题给视频打分并降序排名
 *  - most-watched：只看打开次数（一次没看过的永远不参与）
 *  - recent      ：必须有最后打开时间，越新越靠前
 *  - up-next     ：空置天数越大越靠前（没看过的从入库日算起）
 */
export function scoreVideoChain(
  videos: HomeVideo[],
  chainId: VideoChainId,
  now: number = Date.now()
): Scored<HomeVideo>[] {
  let scored: Array<{ item: HomeVideo; metric: number }>

  if (chainId === 'most-watched') {
    scored = videos
      .filter(video => video.watchCount > 0)
      .map(video => ({ item: video, metric: video.watchCount }))
  } else if (chainId === 'recent') {
    scored = videos
      .map(video => ({ video, time: safeTime(video.lastOpened) }))
      .filter((entry): entry is { video: HomeVideo; time: number } => entry.time !== null)
      .map(entry => ({ item: entry.video, metric: entry.time }))
  } else {
    scored = videos.map(video => ({ item: video, metric: idleDaysOfVideo(video, now) }))
  }

  return scored
    .sort((a, b) => {
      if (b.metric !== a.metric) return b.metric - a.metric
      return a.item.name.localeCompare(b.item.name, 'zh-CN')
    })
    .map((entry, index) => ({ item: entry.item, metric: entry.metric, rank: index + 1 }))
}

export interface VideoChainPickOptions {
  count?: number
  pinnedCount?: number
  rng?: () => number
  now?: number
  avoidIds?: string[]
}

/** 抽一条视频链路的展示名单（固定席位 + 加权随机，规则与游戏页完全一致） */
export function pickVideoChain(
  videos: HomeVideo[],
  chainId: VideoChainId,
  options: VideoChainPickOptions = {}
): ChainPickResult<HomeVideo> {
  const now = options.now ?? Date.now()
  const scored = scoreVideoChain(videos, chainId, now)
  return pickFromScored(scored, {
    count: options.count ?? DEFAULT_ROW_SIZE,
    pinnedCount: options.pinnedCount ?? DEFAULT_PINNED_SIZE,
    rng: options.rng,
    avoidIds: options.avoidIds
  })
}

/** 每条链路给每张卡生成一句「为什么推荐它」 */
export function describeVideo(
  chainId: VideoChainId,
  video: HomeVideo,
  now: number = Date.now()
): { key: string, params: Record<string, string | number> } {
  if (chainId === 'most-watched') {
    return { key: 'home.captionVideoMostWatched', params: { count: video.watchCount } }
  }

  if (chainId === 'recent') {
    const time = safeTime(video.lastOpened)
    if (time === null) return { key: 'home.captionVideoNever', params: {} }
    const days = Math.floor((now - time) / DAY_MS)
    if (days <= 0) return { key: 'home.captionVideoToday', params: {} }
    return { key: 'home.captionVideoDaysAgo', params: { days } }
  }

  const days = Math.floor(idleDaysOfVideo(video, now))
  if (!video.lastOpened) {
    return { key: 'home.captionVideoNeverWatched', params: { days } }
  }
  return { key: 'home.captionVideoIdle', params: { days } }
}

/** 时长文案（主页卡片上偶尔要显示，跟游戏页共用格式化） */
export function formatVideoDurationText(seconds: number): string {
  return seconds > 0 ? formatDurationText(seconds) : '未知时长'
}

/** 视频标签筛选（与游戏页同一套语义：include 全命中、exclude 命中任一即淘汰） */
export function filterVideosByTags(videos: HomeVideo[], filter: TagFilterState): HomeVideo[] {
  const include = filter?.include ?? []
  const exclude = filter?.exclude ?? []
  if (include.length === 0 && exclude.length === 0) return videos

  return videos.filter(video => {
    if (exclude.length > 0 && video.tags.some(tag => exclude.includes(tag))) return false
    if (include.length > 0 && !include.every(tag => video.tags.includes(tag))) return false
    return true
  })
}
