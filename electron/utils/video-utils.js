/**
 * @module VideoUtils
 * @description 「视频」页专用工具集（主进程）。
 *
 * 与 file-utils.searchMatchingFiles 的区别（重要）：
 *   searchMatchingFiles 是给「游戏文件夹里找一个 exe」设计的 —— 每个文件夹只取**第一个**匹配就停。
 *   视频库需要**全量**列出所有视频文件，因此这里独立实现完整的递归遍历。
 *
 * 提供能力：
 *   1. scanVideoRoots      —— 递归扫描多个绑定根目录，返回全部视频文件（相对路径/大小/时间戳）
 *   2. findFfmpeg          —— 定位可用的 ffmpeg（随包 → 环境变量 → PATH → 常见安装路径）
 *   3. grabRandomFrame     —— 随机抽 1 帧写成 jpg（覆盖式，固定文件名，永不膨胀）
 *   4. 覆盖式封面读写/删除  —— SaveData/videos/covers/<videoId>.jpg
 */

const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const { execFile, spawnSync } = require('child_process')
const { getResourcesRoot } = require('./app-root')

/** 默认识别的视频扩展名（全部小写、带点） */
const DEFAULT_VIDEO_EXTENSIONS = [
  '.mp4', '.mkv', '.avi', '.wmv', '.mov', '.flv', '.webm', '.m4v',
  '.mpg', '.mpeg', '.ts', '.m2ts', '.mts', '.rmvb', '.rm', '.3gp',
  '.vob', '.ogv', '.ogm', '.asf', '.f4v', '.divx', '.m2v', '.dat'
]

/** 递归时永远跳过的目录名（小写比较） */
const SKIPPED_DIR_NAMES = new Set([
  '$recycle.bin',
  'system volume information',
  '.git',
  '.svn',
  'node_modules',
  '__pycache__'
])

/** 最大递归深度，防止 junction/symlink 造成的超深目录把主进程拖死 */
const MAX_DEPTH = 48

/** 同时遍历的目录数（提高 HDD/网络盘上的吞吐） */
const DIR_CONCURRENCY = 4

/** 抽帧位置（相对时长的比例区间：避开片头黑帧与片尾字幕） */
const FRAME_RATIO_MIN = 0.05
const FRAME_RATIO_MAX = 0.85

/** 封面文件名固定为 <videoId>.jpg —— 覆盖式，避免像游戏封面那样每次生成新文件 */
const VIDEO_COVER_EXT = '.jpg'

/* -------------------------------------------------------------------------- */
/* 基础工具                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 规整扩展名数组：统一小写、补前导点、去重
 * @param {string[]|undefined} extensions
 * @returns {string[]}
 */
function normalizeExtensions(extensions) {
  const list = Array.isArray(extensions) && extensions.length > 0 ? extensions : DEFAULT_VIDEO_EXTENSIONS
  const result = []
  for (const raw of list) {
    if (typeof raw !== 'string') continue
    let ext = raw.trim().toLowerCase()
    if (!ext) continue
    if (!ext.startsWith('.')) ext = '.' + ext
    if (!result.includes(ext)) result.push(ext)
  }
  return result.length > 0 ? result : [...DEFAULT_VIDEO_EXTENSIONS]
}

/**
 * 由视频文件的**绝对路径**派生稳定的资源 ID。
 *
 * 关键设计：ID 只跟路径绑定，不跟文件内容绑定 ——
 * 这样文件被改名/删除后，旧记录会留在库里并标记为「丢失」，与游戏页的表现一致；
 * 而同一路径重新出现时 ID 不变，用户打过的标签不会丢。
 *
 * @param {string} fullPath
 * @returns {string} 形如 v1a2b3c... 的 21 位 ID
 */
