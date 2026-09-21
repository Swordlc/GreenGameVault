/**
 * 主页「抓阄链路」推荐引擎
 *
 * 设计要点（对应需求）：
 *  1. 每条链路先按自己的指标打分排序，前 `pinnedCount`（默认 3）名是「绝对值最大」的固定席位；
 *  2. 其余名额从「候选池」里按权重随机抽取 —— 越贴合链路主题权重越大，
 *     池内尾巴也有极小但非零的概率冒头（MIN_RELATIVE_FITNESS）；
 *  3. 候选池只保留该链路指标最靠前的 top-K，「几乎不玩 / 完全不搭边」的游戏永远不会被抽到；
 *  4. 纯函数 + 可注入 rng / now，不依赖 Electron / DOM，便于单测。
 *
 * 三条链路的口径：
 *  - most-played（最常游玩）：游戏时长 0.7 + 启动次数 0.3（各自按库内最大值归一化）
 *  - recent（最近游玩）    ：最后游玩时间越新越靠前；从未玩过的不参与
 *  - up-next（接下来游玩） ：空置天数越大越靠前；玩过的按最后游玩时间、没玩过的按添加时间
 */

export type ChainId = 'most-played' | 'recent' | 'up-next'

/** 主页推荐用的轻量游戏视图（从 SQLite 原始 JSON 归一化而来） */
export interface HomeGame {
  id: string
  name: string
  developer: string
  coverPath: string
  tags: string[]
  /** 累计游玩秒数（与全应用一致，存的是秒） */
  playTime: number
  /** 启动次数 */
  playCount: number
  /** 最后游玩时间（ISO 字符串），从未玩过为 null */
  lastPlayed: string | null
  /** 入库时间（ISO 字符串） */
  addedDate: string | null
}

/** 链路元信息（UI 用） */
export interface ChainMeta {
  id: ChainId
  icon: string
  titleKey: string
  hintKey: string
}

export const CHAINS: ChainMeta[] = [
  { id: 'most-played', icon: '🔥', titleKey: 'home.chainMostPlayed', hintKey: 'home.chainMostPlayedHint' },
  { id: 'recent', icon: '🕒', titleKey: 'home.chainRecent', hintKey: 'home.chainRecentHint' },
  { id: 'up-next', icon: '⏳', titleKey: 'home.chainUpNext', hintKey: 'home.chainUpNextHint' }
]

/** 时长与次数的权重（主人钦定：0.7 / 0.3） */
const PLAY_TIME_WEIGHT = 0.7
const PLAY_COUNT_WEIGHT = 0.3

/** 权重曲线指数：越大越向榜首集中 */
const WEIGHT_GAMMA = 1.5

/**
 * 池内「最不贴合」的那一个，其相对贴合度保底值。
 * 它 ^gamma 之后就是相对榜首的权重（0.05^1.5 ≈ 1.1%），即「小概率」而不是零概率。
 */
const MIN_RELATIVE_FITNESS = 0.05

/** 候选池规模：大库取指标 top-K，避免「几乎不玩」的游戏进入抽签 */
const POOL_RATIO = 0.25
const POOL_MAX = 60

/** 库容 <= count * SMALL_LIBRARY_FACTOR 时不再截断候选池（小库全收） */
const SMALL_LIBRARY_FACTOR = 3

/** 候选池至少要有一行的 MIN_POOL_FACTOR 倍，否则「抓阄」会退化成固定名单 */
const MIN_POOL_FACTOR = 3

/** 重抽时最多尝试几次以避开与上一批完全相同的随机位 */
const MAX_RESAMPLE_ATTEMPTS = 12

const DAY_MS = 24 * 60 * 60 * 1000

/** 首页一行默认卡片数 / 固定席位数 */
export const DEFAULT_ROW_SIZE = 8
export const DEFAULT_PINNED_SIZE = 3

export interface TagFilterState {
  include: string[]
  exclude: string[]
}

export interface ChainPickOptions {
  /** 一行总共展示几张，默认 8 */
  count?: number
  /** 前几名是绝对值最大的固定席位，默认 3 */
  pinnedCount?: number
  /** 随机源，默认 Math.random（测试可注入） */
  rng?: () => number
  /** 当前时间戳，默认 Date.now()（测试可注入） */
  now?: number
  /** 上一次抽出的随机位 id：重抽时尽量避开同一批 */
  avoidIds?: string[]
}

