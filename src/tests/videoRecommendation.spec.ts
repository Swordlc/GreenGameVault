/**
 * 视频版「抓阄链路」引擎测试
 *
 * 与游戏版共用抽签数学（`pickFromScored`），差别只有打分口径，所以这里重点钉：
 *   1. 三条链路各自的资格与排序口径；
 *   2. 固定席位 / 加权随机 / 重抽避让的行为与游戏版一致；
 *   3. 从未打开过的视频不会出现在「最常观看」里；
 *   4. toHomeVideo 对 SQLite 原始 JSON（visitedSessions / author 数组）的归一化。
 */
import { describe, it, expect } from 'vitest'
import {
  VIDEO_CHAINS,
  describeVideo,
  filterVideosByTags,
  idleDaysOfVideo,
  pickVideoChain,
  scoreVideoChain,
  toHomeVideo,
  type HomeVideo
} from '../utils/videoRecommendation'
import { DEFAULT_PINNED_SIZE, DEFAULT_ROW_SIZE } from '../utils/recommendation'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-10-04T12:00:00.000Z')

/** 造一个可复现的伪随机（和游戏版测试同款做法） */
function seededRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function makeVideo(overrides: Partial<HomeVideo> = {}): HomeVideo {
  return {
    id: 'v0',
    name: '视频',
    author: '',
    coverPath: '',
    tags: [],
    watchCount: 0,
    lastOpened: null,
    addedDate: new Date(NOW - 100 * DAY_MS).toISOString(),
    durationSec: 0,
    relPath: '',
    fileExists: true,
    ...overrides
  }
}

/** 60 个视频：序号越小 = 看得越多 / 最后打开越近 */
function makeLibrary(size = 60): HomeVideo[] {
  return Array.from({ length: size }, (_, i) => makeVideo({
    id: `v${String(i).padStart(2, '0')}`,
    name: `视频${String(i).padStart(2, '0')}`,
    watchCount: (size - i) * 2,
    lastOpened: new Date(NOW - (i + 1) * DAY_MS).toISOString(),
    tags: i % 2 === 0 ? ['合集'] : ['散片']
  }))
}

describe('toHomeVideo', () => {
  it('归一化：author 取首个；次数/最后打开**只认 ini 同步的 potPlayerStats**，不采信 raw.watchCount', () => {
    const video = toHomeVideo({
      id: 'v1',
      name: '第二部',
      author: ['某社团', '另一个人'],
      coverPath: 'videos/covers/v1.jpg',
      tags: ['教学', '', null],
      // 这两个是"旧口径"的字段：现在**不该**再被采纳
      watchCount: 3,
      visitedSessions: ['2026-01-01T00:00:00.000Z', '2026-02-02T00:00:00.000Z'],
      // ini 同步过来的才是事实来源
      potPlayerStats: {
        source: 'ini',
        playCount: 5,
        totalSeconds: 600,
        firstOpenMs: Date.parse('2026-01-01T00:00:00.000Z'),
        lastOpenMs: Date.parse('2026-02-02T00:00:00.000Z')
      },
      addedDate: '2025-12-01T00:00:00.000Z',
      durationSec: 5400,
      relPath: '子目录A/第二部.mkv'
    })

    expect(video.author).toBe('某社团')
    expect(video.lastOpened).toBe('2026-02-02T00:00:00.000Z')
    expect(video.tags).toEqual(['教学'])
    expect(video.watchCount).toBe(5)
    expect(video.durationSec).toBe(5400)
    expect(video.relPath).toBe('子目录A/第二部.mkv')
  })

  it('🔴 没有 potPlayerStats（= 没有 ini）→ 0 次 / 无最后打开：不进「最常观看 / 最近观看」', () => {
    const video = toHomeVideo({
      id: 'v9',
      name: '没看过',
      watchCount: 9,
      visitedSessions: ['2026-05-05T00:00:00.000Z']
    })

    expect(video.watchCount).toBe(0)
    expect(video.lastOpened).toBeNull()
  })

  it('缺名字时退回文件名；缺字段不会炸', () => {
    expect(toHomeVideo({ id: 'v2', fileName: 'a.mp4' }).name).toBe('a.mp4')
    expect(toHomeVideo({}).name).toBe('(未命名)')
    expect(toHomeVideo({}).fileExists).toBe(true)
  })

  it('author 为字符串时也能用', () => {
    expect(toHomeVideo({ id: 'v3', author: '单人作者' }).author).toBe('单人作者')
  })
})

