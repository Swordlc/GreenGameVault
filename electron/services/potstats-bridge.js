/**
 * @module PotStatsBridge
 * @description 「外部播放器（PotPlayer）看过」的**实测**链路。
 *
 * 把 `tools/potstats/bin/PotStats.exe`（一个走 PotPlayer **官方 IPC** 的小客户端）
 * 作为子进程挂载到应用生命周期上，实时接收它拿到的真实数据 ——
 * 播放状态（0 停 / 1 暂停 / 2 在播）、当前播放位置、当前文件路径 ——
 * 据此把「播放次数 / 累计播放时长 / 打开时间」写进 `video` 记录。
 *
 * ## 为什么取代了旧的 atime 巡检
 *
 * 旧实现（`electron/services/video-atime-monitor.js`，**已删除**）靠比对文件的
 * **最后访问时间（atime）** 来判断"外部播放器看过"。但 atime 会被**任何**一次读取刷新：
 * 磁盘装载 / 索引 / 杀毒 / 批量抽帧都会刷它 —— 主人真库实测 14 小时内就有
 * **1461 个文件**被机器批量读过（秒级间隔、还在持续变动）。拿它当"看过"本质上是**猜**。
 *
 * PotStats 走官方 IPC，拿到的是**实测值**：`PLAY_STATUS == 2` 才算在看，
 * `CURRENT_TIME` 是真实播放位置。所以「累计播放时长」能做到暂停一秒都不算。
 *
 * ## 写库口径（🔴 必须守住）
 *
 *   - **只写库里已存在的记录**：按 `resourcePath` 匹配 `videos_page` 索引，
 *     匹配不到就**什么都别做**。否则主人用 PotPlayer 随手打开任何视频，
 *     都会往库里塞一条垃圾记录。
 *   - `visitedSessions` / `lastAccessSeenMs` 由**实测的打开时刻**驱动（替代 atime）；
 *     同一个打开时刻不重复追加；每条最多保留 `MAX_VISITED_SESSIONS` 条。
 *   - **绝不碰 `watchCount`**：那是「App 内点开次数」（`useVideoLibrary.bumpOpenCount`），
 *     与「PotPlayer 播放了几次」是两个不同指标。PotPlayer 的数据写进独立的
 *     `potPlayerStats` 字段。
 *   - 整条记录原样带回去，只盖我们负责的字段 —— 标签 / 作者 / 封面 / 时长一个都不能丢。
 *
 * ## 子进程生命周期
 *
 *   - 启动：`app.whenReady()` 之后 spawn，参数 `--headless --parent-pid <我们的 pid>`；
 *     **无托盘、无窗口**，主人看不到任何多余图标。
 *   - 退出：`app.on('will-quit')` 里**先关子进程的 stdin**（它收到 EOF 会先把最后一段
 *     落盘再退出），给它一点时间，然后才 kill。这样不会丢掉最后一个落盘间隔的数据。
 *   - 兜底：`--parent-pid` 让子进程自己盯着我们；就算 GGV 崩了、来不及关 stdin，
 *     管道断开同样触发 EOF，子进程不会变成孤儿。
 */

const { spawn } = require('child_process')
const fsRoot = require('fs')
const path = require('path')

/** 单个视频最多保留多少条访问记录（与旧 atime 巡检同口径） */
const MAX_VISITED_SESSIONS = 500

/** 子进程意外退出后多久重启 */
const RESTART_DELAY_MS = 5000

/** 视频记录索引的存活时间 */
const INDEX_TTL_MS = 60 * 1000

/** 路径没命中时，至少间隔这么久才重建一次索引（防止给库外文件反复重建） */
const INDEX_MISS_RETRY_MS = 10 * 1000

/** 收尾时给子进程留多少时间把最后一段落盘 */
const SHUTDOWN_GRACE_MS = 1500

/** 启动后多久做第一次 ini 对账（给首屏加载让路） */
const SWEEP_ON_START_DELAY_MS = 15 * 1000

/** 采样 / 计数阈值 / 落盘间隔 —— 主人 2026-10-05 定的口径 */
const INTERVAL_MS = 1000
const THRESHOLD_SECONDS = 10
const FLUSH_SECONDS = 30

