/**
 * 主页推荐链路引擎单元测试
 *
 * 重点验证主人提的三条硬性要求：
 *  1. 前 3 名是「绝对值最大」的固定席位；
 *  2. 其余名额按权重随机，越贴合主题越容易被抽中，但池内尾巴也有小概率冒头；
 *  3. 「几乎不玩 / 完全不搭边」的游戏永远不会出现在该链路里。
 */
import { describe, it, expect } from 'vitest'
import {
  toHomeGame,
  filterGamesByTags,
  collectTagOptions,
  scoreChain,
  resolvePoolSize,
  pickChain,
  idleDaysOf,
  describeGame,
  formatDurationText,
  DEFAULT_PINNED_SIZE,
  DEFAULT_ROW_SIZE,
  type HomeGame
} from '../utils/recommendation'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-01-01T00:00:00.000Z')

/** 可复现的伪随机源（mulberry32） */
function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeGame(overrides: Partial<HomeGame> & { id: string }): HomeGame {
  return {
    name: overrides.id,
    developer: '测试社',
    coverPath: '',
    tags: [],
    playTime: 0,
    playCount: 0,
    lastPlayed: null,
    addedDate: null,
    ...overrides
  }
}

/** 40 款游戏：序号越小 = 时长越长、启动越多、最后游玩越近 */
function makeLibrary(size = 40): HomeGame[] {
  return Array.from({ length: size }, (_, i) =>
    makeGame({
      id: `g${String(i).padStart(2, '0')}`,
      name: `游戏${String(i).padStart(2, '0')}`,
      tags: i % 2 === 0 ? ['3D'] : ['像素'],
      playTime: (size - i) * 3600,
      playCount: size - i,
      lastPlayed: new Date(NOW - (i + 1) * DAY_MS).toISOString(),
      addedDate: new Date(NOW - 900 * DAY_MS).toISOString()
    })
  )
}

describe('toHomeGame 归一化', () => {
  it('兼容 developers 数组 / visitedSessions 派生最后游玩时间', () => {
    const game = toHomeGame({
      id: 7,
      name: '某游戏',
      developers: ['某社', '副社'],
      tags: ['3D', '', null],
      playTime: 3600,
      visitedSessions: ['2025-01-01T00:00:00.000Z', '2025-06-01T00:00:00.000Z'],
      addedDate: '2024-01-01T00:00:00.000Z'
    })

    expect(game.id).toBe('7')
    expect(game.developer).toBe('某社')
    expect(game.tags).toEqual(['3D'])
    expect(game.lastPlayed).toBe('2025-06-01T00:00:00.000Z')
    expect(game.playTime).toBe(3600)
  })

  it('缺字段时给出安全默认值', () => {
    const game = toHomeGame({ id: 'x' })
    expect(game.name).toBe('(未命名)')
    expect(game.tags).toEqual([])
    expect(game.playTime).toBe(0)
    expect(game.lastPlayed).toBeNull()
  })
})

describe('标签全局筛选（与游戏管理页左侧标签栏同语义）', () => {
  const games = [
    makeGame({ id: 'a', tags: ['3D', '动作'] }),
    makeGame({ id: 'b', tags: ['像素', '动作'] }),
    makeGame({ id: 'c', tags: ['3D'] })
  ]

  it('无筛选条件时原样返回', () => {
    expect(filterGamesByTags(games, { include: [], exclude: [] })).toHaveLength(3)
  })

  it('多选包含标签是 AND 逻辑', () => {
    const result = filterGamesByTags(games, { include: ['3D', '动作'], exclude: [] })
    expect(result.map(g => g.id)).toEqual(['a'])
  })

  it('排除标签命中任意一个即淘汰', () => {
    const result = filterGamesByTags(games, { include: [], exclude: ['像素'] })
    expect(result.map(g => g.id)).toEqual(['a', 'c'])
  })

  it('包含 + 排除可以叠加（3D 且非像素）', () => {
    const result = filterGamesByTags(games, { include: ['3D'], exclude: ['像素'] })
    expect(result.map(g => g.id)).toEqual(['a', 'c'])
  })

  it('collectTagOptions 统计每个标签的游戏数', () => {
    expect(collectTagOptions(games)).toEqual([
      { name: '3D', count: 2 },
      { name: '动作', count: 2 },
      { name: '像素', count: 1 }
    ])
  })
})