describe('视频链路 1 · 最常观看', () => {
  it('只按打开次数排，且固定席位是次数最高的 3 个', () => {
    const pick = pickVideoChain(makeLibrary(), 'most-watched', { now: NOW, rng: seededRng(1) })
    expect(pick.pinnedIds).toEqual(['v00', 'v01', 'v02'])
    expect(pick.items).toHaveLength(DEFAULT_ROW_SIZE)
    expect(DEFAULT_PINNED_SIZE).toBe(3)
  })

  it('一次没看过的（watchCount = 0）永远不会出现', () => {
    const videos = [
      ...makeLibrary(30),
      makeVideo({ id: 'never-1', watchCount: 0 }),
      makeVideo({ id: 'never-2', watchCount: 0 })
    ]
    for (let seed = 0; seed < 25; seed++) {
      const pick = pickVideoChain(videos, 'most-watched', { now: NOW, rng: seededRng(seed) })
      expect(pick.items.some(item => item.id.startsWith('never'))).toBe(false)
    }
  })

  it('全都没看过 → 该链路为空（主页给「还没有看过的视频」）', () => {
    const videos = [makeVideo({ id: 'a' }), makeVideo({ id: 'b' })]
    const pick = pickVideoChain(videos, 'most-watched', { now: NOW, rng: seededRng(3) })
    expect(pick.items).toEqual([])
    expect(pick.eligibleCount).toBe(0)
  })
})

describe('视频链路 2 · 最近观看', () => {
  it('按最后打开时间倒序，固定席位是最近看的 3 个', () => {
    const pick = pickVideoChain(makeLibrary(), 'recent', { now: NOW, rng: seededRng(2) })
    expect(pick.pinnedIds).toEqual(['v00', 'v01', 'v02'])
  })

  it('从未打开过的（没有 lastOpened）不参与', () => {
    const videos = [...makeLibrary(20), makeVideo({ id: 'none', lastOpened: null, watchCount: 5 })]
    const pick = pickVideoChain(videos, 'recent', { now: NOW, rng: seededRng(4) })
    expect(pick.items.some(item => item.id === 'none')).toBe(false)
  })
})

describe('视频链路 3 · 久未观看', () => {
  it('空置天数越大越靠前；没看过的从入库日算起', () => {
    const videos = [
      makeVideo({ id: 'today', lastOpened: new Date(NOW - 2 * 3600 * 1000).toISOString() }),
      makeVideo({ id: 'week', lastOpened: new Date(NOW - 7 * DAY_MS).toISOString() }),
      makeVideo({ id: 'old', lastOpened: new Date(NOW - 90 * DAY_MS).toISOString() }),
      makeVideo({ id: 'never', lastOpened: null, addedDate: new Date(NOW - 200 * DAY_MS).toISOString() })
    ]

    expect(idleDaysOfVideo(videos[0], NOW)).toBeLessThan(1)
    expect(idleDaysOfVideo(videos[3], NOW)).toBeCloseTo(200, 5)

    const scored = scoreVideoChain(videos, 'up-next', NOW)
    expect(scored[0].item.id).toBe('never')
    expect(scored[1].item.id).toBe('old')
    expect(scored[scored.length - 1].item.id).toBe('today')
  })
})