function makeVideoId(fullPath) {
  const normalized = String(fullPath || '').replace(/\//g, '\\').toLowerCase()
  const hash = crypto.createHash('sha1').update(normalized).digest('hex')
  return 'v' + hash.slice(0, 20)
}

/**
 * 从文件名取出显示名（去扩展名）
 * @param {string} fileName
 */
function toDisplayName(fileName) {
  const ext = path.extname(fileName)
  return ext ? fileName.slice(0, -ext.length) : fileName
}

/* -------------------------------------------------------------------------- */
/* 递归扫描                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 扫描单个根目录，返回其中全部视频文件
 * @param {string} root 绑定根目录（绝对路径）
 * @param {string[]} extensions 小写扩展名列表
 * @returns {Promise<{root: string, ok: boolean, exists: boolean, files: Array, error?: string, skipped?: number}>}
 */
async function scanSingleRoot(root, extensions) {
  const result = { root, ok: false, exists: false, files: [], error: undefined, skipped: 0 }

  if (!root || typeof root !== 'string') {
    result.error = '无效的目录路径'
    return result
  }

  try {
    const stat = await fsp.stat(root)
    if (!stat.isDirectory()) {
      result.error = '指定路径不是文件夹'
      return result
    }
  } catch (error) {
    // 根目录本身不可用（U 盘拔了 / 网络盘掉线）：
    // 明确区分于「文件被删」，调用方据此**不要**把这些记录标记为丢失
    result.exists = false
    result.error = error.code === 'ENOENT' ? '目录不存在或未挂载' : error.message
    return result
  }

  result.exists = true

  /** @type {Array<{dir: string, depth: number}>} */
  const queue = [{ dir: root, depth: 0 }]
  const visitedDirs = new Set()

  const walk = async ({ dir, depth }) => {
    if (depth > MAX_DEPTH) {
      result.skipped++
      return
    }

    // 用真实路径去重，防止 junction / symlink 造成的环
    let realDir = dir
    try {
      realDir = await fsp.realpath(dir)
    } catch (_) {
      realDir = dir
    }
    const visitedKey = process.platform === 'win32' ? realDir.toLowerCase() : realDir
    if (visitedDirs.has(visitedKey)) {
      result.skipped++
      return
    }
    visitedDirs.add(visitedKey)

    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch (error) {
      // 单个子目录没权限不该让整次扫描失败
      result.skipped++
      return
    }

    const subDirs = []
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      let isDirectory = entry.isDirectory()
      let isFile = entry.isFile()

      // 目录联接 / 符号链接：跟随，但由 visitedDirs 兜底防环
      if (entry.isSymbolicLink()) {
        try {
          const linkStat = await fsp.stat(fullPath)
          isDirectory = linkStat.isDirectory()
          isFile = linkStat.isFile()
        } catch (_) {
          continue
        }
      }

      if (isDirectory) {
        const lowerName = entry.name.toLowerCase()
        if (SKIPPED_DIR_NAMES.has(lowerName)) continue
        subDirs.push({ dir: fullPath, depth: depth + 1 })
        continue
      }

      if (!isFile) continue

      const ext = path.extname(entry.name).toLowerCase()
      if (!extensions.includes(ext)) continue

      let fileStat
      try {
        fileStat = await fsp.stat(fullPath)
      } catch (_) {
        continue
      }

      result.files.push({
        // ID 由主进程统一生成（渲染层没有同步的哈希能力），算法见 makeVideoId
        id: makeVideoId(fullPath),
        relPath: path.relative(root, fullPath).replace(/\\/g, '/'),
        fullPath,
        rootPath: root,
        name: toDisplayName(entry.name),
        fileName: entry.name,
        ext: ext.slice(1),
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        atimeMs: fileStat.atimeMs
      })
    }

    // 宽搜：把子目录塞回队列
    for (const sub of subDirs) queue.push(sub)
  }

  // 目录级并发（不追求极致，够快且不会打满 IO）
  while (queue.length > 0) {
    const batch = queue.splice(0, DIR_CONCURRENCY)
    await Promise.all(batch.map(task => walk(task)))
  }

  result.ok = true
  return result
}

