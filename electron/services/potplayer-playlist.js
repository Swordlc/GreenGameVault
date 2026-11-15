/**
 * @module PotPlayerPlaylist
 * @description 把一批视频文件交给 **PotPlayer 的播放列表**（主人 2026-10-10 需求）。
 *
 * 背景：视频页目前只是「文件分类查看器」，选中一个标签后想连着看这一批，
 * 只能一个个拖进播放器。这个模块负责把那批文件**写成 PotPlayer 能认的播放列表**。
 *
 * ---------------------------------------------------------------------------
 * 为什么不走 IPC：官方 `InternalSimpleCmd.h` 里**只有查询类**命令
 * （音量 / 总时长 / 当前时长 / 播放状态 / 当前文件名 —— 见 tools/potstats/src/PotIpc.cs），
 * 没有任何"往播放列表里加东西"的指令。所以只能写文件 + 命令行参数。
 *
 * ---------------------------------------------------------------------------
 * `.dpl` 格式（2026-10-10 从本机 PotPlayer 26.08.19.0 的 `Playlist\*.dpl` 实测解出）：
 *
 *     EF BB BF                              ← UTF-8 BOM
 *     DAUMPLAYLIST\r\n
 *     topindex=0\r\n
 *     saveplaypos=0\r\n
 *     1*file*E:\...\a.mp4\r\n
 *     2*file*E:\...\b.mp4\r\n
 *
 * 是**纯文本**，不是二进制。PotPlayer 自己保存的列表还会多几个会话状态字段
 * （`playname` / `playtime` / `foldertype` / `workfolder` / `basefolder`），
 * 那些是"上次播到哪"的残留，不是加载列表的必需项 —— 本模块只写必需项。
 *
 * ---------------------------------------------------------------------------
 * 投放方式：**只走"写具名列表 + 交给 PotPlayer"这一条**（2026-10-10 真机实测后的决定）
 *
 *   1. `named`  —— 在 `<安装目录>\Playlist\GGV-<标签>.dpl` 写一份**具名列表**。
 *                  PotPlayer 的播放列表菜单里直接可见，重启不丢，可原地刷新。
 *                  交给它时只传这**一个**路径参数（几百个中文长路径拼命令行会爆长度上限）。
 *
 *   2. ~~覆盖默认列表文件 `<安装目录>\Playlist\<exe名>.dpl`~~ —— **实测不通，已淘汰**：
 *      那份默认列表是 PotPlayer 的**输出**，不是输入。实测（`.temp/ggv-potplayer-probe-20261010/`）：
 *
 *        | 实验 | 做法 | 关闭后默认列表 |
 *        | --- | --- | --- |
 *        | 控制 | 显式打开 A.mp4 | [F,E,D,C,B,A] ← 证明退出时会写、且会把同目录文件一起加进来 |
 *        | P3 | 先写 [B,C,D] 进默认列表 → 无参数启动 → /add E | **只有 [E]** ← 启动时根本没读那份文件 |
 *        | P1 | 把 .dpl 当参数传给它 | [C,D,E] ← 列表内容被正确加载 |
 *        | 追加性 | 列表里先有 G → 再传 .dpl | [G,C,D,E] ← **追加**，不顶掉已有的 |
 *
 *      原因是它自己的设置 `HKCU\...\PotPlayerMini64\Settings\SavePlayList = 0`（不恢复上次列表）。
 *      所以"覆盖默认列表"这件事在命令行层面**做不到**，也就没有留在代码里假装能做。
 *
 * 于是本模块对外只有一句话：**写一份具名 .dpl，然后把它的路径交给 PotPlayer（追加）。**
 *
 * 命令行参数说明（`<安装目录>\CmdLine64.txt`，官方原文）：
 *   `/add`  : 添加到播放列表的最底位置      `/current` : 在已运行的播放器里打开
 *   `/new`  : 用新的播放器实例打开          `/current` 与 `/new` 都会忽略"禁止多重执行"选项
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')

/** `.dpl` 魔数（首行） */
const DPL_HEADER = 'DAUMPLAYLIST'

/** GGV 生成的具名列表统一前缀 —— 与主人手做的 `1.SexDance.dpl` 那批区分开 */
const NAMED_PLAYLIST_PREFIX = 'GGV-'

/** 播放列表子目录名（PotPlayer 固定用它） */
const PLAYLIST_DIR_NAME = 'Playlist'