describe('抽签行为（与游戏版共用同一套数学）', () => {
  it('前 3 名固定不变，随机位随 rng 变化', () => {
    const library = makeLibrary()
    const a = pickVideoChain(library, 'most-watched', { now: NOW, rng: seededRng(11) })
    const b = pickVideoChain(library, 'most-watched', { now: NOW, rng: seededRng(12) })

    expect(a.items.slice(0, 3).map(v => v.id)).toEqual(b.items.slice(0, 3).map(v => v.id))
    expect(a.items.map(v => v.id)).not.toEqual(b.items.map(v => v.id))
  })

  it('一行里不会有重复项，名次是「链路内第几名」且按卡片顺序递增', () => {
    const pick = pickVideoChain(makeLibrary(), 'up-next', { now: NOW, rng: seededRng(7) })
    const ids = pick.items.map(v => v.id)
    expect(new Set(ids).size).toBe(ids.length)

    // 名次是全链路排名（不是 1..8 连续）——固定席位必然是 1/2/3，其余是抽中的名次
    const ranks = pick.items.map(v => pick.rankOf[v.id])
    expect(ranks.slice(0, 3)).toEqual([1, 2, 3])
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
    expect(new Set(ranks).size).toBe(ranks.length)
    for (const rank of ranks) expect(rank).toBeGreaterThanOrEqual(1)
  })

  it('avoidIds 会让重抽尽量换掉随机位', () => {
    const library = makeLibrary()
    const first = pickVideoChain(library, 'most-watched', { now: NOW, rng: seededRng(5) })
    const second = pickVideoChain(library, 'most-watched', {
      now: NOW,
      rng: seededRng(5),
      avoidIds: first.randomIds
    })
    expect(second.randomIds).not.toEqual(first.randomIds)
  })

  it('库比一行还小时不报错，有几张给几张', () => {
    const library = [makeVideo({ id: 'a', watchCount: 1, name: 'A' }), makeVideo({ id: 'b', watchCount: 2, name: 'B' })]
    const pick = pickVideoChain(library, 'most-watched', { now: NOW, rng: seededRng(9) })
    expect(pick.items.map(v => v.id)).toEqual(['b', 'a'])
    expect(pick.poolSize).toBe(2)
  })

  it('空库返回空结果', () => {
    const pick = pickVideoChain([], 'recent', { now: NOW })
    expect(pick.items).toEqual([])
    expect(pick.rankOf).toEqual({})
  })
})

describe('标签筛选与文案', () => {
  it('标签筛选语义与游戏页一致：include 全命中、exclude 命中任一即淘汰', () => {
    const videos = makeLibrary(10)
    expect(filterVideosByTags(videos, { include: ['合集'], exclude: [] })).toHaveLength(5)
    expect(filterVideosByTags(videos, { include: [], exclude: ['合集'] })).toHaveLength(5)
    expect(filterVideosByTags(videos, { include: ['合集', '散片'], exclude: [] })).toHaveLength(0)
    expect(filterVideosByTags(videos, { include: [], exclude: [] })).toHaveLength(10)
  })

  it('三条链路的 i18n key 都是 home.* 且互不重复', () => {
    const keys = VIDEO_CHAINS.flatMap(chain => [chain.titleKey, chain.hintKey])
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) expect(key.startsWith('home.')).toBe(true)
    expect(VIDEO_CHAINS.map(chain => chain.id)).toEqual(['most-watched', 'recent', 'up-next'])
  })

  it('推荐理由：次数 / 今天 / N 天前 / 从未 / 空置', () => {
    expect(describeVideo('most-watched', makeVideo({ watchCount: 7 }), NOW))
      .toEqual({ key: 'home.captionVideoMostWatched', params: { count: 7 } })

    expect(describeVideo('recent', makeVideo({ lastOpened: null }), NOW).key).toBe('home.captionVideoNever')
    expect(describeVideo('recent', makeVideo({ lastOpened: new Date(NOW - 3600 * 1000).toISOString() }), NOW).key)
      .toBe('home.captionVideoToday')
    expect(describeVideo('recent', makeVideo({ lastOpened: new Date(NOW - 5 * DAY_MS).toISOString() }), NOW).params)
      .toEqual({ days: 5 })

    expect(describeVideo('up-next', makeVideo({ lastOpened: null, addedDate: new Date(NOW - 30 * DAY_MS).toISOString() }), NOW).key)
      .toBe('home.captionVideoNeverWatched')
    expect(describeVideo('up-next', makeVideo({ lastOpened: new Date(NOW - 30 * DAY_MS).toISOString() }), NOW).params)
      .toEqual({ days: 30 })
  })
})