/**
 * 扫描全部绑定根目录
 * @param {string[]} roots 绑定根目录数组
 * @param {{extensions?: string[]}} [options]
 * @returns {Promise<{ok: boolean, scannedAt: string, roots: Array, totalFiles: number, extensions: string[]}>}
 */
async function scanVideoRoots(roots, options = {}) {
  const list = Array.isArray(roots) ? roots.filter(r => typeof r === 'string' && r.trim() !== '') : []
  const extensions = normalizeExtensions(options.extensions)

  if (list.length === 0) {
    return { ok: true, scannedAt: new Date().toISOString(), roots: [], totalFiles: 0, extensions }
  }

  const results = await Promise.all(list.map(root => scanSingleRoot(root, extensions)))
  const totalFiles = results.reduce((sum, item) => sum + item.files.length, 0)

  return {
    ok: true,
    scannedAt: new Date().toISOString(),
    roots: results,
    totalFiles,
    extensions
  }
}

/* -------------------------------------------------------------------------- */
/* ffmpeg 定位与抽帧                                                           */
/* -------------------------------------------------------------------------- */

/** @type {{ffmpeg: string|null, ffprobe: string|null, source: string}|null} */
let ffmpegCache = null

/**
 * 定位 ffmpeg / ffprobe。查找顺序（越快越优先）：
 *   1. 环境变量 GGV_FFMPEG_PATH
 *   2. 随包目录 <资源根>/ffmpeg/ffmpeg.exe、<资源根>/ffmpeg.exe
 *   3. 系统 PATH（where ffmpeg）
 *   4. 常见安装路径 C:\Program Files\ffmpeg\bin\ffmpeg.exe 等
 *
 * @param {{force?: boolean}} [options]
 * @returns {{ffmpeg: string|null, ffprobe: string|null, source: string}}
 */
function findFfmpeg(options = {}) {
  if (ffmpegCache && !options.force) return { ...ffmpegCache }

  const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const probeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'

  const candidates = []
  const envPath = process.env.GGV_FFMPEG_PATH
  if (envPath && typeof envPath === 'string') candidates.push({ dir: path.dirname(envPath), source: 'env' })

  try {
    const resourcesRoot = getResourcesRoot()
    candidates.push({ dir: path.join(resourcesRoot, 'ffmpeg'), source: 'bundled' })
    candidates.push({ dir: resourcesRoot, source: 'bundled' })
  } catch (_) {
    // 资源根不可用时忽略
  }

  for (const candidate of candidates) {
    const ffmpegPath = path.join(candidate.dir, exeName)
    if (fs.existsSync(ffmpegPath)) {
      const ffprobePath = path.join(candidate.dir, probeName)
      ffmpegCache = {
        ffmpeg: ffmpegPath,
        ffprobe: fs.existsSync(ffprobePath) ? ffprobePath : null,
        source: candidate.source
      }
      return { ...ffmpegCache }
    }
  }

  // 系统 PATH
  try {
    const lookup = spawnSync(process.platform === 'win32' ? 'where' : 'which', [exeName], {
      encoding: 'utf8',
      windowsHide: true
    })
    if (lookup.status === 0 && lookup.stdout) {
      const first = lookup.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)[0]
      if (first && fs.existsSync(first)) {
        const ffprobePath = path.join(path.dirname(first), probeName)
        ffmpegCache = {
          ffmpeg: first,
          ffprobe: fs.existsSync(ffprobePath) ? ffprobePath : null,
          source: 'path'
        }
        return { ...ffmpegCache }
      }
    }
  } catch (_) {
    // 忽略
  }

  // 常见安装位置（本机实测 C:\Program Files\ffmpeg\bin\ffmpeg.exe 有效）
  const commonDirs = process.platform === 'win32'
    ? [
        'C:\\Program Files\\ffmpeg\\bin',
        'C:\\Program Files (x86)\\ffmpeg\\bin',
        'C:\\ffmpeg\\bin',
        path.join(process.env.LOCALAPPDATA || '', 'ffmpeg', 'bin'),
        path.join(process.env.USERPROFILE || '', 'scoop', 'shims')
      ]
    : ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin']

  for (const dir of commonDirs) {
    if (!dir) continue
    const ffmpegPath = path.join(dir, exeName)
    if (fs.existsSync(ffmpegPath)) {
      const ffprobePath = path.join(dir, probeName)
      ffmpegCache = {
        ffmpeg: ffmpegPath,
        ffprobe: fs.existsSync(ffprobePath) ? ffprobePath : null,
        source: 'common'
      }
      return { ...ffmpegCache }
    }
  }

  ffmpegCache = { ffmpeg: null, ffprobe: null, source: 'none' }
  return { ...ffmpegCache }
}