/** ini 段名（与 PotStats.exe 的 --ini-section 默认值一致） */
const INI_SECTION = 'PotPlayer'

/** Windows 路径归一化键（大小写不敏感 + 统一反斜杠 + 去掉尾部分隔符） */
function pathKey(input) {
  return String(input || '')
    .replace(/\//g, '\\')
    .replace(/\\+$/, '')
    .toLowerCase()
}

/**
 * 由视频路径推出同目录同名 ini 路径 —— 必须与 PotStats.exe 的 `StatsStore.IniPathFor` 一致。
 * 例：`D:\V\A.mp4` → `D:\V\A.ini`
 */
function iniPathFor(videoPath) {
  const text = String(videoPath || '')
  const match = /^(.*)[\\/]([^\\/]+?)\.[^\\/.]+$/.exec(text)
  if (!match) return null
  return match[1] + '\\' + match[2] + '.ini'
}

/**
 * 读 ini 里我们那一段。**文件不存在 / 不是我们的 ini → 返回 null。**
 *
 * ⚠️ PotStats 写的是 **UTF-8 带 BOM**，`readFileSync(..., 'utf8')` 会把 BOM 留在
 * 第一个字符上，于是 `[PotPlayer]` 变成 `\uFEFF[PotPlayer]`、段头匹配失败 —— 必须先剥掉。
 */
function readIni(iniPath, section, fsImpl) {
  const io = fsImpl || fsRoot
  let text
  try {
    text = io.readFileSync(iniPath, 'utf8')
  } catch (_) {
    return null
  }
  text = String(text).replace(/^\uFEFF/, '')

  const wanted = String(section || INI_SECTION).toLowerCase()
  const out = {}
  let inSection = false
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.charAt(0) === '[') {
      const close = line.indexOf(']')
      const name = (close > 0 ? line.slice(1, close) : line.slice(1)).trim().toLowerCase()
      inSection = name === wanted
      continue
    }
    if (!inSection) continue
    if (line.charAt(0) === ';' || line.charAt(0) === '#') continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    out[line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim()
  }

  // 连一个我们认识的键都没有 → 这不是我们的 ini，别乱认
  if (!('playcount' in out) && !('lastopentime' in out)) return null
  return out
}