export interface ChainPick {
  /** 已按链路名次排好序的展示列表 */
  games: HomeGame[]
  /** 每张卡的 1-based 名次 */
  rankOf: Record<string, number>
  /** 固定席位（前 pinnedCount 名）的 id */
  pinnedIds: string[]
  /** 本次随机位抽中的 id（用于下次 avoidIds） */
  randomIds: string[]
  /** 候选池大小 */
  poolSize: number
  /** 有资格参与本链路的游戏数 */
  eligibleCount: number
}

interface Scored {
  game: HomeGame
  /** 越大越贴合链路主题 */
  metric: number
  /** 1-based 名次 */
  rank: number
}

/* -------------------------------------------------------------------------- */
/* 归一化与筛选                                                                */
/* -------------------------------------------------------------------------- */

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}

/**
 * 把 SQLite 读出的原始游戏 JSON 归一化成主页用的轻量结构。
 * 兼容 `developer` / `developers[0]` 两种开发商写法，以及 `lastPlayed` / `visitedSessions` 两种最后游玩来源。
 */
export function toHomeGame(raw: any): HomeGame {
  const sessions = Array.isArray(raw?.visitedSessions) ? raw.visitedSessions : []
  const lastSession = sessions.length > 0 ? sessions[sessions.length - 1] : null
  const developers = Array.isArray(raw?.developers) ? raw.developers : []

  return {
    id: String(raw?.id ?? ''),
    name: typeof raw?.name === 'string' && raw.name ? raw.name : '(未命名)',
    developer: firstNonEmptyString(raw?.developer, developers[0], raw?.publisher) ?? '',
    coverPath: firstNonEmptyString(raw?.coverPath, raw?.thumbnail, raw?.image) ?? '',
    tags: Array.isArray(raw?.tags) ? raw.tags.filter((t: unknown): t is string => typeof t === 'string' && t !== '') : [],
    playTime: Number(raw?.playTime) || 0,
    playCount: Number(raw?.playCount) || 0,
    lastPlayed: firstNonEmptyString(raw?.lastPlayed, lastSession),
    addedDate: firstNonEmptyString(raw?.addedDate)
  }
}

/**
 * 标签全局筛选，语义与游戏管理页左侧标签栏完全一致：
 *  - exclude：命中任意一个排除标签即淘汰（NOT ANY）
 *  - include：必须命中全部选中标签（AND）
 */
export function filterGamesByTags(games: HomeGame[], filter: TagFilterState): HomeGame[] {
  const include = filter?.include ?? []
  const exclude = filter?.exclude ?? []
  if (include.length === 0 && exclude.length === 0) return games

  return games.filter(game => {
    const tags = game.tags
    if (exclude.length > 0 && tags.some(tag => exclude.includes(tag))) return false
    if (include.length > 0 && !include.every(tag => tags.includes(tag))) return false
    return true
  })
}