/**
 * 用 execFile 跑一个命令，返回 { code, stdout, stderr }
 * @param {string} file
 * @param {string[]} args
 * @param {{timeout?: number}} [options]
 */
function runCommand(file, args, options = {}) {
  return new Promise(resolve => {
    let settled = false
    const done = payload => {
      if (settled) return
      settled = true
      resolve(payload)
    }

    try {
      const child = execFile(
        file,
        args,
        { windowsHide: true, timeout: options.timeout || 60000, maxBuffer: 8 * 1024 * 1024 },
        (error, stdout, stderr) => {
          done({ code: error ? (error.code ?? 1) : 0, stdout: stdout || '', stderr: stderr || '', error })
        }
      )
      child.on('error', error => done({ code: -1, stdout: '', stderr: '', error }))
    } catch (error) {
      done({ code: -1, stdout: '', stderr: '', error })
    }
  })
}

/**
 * 读取视频时长（秒）。优先 ffprobe，失败则从 ffmpeg 的 stderr 里解析 "Duration: hh:mm:ss.xx"
 * @param {string} videoPath
 * @returns {Promise<number|null>}
 */
async function probeDuration(videoPath) {
  const { ffmpeg, ffprobe } = findFfmpeg()

  if (ffprobe) {
    const result = await runCommand(ffprobe, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath
    ])
    const seconds = parseFloat(String(result.stdout).trim())
    if (Number.isFinite(seconds) && seconds > 0) return seconds
  }

  if (ffmpeg) {
    // ffmpeg -i <file> 会把元信息打到 stderr 并以「无输出文件」的非零码退出，这是预期行为
    const result = await runCommand(ffmpeg, ['-hide_banner', '-i', videoPath], { timeout: 30000 })
    const match = String(result.stderr).match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
    if (match) {
      const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
      if (Number.isFinite(seconds) && seconds > 0) return seconds
    }
  }

  return null
}

/**
 * 随机抽 1 帧写到 outFile（覆盖式）。
 *
 * 只有 ffmpeg 可用时才走这条路；任何失败都返回 ok:false，
 * 由渲染层回退到 <video>+<canvas> 方案。
 *
 * @param {string} videoPath 视频绝对路径
 * @param {string} outFile 输出 jpg 绝对路径（固定文件名，直接覆盖）
 * @param {{ratio?: number, maxWidth?: number}} [options]
 * @returns {Promise<{ok: boolean, method?: string, time?: number, size?: number, reason?: string, message?: string}>}
 */
