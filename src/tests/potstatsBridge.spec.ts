/**
 * PotStats 挂载（外部播放统计）测试
 *
 * 🔴 2026-10-05 起口径变了：**ini 文件是唯一事实来源**。
 *    - 事件只是"这条 ini 变了"的信号；库里写什么一律**以 ini 当前内容为准**；
 *    - **ini 不存在 → 一个字节都不写**（显示层自然就是「从未观看」，不需要清库）；
 *    - 全库对账只扫"存在 ini"的记录（没 ini 的不用管，也不用为此开几千次数据库连接）。
 *
 * 覆盖三块：
 *   1. `syncFromIni` 的写库口径（含 **UTF-8 BOM 剥离**、时间线、绝不碰 watchCount）；
 *   2. 只认库里的记录 / 只认我们的 ini；
 *   3. 子进程挂载生命周期（NDJSON 分片、exe 缺失、优雅退出）+ `sweepLibrary` 对账。
 *
 * ⚠️ 用假 sqlite + 假 fs + 假 spawn：这一层的职责是"把 ini 翻译成写库指令"。
 */

import { describe, it, expect, vi } from 'vitest'
import potStatsBridgeModule from '../../electron/services/potstats-bridge.js'

const potStatsBridge = potStatsBridgeModule as any

const FIXED_NOW = Date.parse('2026-10-05T12:00:00.000Z')