/** 统计全库标签及出现次数（下拉列表用），按名称排序 */
export function collectTagOptions(games: HomeGame[]): Array<{ name: string; count: number }> {
  const counter = new Map<string, number>()
  for (const game of games) {
    for (const tag of game.tags) {
      counter.set(tag, (counter.get(tag) ?? 0) + 1)
    }
  }
  return Array.from(counter.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

/* -------------------------------------------------------------------------- */
/* 打分                                                                        */
/* -------------------------------------------------------------------------- */

function safeTime(value: string | null): number | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

/** 空置天数：玩过的按最后游玩时间，没玩过的按添加时间；两者都没有时按 0 天处理 */
export function idleDaysOf(game: HomeGame, now: number): number {
  const anchor = safeTime(game.lastPlayed) ?? safeTime(game.addedDate)
  if (anchor === null) return 0
  return Math.max(0, (now - anchor) / DAY_MS)
}

/**
 * 按链路主题给游戏打分并降序排名。
 * 返回的 metric 只在同一链路内可比，仅用于「谁更贴合主题」。
 */
export function scoreChain(games: HomeGame[], chainId: ChainId, now: number = Date.now()): Scored[] {
  let scored: Array<{ game: HomeGame; metric: number }>

  if (chainId === 'most-played') {
    // 只考虑玩过的（playTime / playCount 至少有一个 > 0）
    const played = games.filter(game => game.playTime > 0 || game.playCount > 0)
    const maxPlayTime = played.reduce((max, game) => Math.max(max, game.playTime), 0)
    const maxPlayCount = played.reduce((max, game) => Math.max(max, game.playCount), 0)

    scored = played.map(game => ({
      game,
      metric:
        (maxPlayTime > 0 ? PLAY_TIME_WEIGHT * (game.playTime / maxPlayTime) : 0) +
        (maxPlayCount > 0 ? PLAY_COUNT_WEIGHT * (game.playCount / maxPlayCount) : 0)
    }))
  } else if (chainId === 'recent') {
    // 必须有最后游玩时间；metric 用「越大越新」
    scored = games
      .map(game => ({ game, time: safeTime(game.lastPlayed) }))
      .filter((entry): entry is { game: HomeGame; time: number } => entry.time !== null)
      .map(entry => ({ game: entry.game, metric: entry.time }))
  } else {
    // up-next：空置天数越大越靠前，从未玩过的也参与
    scored = games.map(game => ({ game, metric: idleDaysOf(game, now) }))
  }

  return scored
    .sort((a, b) => {
      if (b.metric !== a.metric) return b.metric - a.metric
      // 指标相同时用名称做稳定排序，避免同一份数据每次顺序抖动
      return a.game.name.localeCompare(b.game.name, 'zh-CN')
    })
    .map((entry, index) => ({ game: entry.game, metric: entry.metric, rank: index + 1 }))
}

/** 候选池大小：小库全收，大库取 top-K（K 至少是一行的 MIN_POOL_FACTOR 倍，保证抽签有腾挪空间） */
export function resolvePoolSize(eligibleCount: number, count: number): number {
  if (eligibleCount <= count * SMALL_LIBRARY_FACTOR) return eligibleCount
  const minPool = count * MIN_POOL_FACTOR
  return Math.min(POOL_MAX, Math.max(minPool, Math.round(eligibleCount * POOL_RATIO)), eligibleCount)
}

/* -------------------------------------------------------------------------- */
/* 权重随机抽样                                                                */
/* -------------------------------------------------------------------------- */

/**
 * 按「池内相对贴合度 ^ gamma」为权重，不放回地抽 k 个。
 * 最不贴合的也有 MIN_RELATIVE_FITNESS 的保底贴合度 ⇒ 小概率可被抽中。
 */
function weightedSampleWithoutReplacement(candidates: Scored[], k: number, rng: () => number): Scored[] {
  if (k <= 0 || candidates.length === 0) return []

  const metrics = candidates.map(entry => entry.metric)
  const min = Math.min(...metrics)
  const max = Math.max(...metrics)
  const span = max - min

  const pool = candidates.map(entry => {
    const relative = span > 0 ? (entry.metric - min) / span : 1
    const fitness = Math.max(relative, MIN_RELATIVE_FITNESS)
    return { entry, weight: Math.pow(fitness, WEIGHT_GAMMA) }
  })

  const picked: Scored[] = []
  const wanted = Math.min(k, pool.length)

  while (picked.length < wanted) {
    const total = pool.reduce((sum, item) => sum + item.weight, 0)
    let index = 0
    if (total <= 0) {
      // 理论上不会发生（权重恒 > 0），保底用均匀抽样
      index = Math.floor(rng() * pool.length)
      index = Math.min(Math.max(index, 0), pool.length - 1)
    } else {
      let threshold = rng() * total
      for (index = 0; index < pool.length - 1; index++) {
        threshold -= pool[index].weight
        if (threshold <= 0) break
      }
    }
    picked.push(pool[index].entry)
    pool.splice(index, 1)
  }

  return picked
}

/** 重抽时若与上一批随机位完全相同则再抽一次，避免「重新推荐」按钮看起来没反应 */
function sampleAvoidingPrevious(
  candidates: Scored[],
  k: number,
  rng: () => number,
  avoidIds: string[]
): Scored[] {
  let picked = weightedSampleWithoutReplacement(candidates, k, rng)
  if (avoidIds.length === 0 || picked.length === 0) return picked

  const avoid = new Set(avoidIds)
  for (let attempt = 0; attempt < MAX_RESAMPLE_ATTEMPTS; attempt++) {
    if (!picked.every(entry => avoid.has(entry.game.id))) return picked
    picked = weightedSampleWithoutReplacement(candidates, k, rng)
  }
  return picked
}

/* -------------------------------------------------------------------------- */
/* 对外主入口                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 抽一条链路的推荐结果。
 * 固定席位 = 指标最强的 pinnedCount 名；其余名额 = 候选池内加权随机。
 */
export function pickChain(games: HomeGame[], chainId: ChainId, options: ChainPickOptions = {}): ChainPick {
  const count = options.count ?? DEFAULT_ROW_SIZE
  const pinnedCount = options.pinnedCount ?? DEFAULT_PINNED_SIZE
  const rng = options.rng ?? Math.random
  const now = options.now ?? Date.now()
  const avoidIds = options.avoidIds ?? []

  const scored = scoreChain(games, chainId, now)
  if (scored.length === 0) {
    return { games: [], rankOf: {}, pinnedIds: [], randomIds: [], poolSize: 0, eligibleCount: 0 }
  }

  const poolSize = resolvePoolSize(scored.length, count)
  const pool = scored.slice(0, poolSize)
  const pinned = pool.slice(0, Math.min(pinnedCount, pool.length))
  const pinnedIdSet = new Set(pinned.map(entry => entry.game.id))

  const randomSlots = Math.min(count - pinned.length, pool.length - pinned.length)
  const candidates = pool.filter(entry => !pinnedIdSet.has(entry.game.id))
  const picked = sampleAvoidingPrevious(candidates, randomSlots, rng, avoidIds)

  const chosen = [...pinned, ...picked].sort((a, b) => a.rank - b.rank)

  const rankOf: Record<string, number> = {}
  for (const entry of chosen) rankOf[entry.game.id] = entry.rank

  return {
    games: chosen.map(entry => entry.game),
    rankOf,
    pinnedIds: pinned.map(entry => entry.game.id),
    randomIds: picked.map(entry => entry.game.id),
    poolSize,
    eligibleCount: scored.length
  }
}

/* -------------------------------------------------------------------------- */
/* 展示文案                                                                    */
/* -------------------------------------------------------------------------- */

export interface GameCaption {
  key: string
  params: Record<string, string | number>
}

/**
 * 把秒数格式化成人话。主页一行 8 张卡，宽度很窄，所以这里刻意用紧凑写法：
 *   < 1 分钟 → "45 秒"；< 1 小时 → "35 分钟"；< 10 小时 → "5.6 小时"；再大 → "23 小时"
 */
export function formatDurationText(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0))
  if (total < 60) return `${total} 秒`
  if (total < 3600) return `${Math.floor(total / 60)} 分钟`
  const hours = total / 3600
  if (hours < 10) return `${(Math.round(hours * 10) / 10).toFixed(1)} 小时`
  return `${Math.round(hours)} 小时`
}

/** 每条链路给每张卡生成一句「为什么推荐它」 */
export function describeGame(chainId: ChainId, game: HomeGame, now: number = Date.now()): GameCaption {
  if (chainId === 'most-played') {
    return {
      key: 'home.captionMostPlayed',
      params: { time: formatDurationText(game.playTime), count: game.playCount }
    }
  }

  if (chainId === 'recent') {
    const time = safeTime(game.lastPlayed)
    if (time === null) return { key: 'home.captionNever', params: {} }
    const days = Math.floor((now - time) / DAY_MS)
    if (days <= 0) return { key: 'home.captionToday', params: {} }
    return { key: 'home.captionDaysAgo', params: { days } }
  }

  const days = Math.floor(idleDaysOf(game, now))
  if (!game.lastPlayed) {
    return { key: 'home.captionNeverPlayed', params: { days } }
  }
  return { key: 'home.captionIdle', params: { days } }
}