async function grabRandomFrame(videoPath, outFile, options = {}) {
  if (!videoPath || !outFile) {
    return { ok: false, reason: 'bad-args', message: '缺少视频路径或输出路径' }
  }
  if (!fs.existsSync(videoPath)) {
    return { ok: false, reason: 'source-missing', message: '视频文件不存在' }
  }

  const { ffmpeg } = findFfmpeg()
  if (!ffmpeg) {
    return { ok: false, reason: 'no-ffmpeg', message: '未找到 ffmpeg' }
  }

  const duration = await probeDuration(videoPath)
  const ratio = typeof options.ratio === 'number' && options.ratio >= 0 && options.ratio < 1
    ? options.ratio
    : FRAME_RATIO_MIN + Math.random() * (FRAME_RATIO_MAX - FRAME_RATIO_MIN)

  // 时长未知时退化为「前 1 秒之后随便取」，总比首帧黑屏好
  const seekSeconds = duration && duration > 1 ? duration * ratio : 1

  try {
    await fsp.mkdir(path.dirname(outFile), { recursive: true })
  } catch (_) {
    // 目录已存在
  }

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-ss', seekSeconds.toFixed(3),
    '-i', videoPath,
    '-frames:v', '1',
    '-an', '-sn', '-dn'
  ]

  if (options.maxWidth && options.maxWidth > 0) {
    // 控制封面体积：宽高都按比例缩到 maxWidth 以内，且保持偶数（jpg 无所谓，但能省体积）
    args.push('-vf', `scale='min(${Math.round(options.maxWidth)},iw)':-2`)
  }
  args.push('-q:v', '3', outFile)

  const result = await runCommand(ffmpeg, args, { timeout: 120000 })

  if (result.code !== 0 || !fs.existsSync(outFile)) {
    return {
      ok: false,
      reason: 'ffmpeg-failed',
      message: String(result.stderr || result.error?.message || 'ffmpeg 执行失败').trim().slice(0, 500)
    }
  }

  let size = 0
  try {
    size = (await fsp.stat(outFile)).size
  } catch (_) {
    size = 0
  }

  if (size <= 0) {
    return { ok: false, reason: 'empty-frame', message: 'ffmpeg 未产出有效图片' }
  }

  return { ok: true, method: 'ffmpeg', time: seekSeconds, duration: duration || 0, size }
}

/* -------------------------------------------------------------------------- */
/* 覆盖式封面读写                                                              */
/* -------------------------------------------------------------------------- */

/**
 * 视频封面所在的绝对目录：<SaveData>/videos/covers
 * （与 CoverManager.RESOURCE_TYPE_TO_DIR_MAP.Video = 'videos' 保持一致）
 */
function getVideoCoverDir(saveDataDir) {
  return path.join(saveDataDir || 'SaveData', 'videos', 'covers')
}

/** 封面文件的绝对路径（固定名 <videoId>.jpg） */
function getVideoCoverFile(saveDataDir, videoId) {
  return path.join(getVideoCoverDir(saveDataDir), `${videoId}${VIDEO_COVER_EXT}`)
}

/** 存进 coverPath 的相对路径（相对 SaveData，正斜杠；绝不能带 SaveData 前缀） */
function getVideoCoverRelativePath(videoId) {
  return `videos/covers/${videoId}${VIDEO_COVER_EXT}`
}

/**
 * 把一张已存在的图片覆盖写入视频封面位置
 * @returns {Promise<{ok: boolean, coverPath?: string, file?: string, error?: string}>}
 */