/** ini 里的 `yyyy-MM-dd HH:mm:ss` 是**本地时间**；补上 T 让 Date.parse 按本地解析 */
function parseIniTimeMs(text) {
  if (!text) return 0
  const parsed = Date.parse(String(text).replace(' ', 'T'))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/** 把 ini 键值翻成库里的字段（`nowMs` 由调用方传入：本函数在模块作用域，拿不到闭包里的 now） */
function buildFromIni(record, iniRecord, nowMs) {
  const clean = { ...record }
  delete clean.timestamp
  delete clean.version

  const playCount = Number(iniRecord.playcount) || 0
  const totalSeconds = Number(iniRecord.totalplayseconds) || 0
  const lastOpenMs = parseIniTimeMs(iniRecord.lastopentime)
  const firstOpenMs = parseIniTimeMs(iniRecord.firstopentime) || lastOpenMs

  clean.potPlayerStats = {
    source: 'ini',
    playCount,
    totalSeconds,
    firstOpenMs,
    lastOpenMs,
    lastPositionMs: Number(iniRecord.lastpositionms) || 0,
    durationMs: Number(iniRecord.videodurationms) || 0,
    updatedAt: new Date(nowMs).toISOString()
  }

  // 时间线顺带按 ini 重写（首次 + 最后），保持库里数据与 ini 一致；
  // 但**显示层只认 potPlayerStats**，这个字段只是为了别的消费者不至于读到旧值。
  const sessions = []
  if (firstOpenMs > 0) sessions.push(new Date(firstOpenMs).toISOString())
  if (lastOpenMs > 0) {
    const iso = new Date(lastOpenMs).toISOString()
    if (!sessions.includes(iso)) sessions.push(iso)
  }
  clean.visitedSessions = sessions.slice(-MAX_VISITED_SESSIONS)
  clean.lastAccessSeenMs = lastOpenMs
  return clean
}

/** 三个字段是否真的变了（没变就不写库） */
function statsChanged(record, desired) {
  return JSON.stringify(record.potPlayerStats || null) !== JSON.stringify(desired.potPlayerStats || null) ||
    JSON.stringify(record.visitedSessions || []) !== JSON.stringify(desired.visitedSessions || []) ||
    (Number(record.lastAccessSeenMs) || 0) !== (Number(desired.lastAccessSeenMs) || 0)
}


/**
 * 找到 PotStats.exe。
 * 打包后它随 `build.extraFiles` 落在 exe 旁边的 `potstats/`；开发版在仓库 `tools/potstats/bin/`。
 */
function resolveExePath(app, custom) {
  if (custom) return custom
  if (process.env.GGV_POTSTATS_EXE) return process.env.GGV_POTSTATS_EXE

  const candidates = []
  try {
    if (app && app.isPackaged) {
      candidates.push(path.join(path.dirname(app.getPath('exe')), 'potstats', 'PotStats.exe'))
    }
  } catch (_) {
    /* app 不可用时忽略 */
  }
  candidates.push(path.join(__dirname, '..', '..', 'tools', 'potstats', 'bin', 'PotStats.exe'))

  for (const candidate of candidates) {
    try {
      if (fsRoot.existsSync(candidate)) return candidate
    } catch (_) {
      /* 忽略 */
    }
  }
  return candidates[candidates.length - 1] || null
}

/**
 * 造一个挂载器（依赖可注入，方便单测）
 * @param {{
 *   app?: any, exePath?: string, sqlite?: any, spawn?: Function, fs?: any,
 *   notify?: (payload: any) => void, log?: Function, warn?: Function, now?: () => number
 * }} [deps]
 */
function createBridge(deps = {}) {
  const sqlite = deps.sqlite || require('../database/sqlite')
  const spawnImpl = typeof deps.spawn === 'function' ? deps.spawn : spawn
  const fsModule = deps.fs || fsRoot
  const notify = typeof deps.notify === 'function' ? deps.notify : () => {}
  const log = typeof deps.log === 'function' ? deps.log : (...args) => console.log('[PotStats]', ...args)
  const warn = typeof deps.warn === 'function' ? deps.warn : (...args) => console.warn('[PotStats]', ...args)
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()
  const exePath = resolveExePath(deps.app, deps.exePath)

  let child = null
  let stopping = true
  let restartTimer = null
  let sweepTimer = null
  let stdoutBuffer = ''
  let queue = Promise.resolve()
  let index = null
  let indexBuiltAt = 0
  let lastMissAt = 0

  const state = {
    exePath,
    running: false,
    startedAt: 0,
    lastEventAt: 0,
    events: 0,
    scans: 0,
    written: 0,
    skipped: 0,
    restarts: 0,
    lastError: ''
  }

  /* ------------------------------ 记录索引 ------------------------------ */

  // 索引只回答两件事：「这个路径在不在视频库的**页面索引**里」和「它的 id 是多少」。
  // 真正写库前一律再 `getResourceById` 取一条**新鲜**记录 ——
  // 缓存里那份可能已经被渲染层改过（标签 / 作者 / 封面），拿旧快照去写会把主人的编辑抹掉。

  async function rebuildIndex() {
    const pageResult = await sqlite.getPageData('videos')
    const records = Array.isArray(pageResult?.data) ? pageResult.data : []
    const map = new Map()
    for (const record of records) {
      if (!record || !record.resourcePath || !record.id) continue
      map.set(pathKey(record.resourcePath), { id: String(record.id), record })
    }
    index = map
    indexBuiltAt = now()
    return map
  }

  async function ensureIndex() {
    if (index && now() - indexBuiltAt < INDEX_TTL_MS) return index
    return rebuildIndex()
  }

  /**
   * 按路径找库里的视频记录（**新鲜的那一份**）。
   * 找不到就返回 null —— 调用方必须**什么都不做**（绝不新建记录）。
   */
  async function findRecord(videoPath) {
    const key = pathKey(videoPath)
    let map = await ensureIndex()
    let entry = map.get(key)

    // 没命中：可能是刚入库、刚绑定目录，或索引过期了 —— 限频重建一次
    if (!entry && now() - lastMissAt > INDEX_MISS_RETRY_MS) {
      lastMissAt = now()
      map = await rebuildIndex()
      entry = map.get(key)
    }
    if (!entry) return null

    try {
      const fresh = await sqlite.getResourceById('video', entry.id)
      if (fresh) return fresh
    } catch (_) {
      // 取新鲜记录失败：退回索引里那份兜底。我们只写自己负责的字段，
      // 最坏是这一次的标签快照旧一点，不会丢字段。
    }
    return entry.record
  }

  /* ------------------------------ 事件处理 ------------------------------ */

  /**
   * 处理一条 PotStats 事件。
   *
   * 只认 `t === 'session'`：
   * ```
   * {"t":"session","path":"D:\\a.mp4","reason":"interval","playCount":3,
   *  "totalSeconds":117,"openTimeMs":1759900000000,"firstOpenMs":1759800000000,
   *  "lastPositionMs":8389,"durationMs":39275,"at":1759900030000}
   * ```
   *
   * @returns {Promise<null|{id: string, lastAccessSeenMs: number, visitedSessions: string[], potPlayerStats: any}>}
   */
  async function handleEvent(event) {
    if (!event || typeof event !== 'object') return null

    // scan = 子进程报告"当前有几个 PotPlayer 实例"，只用于诊断，不写库
    if (event.t === 'scan') {
      state.scans++
      state.lastEventAt = now()
      return null
    }
    if (event.t !== 'session') return null

    state.lastEventAt = now()
    state.events++

    // 🎯 ini 是**唯一事实来源**：事件只当"这条 ini 变了"的信号，
    //    库里写什么一律以 ini 的当前内容为准（不再采信事件里带的数值）。
    return syncFromIni(String(event.path || ''), 'event')
  }

  /**
   * 把某个视频的 ini 同步进库。
   *   - ini 不存在 / 不是我们的 → **什么都不做**（显示层自然按"从未观看"处理，不需要清库）
   *   - ini 存在 → 以 ini 为准写 potPlayerStats / visitedSessions / lastAccessSeenMs
   */
  async function syncFromIni(videoPath, reason) {
    if (!videoPath) return null

    const record = await findRecord(videoPath)
    if (!record) {
      state.skipped++
      warn('不在视频库里的文件，跳过（不新建记录）:', videoPath)
      return null
    }

    const iniPath = iniPathFor(videoPath)
    const iniRecord = iniPath ? readIni(iniPath, INI_SECTION, fsModule) : null
    if (!iniRecord) {
      log('没有 ini，跳过（按"从未观看"处理）:', path.basename(videoPath))
      return null
    }

    const desired = buildFromIni(record, iniRecord, now())
    if (!statsChanged(record, desired)) return null

    const result = await sqlite.saveResourceToTable('video', {
      id: desired.id,
      jsonData: JSON.stringify(desired),
      timestamp: record.timestamp,
      version: record.version
    })
    if (!result?.ok) {
      warn('写回失败:', desired.id, result?.message || '')
      return null
    }

    const update = {
      id: String(desired.id),
      lastAccessSeenMs: desired.lastAccessSeenMs,
      visitedSessions: desired.visitedSessions,
      potPlayerStats: desired.potPlayerStats
    }
    state.written++
    notify({ type: 'potstats', updated: [update], at: new Date(now()).toISOString() })

    log('已按 ini 记录:', path.basename(videoPath),
      '次数', update.potPlayerStats.playCount,
      '累计', update.potPlayerStats.totalSeconds + 's',
      '(' + reason + ')')
    return update
  }

  /**
   * 全库对账：把**已经存在 ini** 的视频同步进库（GGV 关着的时候用 PotPlayer 看过的那些）。
   *
   * 为什么只需要扫"存在 ini"的：显示与推荐**只认 `potPlayerStats`**，
   * 没有 ini 的记录本来就该显示「从未观看」—— 既不需要清库，
   * 也就不用为清理几千条历史记录去开几千次数据库连接（那会把主进程卡住）。
   * 每轮只是一次 `getPageData` + 几千次 `fs.existsSync`（毫秒级）。
   */
  async function sweepLibrary(reason = 'sweep') {
    const startedAt = now()
    const pageResult = await sqlite.getPageData('videos')
    const records = (Array.isArray(pageResult?.data) ? pageResult.data : [])
      .filter(record => record && record.resourcePath)

    let scanned = 0
    let withIni = 0
    let synced = 0
    const updated = []

    for (const record of records) {
      scanned++
      const iniPath = iniPathFor(record.resourcePath)
      if (!iniPath) continue

      let exists = false
      try { exists = fsModule.existsSync(iniPath) } catch (_) { exists = false }
      if (!exists) continue
      withIni++

      const iniRecord = readIni(iniPath, INI_SECTION, fsModule)
      if (!iniRecord) continue

      const desired = buildFromIni(record, iniRecord, now())
      if (!statsChanged(record, desired)) continue

      const result = await sqlite.saveResourceToTable('video', {
        id: desired.id,
        jsonData: JSON.stringify(desired),
        timestamp: record.timestamp,
        version: record.version
      })
      if (!result?.ok) continue

      synced++
      updated.push({
        id: String(desired.id),
        lastAccessSeenMs: desired.lastAccessSeenMs,
        visitedSessions: desired.visitedSessions,
        potPlayerStats: desired.potPlayerStats
      })
    }

    if (updated.length > 0) {
      notify({ type: 'potstats', updated, at: new Date(now()).toISOString() })
    }

    const summary = { ok: true, reason, scanned, withIni, synced, durationMs: now() - startedAt }
    log('ini 对账完成:', summary)
    return summary
  }

  /** 把子进程 stdout 的字节流按行切开，逐条送进处理队列（串行，避免并发写同一条记录） */
  function onStdoutChunk(chunk) {
    stdoutBuffer += String(chunk)
    let newlineIndex = stdoutBuffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim()
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
      if (line) enqueueLine(line)
      newlineIndex = stdoutBuffer.indexOf('\n')
    }
  }

  function enqueueLine(line) {
    let parsed = null
    try {
      parsed = JSON.parse(line)
    } catch (_) {
      log('无法解析的子进程输出:', line)
      return
    }
    queue = queue
      .then(() => handleEvent(parsed))
      .catch(error => {
        warn('处理事件失败:', error?.message || error)
        return null
      })
  }

  /* ------------------------------ 子进程 ------------------------------ */

  function spawnChild() {
    const args = [
      '--headless',
      '--parent-pid', String(process.pid),
      '--interval', String(INTERVAL_MS),
      '--threshold', String(THRESHOLD_SECONDS),
      '--flush', String(FLUSH_SECONDS)
    ]
    log('启动子进程:', exePath, args.join(' '))

    let proc
    try {
      proc = spawnImpl(exePath, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) {
      state.lastError = error?.message || String(error)
      warn('启动失败:', state.lastError)
      return
    }

    child = proc
    state.running = true
    state.startedAt = now()

    if (proc.stdout?.setEncoding) proc.stdout.setEncoding('utf8')
    if (proc.stdout?.on) proc.stdout.on('data', onStdoutChunk)
    if (proc.stderr?.setEncoding) proc.stderr.setEncoding('utf8')
    if (proc.stderr?.on) {
      proc.stderr.on('data', text => {
        const trimmed = String(text).trim()
        if (trimmed) log('[exe]', trimmed)
      })
    }
    if (proc.on) {
      proc.on('error', error => {
        state.lastError = error?.message || String(error)
        warn('子进程错误:', state.lastError)
      })
      proc.on('exit', (code, signal) => {
        if (child === proc) child = null
        state.running = false
        if (stopping) return
        state.restarts++
        log('子进程退出', { code, signal }, '将于', RESTART_DELAY_MS, 'ms 后重启')
        restartTimer = setTimeout(() => {
          restartTimer = null
          if (!stopping) spawnChild()
        }, RESTART_DELAY_MS)
        // 定时器不参与 Electron 的退出判定
        if (restartTimer.unref) restartTimer.unref()
      })
    }
  }

  /** 启动挂载（应用启动时调用一次） */
  function start() {
    stop()
    stopping = false

    if (!exePath || !fsModule.existsSync(exePath)) {
      state.running = false
      state.lastError = 'PotStats.exe 不存在: ' + exePath
      warn(state.lastError, '—— 外部播放统计本次不可用')
      return false
    }

    spawnChild()

    // GGV 关着的时候用 PotPlayer 看过的那些：ini 已经写好，但库里还没有 → 启动后补一次对账
    sweepTimer = setTimeout(() => {
      sweepTimer = null
      void sweepLibrary('startup').catch(error => warn('启动对账失败:', error?.message || error))
    }, SWEEP_ON_START_DELAY_MS)
    if (sweepTimer.unref) sweepTimer.unref()

    return true
  }

  /**
   * 停止挂载：先关 stdin 让子进程把最后一段落盘（优雅），过一会儿还没退再 kill。
   * 返回一个 Promise，`will-quit` 里可以 `event.preventDefault()` 等它。
   */
  function stop() {
    stopping = true

    if (restartTimer) {
      clearTimeout(restartTimer)
      restartTimer = null
    }
    if (sweepTimer) {
      clearTimeout(sweepTimer)
      sweepTimer = null
    }

    const proc = child
    child = null
    state.running = false
    if (!proc) return Promise.resolve()

    return new Promise(resolve => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve()
      }

      try {
        proc.once?.('exit', finish)
      } catch (_) {
        /* 忽略 */
      }

      // 关 stdin = 让它收尾（它读完 EOF 会 FlushAll 再退出）
      try {
        if (proc.stdin) proc.stdin.end()
      } catch (_) {
        /* 忽略 */
      }

      setTimeout(() => {
        try {
          if (!proc.killed) proc.kill()
        } catch (_) {
          /* 忽略 */
        }
        finish()
      }, SHUTDOWN_GRACE_MS)
    })
  }

  function status() {
    return { ...state, running: !!child && state.running }
  }

  return {
    start,
    stop,
    status,
    handleEvent,
    onStdoutChunk,
    rebuildIndex,
    findRecord,
    syncFromIni,
    sweepLibrary,
    get state() {
      return state
    }
  }
}