/** 探测时要找的可执行文件名（按优先级） */
const EXE_CANDIDATES = ['PotPlayerMini64.exe', 'PotPlayer64.exe', 'PotPlayerMini.exe', 'PotPlayer.exe']

/** 注册表里的卸载项键名（本机实测：HKLM\...\Uninstall\PotPlayer64） */
const REG_UNINSTALL_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PotPlayer64',
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PotPlayer32',
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PotPlayerMini64',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PotPlayer64',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PotPlayer32'
]

/* ------------------------------------------------------------------ */
/* 纯函数：命名与 .dpl 文本（这些是单测的主战场，不碰文件系统）          */
/* ------------------------------------------------------------------ */

/**
 * 把任意字符串收拾成合法的 Windows 文件名片段。
 * 去掉 `\ / : * ? " < > |`、控制字符、收尾的点与空格（Windows 不允许），并限长。
 * @param {string} raw
 * @param {number} [maxLength=80]
 * @returns {string}
 */
function sanitizePlaylistName(raw, maxLength = 80) {
  let name = String(raw == null ? '' : raw)
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  if (name.length > maxLength) name = name.slice(0, maxLength).trim()
  return name
}

/**
 * 由「当前筛选用的标签」推出播放列表文件名。
 *
 * 主人 2026-10-10 定的默认：**自动用标签名**（`GGV-拔作.dpl`），重复执行＝原地刷新同一份。
 * 多个标签时用 `等N个` 收尾，避免文件名长到没法看；没有标签（只有搜索词）时用兜底名。
 *
 * @param {string[]} tagNames 当前 include 的标签
 * @param {string} [fallback='视频'] 无标签时的兜底词（例如「搜索结果」）
 * @returns {string} 例如 `GGV-拔作.dpl`
 */
function buildNamedPlaylistFileName(tagNames, fallback = '视频') {
  const tags = (Array.isArray(tagNames) ? tagNames : [])
    .map(tag => sanitizePlaylistName(tag, 30))
    .filter(Boolean)

  let stem
  if (tags.length === 0) {
    stem = sanitizePlaylistName(fallback, 40) || '视频'
  } else if (tags.length === 1) {
    stem = tags[0]
  } else {
    stem = `${tags[0]}等${tags.length}个`
  }

  return `${NAMED_PLAYLIST_PREFIX}${stem}.dpl`
}

/**
 * 生成 `.dpl` 文本。
 *
 * ⚠️ 编码与换行必须严格：**UTF-8 BOM + CRLF**（PotPlayer 自己的文件就是这样，
 * 少了 BOM 它可能按本地代码页解，中文路径直接烂掉）。
 *
 * @param {string[]} files 视频文件的绝对路径（调用方保证存在性）
 * @returns {string}
 */
function buildDplText(files) {
  const list = (Array.isArray(files) ? files : [])
    .map(file => String(file || '').trim())
    .filter(Boolean)

  const lines = [DPL_HEADER, 'topindex=0', 'saveplaypos=0']
  list.forEach((file, index) => {
    lines.push(`${index + 1}*file*${file}`)
  })

  // '\uFEFF' 经 'utf8' 编码后就是 EF BB BF
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

/**
 * 反向解析 `.dpl`（探针与单测用：写完读回来核对，不信"写成功"三个字）。
 * @param {string} text
 * @returns {string[]}
 */
function parseDplPaths(text) {
  const raw = String(text == null ? '' : text).replace(/^\uFEFF/, '')
  const out = []
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\d+\*file\*(.*)$/.exec(line)
    if (match) out.push(match[1])
  }
  return out
}

/**
 * 过滤出磁盘上真实存在的文件。
 * 视频页里有「丢失的文件（回收站）」和 `fileExists=false` 的记录 —— 拿它们去
 * 建播放列表或复制文件只会得到一堆打不开的条目，所以一律先筛掉。
 * @param {string[]} paths
 * @returns {{ files: string[], missing: string[] }}
 */
function collectExistingFiles(paths) {
  const files = []
  const missing = []
  for (const p of Array.isArray(paths) ? paths : []) {
    const file = String(p || '').trim()
    if (!file) continue
    let ok = false
    try {
      ok = fs.statSync(file).isFile()
    } catch (_) {
      ok = false
    }
    if (ok) files.push(file)
    else missing.push(file)
  }
  return { files, missing }
}