describe('链路 1 · 最常游玩', () => {
  it('前 3 名是时长/次数绝对值最大的固定席位', () => {
    const pick = pickChain(makeLibrary(), 'most-played', { now: NOW, rng: seededRng(1) })
    expect(pick.pinnedIds).toEqual(['g00', 'g01', 'g02'])
    expect(DEFAULT_PINNED_SIZE).toBe(3)
    expect(pick.games).toHaveLength(DEFAULT_ROW_SIZE)
  })

  it('时长 0.7 + 次数 0.3：两项各自按库内最大值归一化后加权', () => {
    const games = [
      makeGame({ id: 'time-heavy', playTime: 100 * 3600, playCount: 0 }),
      makeGame({ id: 'count-heavy', playTime: 50 * 3600, playCount: 100 })
    ]
    const scored = scoreChain(games, 'most-played', NOW)
    const metricOf = (id: string) => scored.find(entry => entry.game.id === id)!.metric

    // time-heavy：时长拉满(1.0) * 0.7 + 次数为 0 = 0.7
    expect(metricOf('time-heavy')).toBeCloseTo(0.7, 6)
    // count-heavy：时长 50% * 0.7 + 次数拉满(1.0) * 0.3 = 0.65
    expect(metricOf('count-heavy')).toBeCloseTo(0.65, 6)
    // 时长权重更高 ⇒ 时长拉满者以微弱优势取胜
    expect(scored[0].game.id).toBe('time-heavy')
  })

  it('从未玩过（playTime = playCount = 0）的游戏永远不会出现', () => {
    const games = [
      ...makeLibrary(30),
      makeGame({ id: 'never-1', playTime: 0, playCount: 0 }),
      makeGame({ id: 'never-2', playTime: 0, playCount: 0 })
    ]
    for (let seed = 0; seed < 30; seed++) {
      const pick = pickChain(games, 'most-played', { now: NOW, rng: seededRng(seed) })
      expect(pick.games.some(g => g.id.startsWith('never'))).toBe(false)
      expect(pick.eligibleCount).toBe(30)
    }
  })

  it('权重生效：池内靠前的游戏出现频率显著高于池尾，且池尾仍有小概率冒头', () => {
    const games = makeLibrary(40)
    const frequency = new Map<string, number>()
    const trials = 2000
    const rng = seededRng(20260101)

    for (let i = 0; i < trials; i++) {
      const pick = pickChain(games, 'most-played', { now: NOW, rng })
      for (const id of pick.randomIds) {
        frequency.set(id, (frequency.get(id) ?? 0) + 1)
      }
    }

    const head = frequency.get('g03') ?? 0 // 固定席位之后的第 1 名
    const tail = frequency.get('g23') ?? 0 // 候选池最后一名（40 款库 → 池子 = top 24）

    expect(head).toBeGreaterThan(0)
    expect(head).toBeGreaterThan(tail * 5)
    expect(tail).toBeGreaterThan(0) // 「小概率」而不是零概率
    // 候选池以外的游戏（g24 之后）一次都不该出现
    expect(frequency.get('g24') ?? 0).toBe(0)
    expect(frequency.get('g39') ?? 0).toBe(0)
  })

  it('重新推荐时会避开与上一批完全相同的随机位', () => {
    const games = makeLibrary(40)
    const rng = seededRng(7)
    const first = pickChain(games, 'most-played', { now: NOW, rng })
    const second = pickChain(games, 'most-played', { now: NOW, rng, avoidIds: first.randomIds })
    expect([...second.randomIds].sort()).not.toEqual([...first.randomIds].sort())
  })

  it('同一 seed 结果可复现', () => {
    const games = makeLibrary(40)
    const a = pickChain(games, 'most-played', { now: NOW, rng: seededRng(99) })
    const b = pickChain(games, 'most-played', { now: NOW, rng: seededRng(99) })
    expect(a.games.map(g => g.id)).toEqual(b.games.map(g => g.id))
  })

  it('一行内不会出现重复卡片', () => {
    const games = makeLibrary(40)
    for (let seed = 0; seed < 20; seed++) {
      const pick = pickChain(games, 'most-played', { now: NOW, rng: seededRng(seed) })
      expect(new Set(pick.games.map(g => g.id)).size).toBe(pick.games.length)
    }
  })
})

describe('链路 2 · 最近游玩', () => {
  it('前 3 名是最后游玩时间最新的，且从未玩过的不参与', () => {
    const games = [
      ...makeLibrary(10),
      makeGame({ id: 'never', playTime: 100, playCount: 1, lastPlayed: null })
    ]
    const pick = pickChain(games, 'recent', { now: NOW, rng: seededRng(3) })
    expect(pick.pinnedIds).toEqual(['g00', 'g01', 'g02'])
    expect(pick.eligibleCount).toBe(10)
    expect(pick.games.some(g => g.id === 'never')).toBe(false)
  })

  it('候选池只保留最近玩过的那一批，很久没碰的不会出现', () => {
    const games = makeLibrary(60)
    const pick = pickChain(games, 'recent', { now: NOW, rng: seededRng(5) })
    expect(pick.poolSize).toBe(24)
    for (const game of pick.games) {
      const index = Number(game.id.slice(1))
      expect(index).toBeLessThan(24)
    }
  })
})