/* ------------------------------ 应用内的单例 ------------------------------ */

/** @type {ReturnType<typeof createBridge>|null} */
let bridge = null

/**
 * 启动后台挂载（应用启动时调用一次）
 * @param {{ app?: any, notify?: (payload: any) => void, deps?: object }} [options]
 */
function start(options = {}) {
  stop()
  bridge = createBridge({ app: options.app, notify: options.notify, ...(options.deps || {}) })
  const ok = bridge.start()
  if (ok) logSafe(() => bridge.status())
  return ok
}

/** 停止挂载（退出时调用；返回 Promise，可等它收尾） */
function stop() {
  if (!bridge) return Promise.resolve()
  const current = bridge
  bridge = null
  return current.stop()
}

/** 当前挂载状态（IPC / 诊断用） */
function getStatus() {
  if (!bridge) return { running: false, attached: false }
  return { attached: true, ...bridge.status() }
}

/** 立刻做一次 ini 全库对账（主人点「重新扫描」时走这条） */
function syncNow(reason = 'manual') {
  if (!bridge) return Promise.resolve({ ok: false, skipped: 'not-started', reason })
  return bridge.sweepLibrary(reason)
}

/**
 * 注册 IPC
 * @param {import('electron').IpcMain} ipcMain
 */
function registerIpcHandlers(ipcMain) {
  ipcMain.handle('potstats-status', () => getStatus())
  ipcMain.handle('potstats-sync', (event, payload = {}) => {
    const reason = typeof payload?.reason === 'string' && payload.reason ? payload.reason : 'manual'
    return syncNow(reason)
  })
}

function logSafe(fn) {
  try {
    const value = fn()
    console.log('[PotStats] 挂载状态:', value)
    return value
  } catch (_) {
    return null
  }
}

module.exports = {
  createBridge,
  registerIpcHandlers,
  start,
  stop,
  getStatus,
  syncNow,
  resolveExePath,
  pathKey,
  iniPathFor,
  readIni,
  buildFromIni,
  INI_SECTION,
  MAX_VISITED_SESSIONS,
  RESTART_DELAY_MS,
  INDEX_TTL_MS,
  INDEX_MISS_RETRY_MS,
  SHUTDOWN_GRACE_MS,
  SWEEP_ON_START_DELAY_MS,
  INTERVAL_MS,
  THRESHOLD_SECONDS,
  FLUSH_SECONDS
}