/* ------------------------------------------------------------------ */
/* 进程与注册表探测                                                     */
/* ------------------------------------------------------------------ */

/**
 * 跑一个子进程并收下输出。
 *
 * 编码坑：`reg.exe` / `tasklist.exe` 的输出跟随**系统 ANSI/OEM 代码页**（简中是 936），
 * 直接按 utf8 解会把路径里的中文变成乱码（GBK 双字节会被拆成两个替换字符），
 * 所以这里按 buffer 收、再用 GBK 解；显式要求 UTF-8 输出（PowerShell）时才用 utf8。
 *
 * @param {string} exe
 * @param {string[]} args
 * @param {{ encoding?: 'gbk'|'utf8', timeout?: number, env?: object }} [options]
 * @returns {Promise<{ ok: boolean, stdout: string, stderr: string, error?: Error }>}
 */
function runCapture(exe, args, options = {}) {
  const { encoding = 'gbk', timeout = 8000, env } = options
  return new Promise(resolve => {
    let settled = false
    const done = payload => {
      if (settled) return
      settled = true
      resolve(payload)
    }

    try {
      execFile(exe, args, {
        windowsHide: true,
        timeout,
        maxBuffer: 16 * 1024 * 1024,
        encoding: 'buffer',
        env: env || process.env
      }, (error, stdoutBuffer, stderrBuffer) => {
        done({
          ok: !error,
          stdout: decodeBuffer(stdoutBuffer, encoding),
          stderr: decodeBuffer(stderrBuffer, encoding),
          error: error || undefined
        })
      })
    } catch (error) {
      done({ ok: false, stdout: '', stderr: '', error })
    }
  })
}

/**
 * @param {Buffer|string|null} buffer
 * @param {'gbk'|'utf8'} encoding
 * @returns {string}
 */
function decodeBuffer(buffer, encoding) {
  if (!buffer) return ''
  if (typeof buffer === 'string') return buffer
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  try {
    const label = encoding === 'gbk' ? 'gbk' : 'utf-8'
    return new TextDecoder(label, { fatal: false }).decode(bytes)
  } catch (_) {
    return bytes.toString('utf8')
  }
}

/**
 * 当前在跑的 PotPlayer 进程。
 * 用 `tasklist` 而不是 PowerShell：约 40ms vs 约 400ms，而这个查询每次操作都要做。
 * @returns {Promise<Array<{ pid: number, name: string }>>}
 */
async function listPotPlayerProcesses() {
  if (process.platform !== 'win32') return []
  const result = await runCapture('tasklist.exe', ['/FO', 'CSV', '/NH'])
  if (!result.stdout) return []

  const out = []
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = /^"([^"]+)","(\d+)"/.exec(line.trim())
    if (!match) continue
    const name = match[1]
    if (!/^PotPlayer.*\.exe$/i.test(name)) continue
    // KillPot64.exe 之类的辅助进程不算"播放器在运行"
    if (/^(KillPot|PotIcons|DTDrop)/i.test(name)) continue
    out.push({ pid: Number(match[2]), name })
  }
  return out
}

/**
 * 从注册表的卸载项里找安装目录。
 * 本机实测：`UninstallString = D:\...\PotPlayer64\uninstall.exe` → 取父目录即可。
 * @returns {Promise<string|null>} exe 绝对路径
 */
async function findExeFromRegistry() {
  if (process.platform !== 'win32') return null

  for (const key of REG_UNINSTALL_KEYS) {
    const result = await runCapture('reg.exe', ['query', key])
    if (!result.ok || !result.stdout) continue

    const values = {}
    for (const line of result.stdout.split(/\r?\n/)) {
      const match = /^\s+(\S+)\s+REG_\w+\s+(.*)$/.exec(line)
      if (match) values[match[1]] = match[2].trim()
    }

    const seeds = [values.InstallLocation, values.UninstallString, values.DisplayIcon, values.InstallDir]
    for (const seed of seeds) {
      const exe = exeFromSeed(seed)
      if (exe) return exe
    }
  }
  return null
}

/**
 * 从「目录 / exe / 带参数的卸载命令」里解出 exe 路径。
 * @param {string} seed
 * @returns {string|null}
 */