/** 与桥接内部同口径的路径归一化（测试里自己算 ini 键用） */
function key(p: string) {
  return String(p).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

/** 造一份带 BOM 的 ini 文本 —— 必须带 BOM，因为 PotStats.exe 就是这么写的 */
function iniText(fields: Record<string, string | number>) {
  const lines = ['[PotPlayer]', 'VideoFile=A.mp4']
  for (const [k, v] of Object.entries(fields)) lines.push(`${k}=${v}`)
  return '\uFEFF' + lines.join('\r\n') + '\r\n'
}

/** 假 fs：一个「路径 → 文件内容」的表 */
function makeFs(files: Record<string, string> = {}) {
  const map = new Map<string, string>()
  for (const [p, text] of Object.entries(files)) map.set(key(p), text)
  return {
    map,
    existsSync(p: string) { return map.has(key(p)) },
    readFileSync(p: string) {
      const text = map.get(key(p))
      if (text === undefined) throw new Error('ENOENT: ' + p)
      return text
    }
  }
}

/** 假 sqlite：会真的记住写入，第二次读要能读到第一次写的结果 */
function makeSqlite(records: any[]) {
  const saved: any[] = []
  const store = records.map(record => ({ ...record }))
  return {
    saved,
    store,
    async getPageData() {
      return { ok: true, data: store.map(record => ({ ...record })) }
    },
    async getResourceById(_table: string, id: string) {
      const found = store.find(record => record.id === id)
      return found ? { ...found } : null
    },
    async saveResourceToTable(table: string, payload: any) {
      saved.push({ table, ...payload })
      const index = store.findIndex(record => record.id === payload.id)
      if (index >= 0) store[index] = JSON.parse(payload.jsonData)
      return { ok: true }
    }
  }
}

function makeRecord(overrides: any = {}) {
  return {
    id: 'v1',
    resourcePath: 'D:\\Videos\\A.mp4',
    rootPath: 'D:\\Videos',
    fileName: 'A.mp4',
    tags: ['标签1', '标签2'],
    author: ['作者A'],
    coverPath: 'videos/covers/v1.jpg',
    durationSec: 39,
    watchCount: 5,
    visitedSessions: ['2026-01-01T00:00:00.000Z'],
    lastAccessSeenMs: 1000,
    timestamp: 'ts-1',
    version: 'ver-1',
    ...overrides
  }
}

const INI_PATH = 'D:\\Videos\\A.ini'

function makeBridge(options: any = {}) {
  const files = options.files || {}
  // 把 exe 也放进假 fs，好让 start() 通过"exe 存在"这一关
  const fs = makeFs({ 'C:\\fake\\PotStats.exe': '', ...files })
  const sqlite = options.sqlite || makeSqlite([makeRecord()])
  const notify = options.notify || vi.fn()
  const child = options.child || makeFakeChild()
  const bridge = potStatsBridge.createBridge({
    sqlite,
    spawn: () => child,
    fs,
    exePath: 'C:\\fake\\PotStats.exe',
    notify,
    log: () => {},
    warn: () => {},
    now: () => FIXED_NOW
  })
  return { bridge, sqlite, notify, child, fs }
}

/** 造一个假的子进程（只需要 bridge 用到的那几个成员） */
function makeFakeChild() {
  const handlers: Record<string, Function[]> = {}
  const on = (event: string, fn: Function) => {
    if (!handlers[event]) handlers[event] = []
    handlers[event].push(fn)
  }
  const child: any = {
    killed: false,
    stdinEnded: false,
    stdin: {
      end() {
        child.stdinEnded = true
        child.emit('exit', 0, null)
      }
    },
    stdout: { setEncoding() {}, on },
    stderr: { setEncoding() {}, on },
    on,
    once: on,
    kill() { child.killed = true },
    emit(event: string, ...args: any[]) {
      for (const fn of handlers[event] || []) fn(...args)
    },
    pushLine(text: string) {
      for (const fn of handlers['data'] || []) fn(text)
    }
  }
  return child
}

function sessionEvent(overrides: any = {}) {
  return {
    t: 'session',
    path: 'D:\\Videos\\A.mp4',
    reason: 'interval',
    // 故意给一组与 ini 不一致的值：用来证明**以 ini 为准**、事件里的数不被采信
    playCount: 999,
    totalSeconds: 99999,
    openTimeMs: FIXED_NOW,
    firstOpenMs: FIXED_NOW,
    lastPositionMs: 1,
    durationMs: 2,
    at: FIXED_NOW,
    ...overrides
  }
}

const flush = async () => {
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
}

/* -------------------------------------------------------------------------- */
/* 写库口径：以 ini 为准                                                        */
/* -------------------------------------------------------------------------- */

describe('PotStats 挂载 · 以 ini 为唯一事实来源', () => {
  it('ini 存在（带 BOM）→ 按 ini 写库：次数/时长/首次最后打开都来自 ini，事件里的数值被忽略', async () => {
    const { bridge, sqlite, notify } = makeBridge({
      files: {
        [INI_PATH]: iniText({
          PlayCount: 7,
          TotalPlaySeconds: 1234,
          FirstOpenTime: '2026-10-01 09:00:00',
          LastOpenTime: '2026-10-05 11:30:00',
          LastPositionMs: 45000,
          VideoDurationMs: 99999
        })
      }
    })

    const update = await bridge.handleEvent(sessionEvent())

    expect(update).toBeTruthy()
    expect(sqlite.saved).toHaveLength(1)
    expect(sqlite.saved[0].table).toBe('video')

    const json = JSON.parse(sqlite.saved[0].jsonData)

    // 🔴 以 ini 为准，不是事件里的 999 / 99999
    expect(json.potPlayerStats.source).toBe('ini')
    expect(json.potPlayerStats.playCount).toBe(7)
    expect(json.potPlayerStats.totalSeconds).toBe(1234)
    expect(json.potPlayerStats.lastPositionMs).toBe(45000)
    expect(json.potPlayerStats.durationMs).toBe(99999)

    // 本地时间字符串 → 毫秒（BOM 若没剥掉，第一行 `[PotPlayer]` 就匹配不上，这里会全为 0）
    expect(json.potPlayerStats.firstOpenMs).toBe(Date.parse('2026-10-01T09:00:00'))
    expect(json.potPlayerStats.lastOpenMs).toBe(Date.parse('2026-10-05T11:30:00'))

    // 时间线按 ini 重写成「首次 + 最后」
    expect(json.visitedSessions).toEqual([
      new Date(Date.parse('2026-10-01T09:00:00')).toISOString(),
      new Date(Date.parse('2026-10-05T11:30:00')).toISOString()
    ])
    expect(json.lastAccessSeenMs).toBe(Date.parse('2026-10-05T11:30:00'))

    // 🔴 别的东西一个都不能动
    expect(json.watchCount).toBe(5)
    expect(json.tags).toEqual(['标签1', '标签2'])
    expect(json.author).toEqual(['作者A'])
    expect(json.coverPath).toBe('videos/covers/v1.jpg')
    expect(json.timestamp).toBeUndefined()
    expect(json.version).toBeUndefined()
    expect(sqlite.saved[0].timestamp).toBe('ts-1')
    expect(sqlite.saved[0].version).toBe('ver-1')

    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toMatchObject({ type: 'potstats' })
  })

  it('🔴 **没有 ini → 一个字节都不写**（显示层自然按"从未观看"处理）', async () => {
    const { bridge, sqlite, notify } = makeBridge({ files: {} })

    expect(await bridge.handleEvent(sessionEvent())).toBeNull()

    expect(sqlite.saved).toHaveLength(0)
    expect(notify).not.toHaveBeenCalled()
  })

  it('ini 存在但不是我们的（没有 [PotPlayer] 段）→ 不写', async () => {
    const { bridge, sqlite } = makeBridge({
      files: { [INI_PATH]: '[OtherTool]\r\nSetting=1\r\n' }
    })

    expect(await bridge.handleEvent(sessionEvent())).toBeNull()
    expect(sqlite.saved).toHaveLength(0)
  })

  it('ini 内容与库里一致 → 不重复写库（幂等）', async () => {
    const fields = {
      PlayCount: 3,
      TotalPlaySeconds: 100,
      FirstOpenTime: '2026-10-01 09:00:00',
      LastOpenTime: '2026-10-05 11:30:00'
    }
    const { bridge, sqlite } = makeBridge({ files: { [INI_PATH]: iniText(fields) } })

    await bridge.handleEvent(sessionEvent())
    expect(sqlite.saved).toHaveLength(1)

    await bridge.handleEvent(sessionEvent({ reason: 'counted' }))
    expect(sqlite.saved).toHaveLength(1)   // 第二次没变化 → 不写
  })

  it('ini 里没有 FirstOpenTime → 首次打开时间回落到最后打开时间', async () => {
    const { bridge, sqlite } = makeBridge({
      files: { [INI_PATH]: iniText({ PlayCount: 1, LastOpenTime: '2026-10-05 11:30:00' }) }
    })

    await bridge.handleEvent(sessionEvent())
    const json = JSON.parse(sqlite.saved[0].jsonData)
    expect(json.potPlayerStats.firstOpenMs).toBe(Date.parse('2026-10-05T11:30:00'))
    expect(json.visitedSessions).toHaveLength(1)
  })

  it('非 session 事件（scan）只更新诊断计数，不写库', async () => {
    const { bridge, sqlite } = makeBridge({
      files: { [INI_PATH]: iniText({ PlayCount: 1, LastOpenTime: '2026-10-05 11:30:00' }) }
    })

    expect(await bridge.handleEvent({ t: 'scan', instances: 1 })).toBeNull()
    expect(await bridge.handleEvent(null)).toBeNull()
    expect(await bridge.handleEvent({ t: 'session', path: '' })).toBeNull()
    expect(sqlite.saved).toHaveLength(0)
    expect(bridge.status().scans).toBe(1)
  })
})

/* -------------------------------------------------------------------------- */
/* 只认库里的记录                                                              */
/* -------------------------------------------------------------------------- */

describe('PotStats 挂载 · 只认库里的记录', () => {
  it('库外的文件 → 不写（绝不新建记录）', async () => {
    const { bridge, sqlite } = makeBridge({
      files: { 'E:\\别处\\B.ini': iniText({ PlayCount: 1, LastOpenTime: '2026-10-05 11:30:00' }) }
    })

    expect(await bridge.handleEvent(sessionEvent({ path: 'E:\\别处\\B.mp4' }))).toBeNull()
    expect(sqlite.saved).toHaveLength(0)
  })

  it('路径大小写 / 斜杠方向不同也能对上', async () => {
    const { bridge, sqlite } = makeBridge({
      files: { 'd:/videos/a.ini': iniText({ PlayCount: 2, LastOpenTime: '2026-10-05 11:30:00' }) }
    })

    await bridge.handleEvent(sessionEvent({ path: 'd:/videos/A.mp4' }))
    expect(sqlite.saved).toHaveLength(1)
    expect(JSON.parse(sqlite.saved[0].jsonData).potPlayerStats.playCount).toBe(2)
  })

  it('写库前会重新取一条新鲜记录：渲染层刚改的标签不会被旧快照抹掉', async () => {
    const { bridge, sqlite } = makeBridge({
      files: { [INI_PATH]: iniText({ PlayCount: 1, LastOpenTime: '2026-10-05 11:30:00' }) }
    })

    await bridge.handleEvent(sessionEvent())
    sqlite.store[0].tags = ['主人刚改的标签']

    // 用同一个 sqlite 再建一个桥接（索引会重新建、拿到新标签），证明写库前取的是新鲜记录
    const fresh = potStatsBridge.createBridge({
      sqlite,
      spawn: () => makeFakeChild(),
      fs: makeFs({ [INI_PATH]: iniText({ PlayCount: 2, LastOpenTime: '2026-10-05 12:30:00' }) }),
      exePath: 'C:\\fake\\PotStats.exe',
      notify: () => {},
      log: () => {},
      warn: () => {},
      now: () => FIXED_NOW
    })
    await fresh.handleEvent(sessionEvent())

    const json = JSON.parse(sqlite.saved[sqlite.saved.length - 1].jsonData)
    expect(json.tags).toEqual(['主人刚改的标签'])
  })
})

/* -------------------------------------------------------------------------- */
/* 全库对账 sweepLibrary                                                       */
/* -------------------------------------------------------------------------- */

describe('PotStats 挂载 · ini 全库对账', () => {
  it('只同步「存在 ini」的记录；没有 ini 的记录一个字都不动', async () => {
    const records = [
      makeRecord({ id: 'v1', resourcePath: 'D:\\Videos\\A.mp4' }),
      makeRecord({ id: 'v2', resourcePath: 'D:\\Videos\\B.mp4', tags: [] })
    ]
    const { bridge, sqlite, notify } = makeBridge({
      sqlite: makeSqlite(records),
      files: { 'D:\\Videos\\A.ini': iniText({ PlayCount: 4, LastOpenTime: '2026-10-05 11:30:00' }) }
    })

    const summary = await bridge.sweepLibrary('manual')

    expect(summary.scanned).toBe(2)
    expect(summary.withIni).toBe(1)
    expect(summary.synced).toBe(1)
    expect(sqlite.saved).toHaveLength(1)
    expect(sqlite.saved[0].id).toBe('v1')
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0].updated).toHaveLength(1)
  })

  it('ini 与库里一致 → synced = 0（幂等，不会每次重扫都写一遍库）', async () => {
    const { bridge, sqlite } = makeBridge({
      sqlite: makeSqlite([makeRecord()]),
      files: { [INI_PATH]: iniText({ PlayCount: 1, LastOpenTime: '2026-10-05 11:30:00' }) }
    })

    await bridge.sweepLibrary('first')
    expect(sqlite.saved).toHaveLength(1)

    const summary = await bridge.sweepLibrary('second')
    expect(summary.synced).toBe(0)
    expect(sqlite.saved).toHaveLength(1)
  })
})