describe('链路 3 · 接下来游玩（最久未游玩）', () => {
  it('玩过的按最后游玩时间、没玩过的按添加时间，统一算空置天数', () => {
    const old = makeGame({ id: 'old', lastPlayed: new Date(NOW - 300 * DAY_MS).toISOString() })
    const fresh = makeGame({ id: 'fresh', lastPlayed: new Date(NOW - 1 * DAY_MS).toISOString() })
    const backlog = makeGame({ id: 'backlog', addedDate: new Date(NOW - 800 * DAY_MS).toISOString() })

    expect(Math.round(idleDaysOf(old, NOW))).toBe(300)
    expect(Math.round(idleDaysOf(fresh, NOW))).toBe(1)
    expect(Math.round(idleDaysOf(backlog, NOW))).toBe(800)

    const pick = pickChain([old, fresh, backlog], 'up-next', { now: NOW, rng: seededRng(11) })
    expect(pick.pinnedIds).toEqual(['backlog', 'old', 'fresh'])
  })

  it('三条链路的固定席位口径互不相同', () => {
    const games = [
      // 玩得最多，但最近没碰、也不是最久没碰
      makeGame({
        id: 'favorite',
        playTime: 500 * 3600,
        playCount: 200,
        lastPlayed: new Date(NOW - 300 * DAY_MS).toISOString(),
        addedDate: new Date(NOW - 600 * DAY_MS).toISOString()
      }),
      // 刚玩过
      makeGame({
        id: 'hot',
        playTime: 2 * 3600,
        playCount: 2,
        lastPlayed: new Date(NOW - 1 * DAY_MS).toISOString(),
        addedDate: new Date(NOW - 2 * DAY_MS).toISOString()
      }),
      // 最久没碰
      makeGame({
        id: 'forgotten',
        playTime: 3 * 3600,
        playCount: 3,
        lastPlayed: new Date(NOW - 400 * DAY_MS).toISOString(),
        addedDate: new Date(NOW - 400 * DAY_MS).toISOString()
      })
    ]

    expect(pickChain(games, 'most-played', { now: NOW, rng: seededRng(1) }).games[0].id).toBe('favorite')
    expect(pickChain(games, 'recent', { now: NOW, rng: seededRng(1) }).games[0].id).toBe('hot')
    expect(pickChain(games, 'up-next', { now: NOW, rng: seededRng(1) }).games[0].id).toBe('forgotten')
  })
})

describe('边界情况', () => {
  it('库里游戏比一行还少时全部展示且不报错', () => {
    const games = [
      makeGame({ id: 'a', playTime: 3600, playCount: 1, lastPlayed: new Date(NOW).toISOString() }),
      makeGame({ id: 'b', playTime: 60, playCount: 1, lastPlayed: new Date(NOW).toISOString() })
    ]
    const pick = pickChain(games, 'most-played', { now: NOW, rng: seededRng(1) })
    expect(pick.games.map(g => g.id)).toEqual(['a', 'b'])
    expect(pick.pinnedIds).toEqual(['a', 'b'])
    expect(pick.randomIds).toEqual([])
  })

  it('空库返回空结果', () => {
    const pick = pickChain([], 'up-next', { now: NOW })
    expect(pick.games).toEqual([])
    expect(pick.poolSize).toBe(0)
  })

  it('标签筛选后再抽签，候选集确实变小了', () => {
    const games = makeLibrary(40)
    const filtered = filterGamesByTags(games, { include: ['3D'], exclude: [] })
    const pick = pickChain(filtered, 'most-played', { now: NOW, rng: seededRng(1) })
    expect(pick.eligibleCount).toBe(20)
    expect(pick.games.every(g => g.tags.includes('3D'))).toBe(true)
  })

  it('resolvePoolSize：小库全收、大库截断但至少留 3 倍腾挪空间', () => {
    expect(resolvePoolSize(10, 8)).toBe(10)
    expect(resolvePoolSize(24, 8)).toBe(24)
    expect(resolvePoolSize(25, 8)).toBe(24)
    expect(resolvePoolSize(100, 8)).toBe(25)
    expect(resolvePoolSize(1000, 8)).toBe(60)
  })
})

describe('展示文案', () => {
  it('formatDurationText 输出紧凑人话（主页卡片窄）', () => {
    expect(formatDurationText(0)).toBe('0 秒')
    expect(formatDurationText(45)).toBe('45 秒')
    expect(formatDurationText(90)).toBe('1 分钟')
    expect(formatDurationText(2100)).toBe('35 分钟')
    expect(formatDurationText(3660)).toBe('1.0 小时')
    expect(formatDurationText(20160)).toBe('5.6 小时')
    expect(formatDurationText(82800)).toBe('23 小时')
  })

  it('三条链路各给各的推荐理由', () => {
    const game = makeGame({
      id: 'g',
      playTime: 7200,
      playCount: 12,
      lastPlayed: new Date(NOW - 5 * DAY_MS).toISOString()
    })
    expect(describeGame('most-played', game, NOW)).toEqual({
      key: 'home.captionMostPlayed',
      params: { time: '2.0 小时', count: 12 }
    })
    expect(describeGame('recent', game, NOW)).toEqual({ key: 'home.captionDaysAgo', params: { days: 5 } })
    expect(describeGame('up-next', game, NOW)).toEqual({ key: 'home.captionIdle', params: { days: 5 } })
  })

  it('从未玩过的游戏在链路 3 给出另一套文案', () => {
    const game = makeGame({ id: 'g', addedDate: new Date(NOW - 30 * DAY_MS).toISOString() })
    expect(describeGame('up-next', game, NOW)).toEqual({
      key: 'home.captionNeverPlayed',
      params: { days: 30 }
    })
  })
})