function exeFromSeed(seed) {
  if (!seed) return null
  let candidate = String(seed).trim().replace(/^"|"$/g, '')
  // 带参数的命令行（"C:\...\uninstall.exe" /S）→ 只取可执行文件那一段
  const quoted = /^"([^"]+)"/.exec(String(seed).trim())
  if (quoted) candidate = quoted[1]
  else if (/\s+\//.test(candidate)) candidate = candidate.split(/\s+\//)[0]

  candidate = candidate.replace(/,\d+$/, '') // DisplayIcon 可能带 ",0" 图标序号

  try {
    if (!fs.existsSync(candidate)) return null
    const stat = fs.statSync(candidate)
    if (stat.isDirectory()) return findExeInDir(candidate)
    if (isPotPlayerExe(candidate)) return candidate
    // 卸载程序在安装目录里 → 同目录找播放器
    return findExeInDir(path.dirname(candidate))
  } catch (_) {
    return null
  }
}

/**
 * @param {string} dir
 * @returns {string|null}
 */
function findExeInDir(dir) {
  if (!dir) return null
  for (const name of EXE_CANDIDATES) {
    const candidate = path.join(dir, name)
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch (_) {
      // 继续找下一个
    }
  }
  return null
}

/**
 * @param {string} file
 * @returns {boolean}
 */
function isPotPlayerExe(file) {
  return /^PotPlayer.*\.exe$/i.test(path.basename(String(file || '')))
}

/**
 * 兜底：从正在运行的 PotPlayer 进程里问出 exe 路径。
 * 只在注册表查不到时用（PowerShell 慢，但这条路上的机器通常很少）。
 * @returns {Promise<string|null>}
 */
async function findExeFromRunningProcess() {
  if (process.platform !== 'win32') return null
  const script = [
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
    "Get-Process | Where-Object { $_.ProcessName -like 'PotPlayer*' } | " +
      'Select-Object -ExpandProperty Path -ErrorAction SilentlyContinue | Select-Object -First 1'
  ].join('; ')
  const result = await runCapture('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8'
  })
  const line = String(result.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0]
  return line && fs.existsSync(line) ? line : null
}

/**
 * 解析出「装在哪 / 播放列表目录在哪 / 默认列表文件叫什么」。
 *
 * @param {string} [explicitPath] 设置页里主人手填的路径（exe 或目录都认；留空则自动探测）
 * @returns {Promise<{
 *   ok: boolean, message?: string, source: string, exePath: string,
 *   installDir: string, playlistDir: string, defaultPlaylistPath: string
 * }>}
 */
async function resolveInstall(explicitPath) {
  const explicit = String(explicitPath || '').trim()
  let exePath = null
  let source = ''

  if (explicit) {
    const fromExplicit = exeFromSeed(explicit)
    if (fromExplicit) {
      exePath = fromExplicit
      source = 'settings'
    } else {
      return {
        ok: false,
        source: 'settings',
        message: `设置里的 PotPlayer 路径不对：${explicit}`,
        exePath: '',
        installDir: '',
        playlistDir: '',
        defaultPlaylistPath: ''
      }
    }
  }

  if (!exePath) {
    exePath = await findExeFromRegistry()
    if (exePath) source = 'registry'
  }
  if (!exePath) {
    exePath = await findExeFromRunningProcess()
    if (exePath) source = 'process'
  }
  if (!exePath) {
    return {
      ok: false,
      source: 'none',
      message: '没有找到 PotPlayer：请在「设置 › 通用」里手动指定 PotPlayerMini64.exe 的路径',
      exePath: '',
      installDir: '',
      playlistDir: '',
      defaultPlaylistPath: ''
    }
  }

  const installDir = path.dirname(exePath)
  const playlistDir = path.join(installDir, PLAYLIST_DIR_NAME)
  const defaultPlaylistPath = path.join(playlistDir, `${path.basename(exePath, '.exe')}.dpl`)

  return { ok: true, source, exePath, installDir, playlistDir, defaultPlaylistPath }
}

/**
 * 给 UI 用的完整状态：装在哪 + 在不在跑 + 默认列表文件是哪个。
 * @param {string} [explicitPath]
 * @returns {Promise<object>}
 */
async function getInfo(explicitPath) {
  const [install, processes] = await Promise.all([
    resolveInstall(explicitPath),
    listPotPlayerProcesses()
  ])

  return {
    ...install,
    running: processes.length > 0,
    runningCount: processes.length,
    namedPlaylistPrefix: NAMED_PLAYLIST_PREFIX,
    defaultPlaylistExists: Boolean(install.defaultPlaylistPath && fs.existsSync(install.defaultPlaylistPath))
  }
}