async function saveVideoCoverFromFile(sourceImagePath, saveDataDir, videoId) {
  try {
    if (!sourceImagePath || !fs.existsSync(sourceImagePath)) {
      return { ok: false, error: '源图片不存在' }
    }
    const target = getVideoCoverFile(saveDataDir, videoId)
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.copyFile(sourceImagePath, target)
    return { ok: true, coverPath: getVideoCoverRelativePath(videoId), file: target }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

/**
 * 把 dataURL 覆盖写入视频封面位置（canvas 回退方案用这个）
 * @returns {Promise<{ok: boolean, coverPath?: string, file?: string, error?: string}>}
 */
async function saveVideoCoverFromDataUrl(dataUrl, saveDataDir, videoId) {
  try {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      return { ok: false, error: '无效的 dataURL' }
    }
    const base64Data = dataUrl.split(',')[1]
    if (!base64Data) return { ok: false, error: '无效的 dataURL' }
    const buffer = Buffer.from(base64Data, 'base64')
    if (buffer.length === 0) return { ok: false, error: '图片数据为空' }

    const target = getVideoCoverFile(saveDataDir, videoId)
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, buffer)
    return { ok: true, coverPath: getVideoCoverRelativePath(videoId), file: target }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

/**
 * 删除视频封面（含历史上可能留下的 <videoId>_<时间戳>.jpg 孤儿文件）
 * @returns {Promise<{ok: boolean, removed: string[], error?: string}>}
 */
async function deleteVideoCover(saveDataDir, videoId) {
  const removed = []
  try {
    const dir = getVideoCoverDir(saveDataDir)
    if (fs.existsSync(dir)) {
      const entries = await fsp.readdir(dir)
      for (const entry of entries) {
        // 精确匹配 <id>.jpg，以及旧命名 <id>_<时间戳>.jpg
        if (entry === `${videoId}${VIDEO_COVER_EXT}` || entry.startsWith(`${videoId}_`)) {
          const target = path.join(dir, entry)
          try {
            await fsp.unlink(target)
            removed.push(entry)
          } catch (_) {
            // 单个文件删不掉不影响整体
          }
        }
      }
    }
    return { ok: true, removed }
  } catch (error) {
    return { ok: false, removed, error: error.message }
  }
}

/**
 * 把「用户在文件选择框里挑的那个文件」解析成某条视频记录该有的字段值。
 *
 * 用于「重新关联到…」：文件被改名/挪走后，用户手动指认它现在是哪个文件。
 * 规则：
 *   - 必须真的存在，且是文件；
 *   - 必须落在**某个已绑定根目录内部**（否则下一次扫描又会把它标记成丢失，
 *     而且它不属于任何根目录时在页面上根本显示不出来）；
 *   - 多个根目录嵌套时取**最长匹配**那个（内层根优先）。
 *
 * @param {string[]} roots 绑定根目录
 * @param {string} filePath 用户选择的新文件路径
 * @returns {{ok: boolean, insideRoot: boolean, rootPath?: string, relPath?: string, fileName?: string, name?: string, size?: number, atimeMs?: number, error?: string}}
 */
function resolveRelinkTarget(roots, filePath) {
  const list = Array.isArray(roots) ? roots.filter(r => typeof r === 'string' && r.trim() !== '') : []

  if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
    return { ok: false, insideRoot: false, error: '没有选择文件' }
  }

  const normalize = input => path.resolve(String(input)).replace(/\//g, '\\').replace(/\\+$/, '')
  const targetNorm = normalize(filePath)
  const targetLower = targetNorm.toLowerCase()

  let stat
  try {
    stat = fs.statSync(targetNorm)
  } catch (_) {
    return { ok: false, insideRoot: false, error: '文件不存在或无法访问' }
  }
  if (!stat.isFile()) {
    return { ok: false, insideRoot: false, error: '选择的不是一个文件' }
  }

  let best = null
  for (const root of list) {
    const rootNorm = normalize(root)
    const rootLower = rootNorm.toLowerCase()
    if (targetLower === rootLower) continue // 选的是根目录本身
    if (!targetLower.startsWith(rootLower + '\\')) continue
    if (!best || rootNorm.length > best.rootPath.length) {
      best = {
        rootPath: rootNorm,
        relPath: targetNorm.slice(rootNorm.length + 1).replace(/\\/g, '/')
      }
    }
  }

  if (!best) {
    return {
      ok: false,
      insideRoot: false,
      error: '该文件不在任何已绑定文件夹内；请先绑定它所在的文件夹，再来重新关联'
    }
  }

  const fileName = path.basename(targetNorm)
  return {
    ok: true,
    insideRoot: true,
    rootPath: best.rootPath,
    relPath: best.relPath,
    fileName,
    name: toDisplayName(fileName),
    size: stat.size,
    atimeMs: stat.atimeMs
  }
}

/**
 * 批量重新关联（整夹重连）：用户指认「丢失的文件夹现在在哪」，
 * 其余文件按**内层相对路径**一一对号入座。
 *
 * 场景（主人 2026-10-05）：把 `合集A` 整个改名成 `合集A2`，
 * 里面 231 个视频的记录全变成「丢失」。逐个指认要 231 次，
 * 所以给一个"重新关联到…（这个文件夹）"：挑一次新目录，整夹一起接回来。
 *
 * 对号入座规则（**不猜内容，只按路径**）：
 *   1. 首选 `<新文件夹>/<内层相对路径>`（内层相对路径 = 旧路径去掉"丢失文件夹"那一段）；
 *   2. 首选不存在时，退一步试 `<新文件夹>/<文件名>`（用户把里面的文件摊平放到新夹时用得上）；
 *   3. 两者都不存在 → 该条报 not-found，留给用户单独处理。
 *
 * @param {string[]} roots 绑定根目录
 * @param {string} folderPath 用户选的新文件夹绝对路径
 * @param {Array<{id: string, innerRel: string, fileName?: string}>} entries
 * @returns {{ok: boolean, folderPath?: string, error?: string, results?: Array<object>}}
 */
function resolveRelinkFolderBatch(roots, folderPath, entries) {
  if (!folderPath || typeof folderPath !== 'string' || folderPath.trim() === '') {
    return { ok: false, error: '没有选择文件夹' }
  }

  const picked = path.resolve(folderPath)
  let stat
  try {
    stat = fs.statSync(picked)
  } catch (_) {
    return { ok: false, error: '文件夹不存在或无法访问' }
  }
  if (!stat.isDirectory()) {
    return { ok: false, error: '选择的不是一个文件夹' }
  }

  const list = Array.isArray(entries) ? entries : []
  const results = list.map(entry => {
    const id = entry && entry.id ? String(entry.id) : ''
    const innerRel = String((entry && entry.innerRel) || '').replace(/\\/g, '/')
    const fileName = String((entry && entry.fileName) || '')

    if (!id) return { id, ok: false, reason: 'bad-entry', message: '缺少记录 ID' }
    if (!innerRel || innerRel.split('/').some(seg => seg === '..' || seg === '')) {
      return { id, ok: false, reason: 'bad-relative-path', message: '内层相对路径不合法' }
    }

    const candidates = [path.join(picked, ...innerRel.split('/'))]
    if (fileName) {
      const fallback = path.join(picked, fileName)
      if (!candidates.includes(fallback)) candidates.push(fallback)
    }

    for (let index = 0; index < candidates.length; index++) {
      const resolved = resolveRelinkTarget(roots, candidates[index])
      if (resolved.ok) {
        return {
          id,
          ok: true,
          usedFallback: index > 0,
          path: candidates[index],
          rootPath: resolved.rootPath,
          relPath: resolved.relPath,
          fileName: resolved.fileName,
          name: resolved.name,
          size: resolved.size,
          atimeMs: resolved.atimeMs
        }
      }
    }

    return {
      id,
      ok: false,
      reason: 'not-found',
      message: `在新文件夹里找不到对应的文件：${innerRel}`,
      expected: candidates[0]
    }
  })

  return { ok: true, folderPath: picked, results }
}

module.exports = {
  DEFAULT_VIDEO_EXTENSIONS,
  FRAME_RATIO_MIN,
  FRAME_RATIO_MAX,
  VIDEO_COVER_EXT,
  normalizeExtensions,
  makeVideoId,
  toDisplayName,
  scanSingleRoot,
  scanVideoRoots,
  resolveRelinkTarget,
  resolveRelinkFolderBatch,
  findFfmpeg,
  probeDuration,
  grabRandomFrame,
  getVideoCoverDir,
  getVideoCoverFile,
  getVideoCoverRelativePath,
  saveVideoCoverFromFile,
  saveVideoCoverFromDataUrl,
  deleteVideoCover
}