/* -------------------------------------------------------------------------- */
/* 子进程挂载生命周期                                                          */
/* -------------------------------------------------------------------------- */

describe('PotStats 挂载 · 生命周期', () => {
  it('stdout 是 NDJSON：跨分片的半行要拼回来再解析', async () => {
    const { bridge, sqlite, child } = makeBridge({
      files: { [INI_PATH]: iniText({ PlayCount: 1, LastOpenTime: '2026-10-05 11:30:00' }) }
    })
    bridge.start()

    const line = JSON.stringify(sessionEvent()) + '\n'
    child.pushLine(line.slice(0, 20))
    child.pushLine(line.slice(20))
    await flush()

    expect(sqlite.saved).toHaveLength(1)
  })

  it('无法解析的行不会打断后续事件', async () => {
    const { bridge, sqlite, child } = makeBridge({
      files: { [INI_PATH]: iniText({ PlayCount: 1, LastOpenTime: '2026-10-05 11:30:00' }) }
    })
    bridge.start()

    child.pushLine('这不是 JSON\n')
    child.pushLine(JSON.stringify(sessionEvent()) + '\n')
    await flush()

    expect(sqlite.saved).toHaveLength(1)
  })

  it('exe 不存在 → start() 返回 false，状态里记下原因', () => {
    const bridge = potStatsBridge.createBridge({
      sqlite: makeSqlite([]),
      spawn: () => makeFakeChild(),
      fs: { existsSync: () => false, readFileSync: () => { throw new Error('ENOENT') } },
      exePath: 'C:\\nope\\PotStats.exe',
      notify: () => {},
      log: () => {},
      warn: () => {}
    })

    expect(bridge.start()).toBe(false)
    expect(bridge.status().running).toBe(false)
    expect(bridge.status().lastError).toContain('不存在')
  })

  it('stop() 会关子进程的 stdin（让它先落盘再自己退出，而不是被硬杀）', async () => {
    const { bridge, child } = makeBridge({ files: {} })
    bridge.start()
    expect(bridge.status().running).toBe(true)

    await bridge.stop()
    expect(child.stdinEnded).toBe(true)
  })

  it('resolveExePath：显式路径 > 环境变量', () => {
    const backup = process.env.GGV_POTSTATS_EXE
    process.env.GGV_POTSTATS_EXE = 'C:\\custom\\PotStats.exe'
    try {
      expect(potStatsBridge.resolveExePath(null)).toBe('C:\\custom\\PotStats.exe')
      expect(potStatsBridge.resolveExePath(null, 'C:\\explicit\\P.exe')).toBe('C:\\explicit\\P.exe')
    } finally {
      if (backup === undefined) delete process.env.GGV_POTSTATS_EXE
      else process.env.GGV_POTSTATS_EXE = backup
    }
  })

  it('iniPathFor：与 PotStats.exe 的 StatsStore.IniPathFor 同口径', () => {
    expect(potStatsBridge.iniPathFor('D:\\Videos\\A.mp4')).toBe('D:\\Videos\\A.ini')
    expect(potStatsBridge.iniPathFor('D:\\Videos\\A.tar.gz.mkv')).toBe('D:\\Videos\\A.tar.gz.ini')
    expect(potStatsBridge.iniPathFor('a.mp4')).toBeNull()
  })

  it('默认参数与主人的口径一致：1s 采样 / 满 10s 计一次 / 30s 落盘', () => {
    expect(potStatsBridge.INTERVAL_MS).toBe(1000)
    expect(potStatsBridge.THRESHOLD_SECONDS).toBe(10)
    expect(potStatsBridge.FLUSH_SECONDS).toBe(30)
    expect(potStatsBridge.INI_SECTION).toBe('PotPlayer')
  })
})