/* ------------------------------------------------------------------ */
/* 写文件                                                              */
/* ------------------------------------------------------------------ */

/**
 * 把视频列表写进 `.dpl`。
 *
 * 具名列表放在 `Playlist\` 目录里 —— 那正是 PotPlayer「保存播放列表」的落地处，
 * 所以写完就能在它的播放列表菜单里看到，不需要任何额外注册。
 *
 * @param {string} targetPath `.dpl` 的绝对路径
 * @param {string[]} files 视频绝对路径（调用方已筛过存在性）
 * @param {{ backup?: boolean }} [options] backup=true 时把被覆盖的原文件另存一份到临时目录
 * @returns {{ ok: boolean, path?: string, count?: number, backupPath?: string|null, message?: string }}
 */
function writePlaylistFile(targetPath, files, options = {}) {
  const target = String(targetPath || '').trim()
  if (!target) return { ok: false, message: '缺少播放列表路径' }

  const list = (Array.isArray(files) ? files : []).map(f => String(f || '').trim()).filter(Boolean)
  if (list.length === 0) return { ok: false, message: '没有可写入的视频文件' }

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })

    let backupPath = null
    if (options.backup && fs.existsSync(target)) {
      try {
        backupPath = path.join(os.tmpdir(), `ggv-playlist-backup-${Date.now()}.dpl`)
        fs.copyFileSync(target, backupPath)
      } catch (_) {
        backupPath = null
      }
    }

    fs.writeFileSync(target, buildDplText(list), 'utf8')
    return { ok: true, path: target, count: list.length, backupPath }
  } catch (error) {
    return { ok: false, message: error.message || String(error) }
  }
}

/**
 * 把写好的具名列表交给 PotPlayer —— 它会被**追加**到当前播放列表末尾（实测确认）。
 *
 * 只传**一个**参数：命令行长度限制（约 32K 字符）在几百个中文长路径面前是真实约束，
 * 而传 1 个 `.dpl` 永远不会超长。`/add` 是官方语义「添加到播放列表的最底位置」。
 *
 * 列表为空时（PotPlayer 的默认状态：`SavePlayList=0`，开机不恢复上次列表）
 * 这一步就等于"新建这份播放列表"。
 *
 * @param {string} exePath
 * @param {string} dplPath
 * @returns {Promise<{ ok: boolean, message?: string, args?: string[] }>}
 */
async function openPlaylistInPotPlayer(exePath, dplPath) {
  const exe = String(exePath || '').trim()
  const dpl = String(dplPath || '').trim()
  if (!exe || !dpl) return { ok: false, message: '缺少 PotPlayer 或播放列表路径' }
  if (!fs.existsSync(exe)) return { ok: false, message: `找不到 PotPlayer：${exe}` }
  if (!fs.existsSync(dpl)) return { ok: false, message: `找不到播放列表：${dpl}` }

  // `/current` = 交给**已经在跑**的那个实例（忽略"禁止多重执行"设置）；
  // 没在跑时它自己会启动一个，不必我们判断。
  const args = [dpl, '/add', '/current']

  return new Promise(resolve => {
    try {
      const child = execFile(exe, args, { windowsHide: false, timeout: 15000 }, error => {
        // PotPlayer 是"转发给已运行实例后自己退出"的模型，非 0 退出码在这里不代表失败；
        // 真正的判据是列表文件有没有被它吃进去（真机实测见模块头部表格）。
        resolve({ ok: true, args, message: error ? error.message : undefined })
      })
      child.unref?.()
    } catch (error) {
      resolve({ ok: false, message: error.message || String(error), args })
    }
  })
}

module.exports = {
  DPL_HEADER,
  NAMED_PLAYLIST_PREFIX,
  PLAYLIST_DIR_NAME,
  sanitizePlaylistName,
  buildNamedPlaylistFileName,
  buildDplText,
  parseDplPaths,
  collectExistingFiles,
  listPotPlayerProcesses,
  resolveInstall,
  getInfo,
  writePlaylistFile,
  openPlaylistInPotPlayer,
  _internal: { exeFromSeed, findExeInDir, decodeBuffer, runCapture }
}
