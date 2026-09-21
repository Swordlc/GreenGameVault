/**
 * @module GameProcess
 * @description 管理游戏进程的启动、终止、监控和窗口控制。
 *
 * 主要功能:
 * 1. 启动游戏进程并跟踪进程信息（PID、启动时间、可执行路径、游戏名称等）。
 * 2. 监听游戏进程的退出事件，计算游戏运行时长并通知渲染进程。
 * 3. 通过可执行文件路径强制终止游戏进程。
 * 4. 通过 PID 查找游戏进程信息（包括子进程，通过进程树遍历）。
 * 5. 最小化所有正在运行的游戏窗口。
 * 6. 获取游戏进程的所有窗口标题。
 * 7. 注册与游戏进程相关的 IPC 处理器。
 *
 * 导出的函数:
 * - `getGameProcessesCount()`: 获取当前运行的游戏进程数量。
 * - `minimizeAllGameWindows()`: 最小化所有正在运行的游戏窗口。
 * - `findGameInfoByPID(pid)`: 通过 PID 查找游戏信息（包括子进程）。
 * - `registerIpcHandlers(ipcMain, getMainWindow)`: 注册 IPC 处理器。
 *
 * 内部函数:
 * - `launchGame(executablePath, gameName)`: 启动游戏进程。
 * - `terminateGame(executablePath)`: 强制终止游戏进程。
 *
 * IPC 处理器:
 * - `launch-game`: 启动游戏进程。
 * - `terminate-game`: 强制终止游戏进程。
 * - `get-all-window-titles-by-pid`: 通过 PID 获取所有窗口标题。
 *
 * 游戏进程信息结构:
 * {
 *   process: ChildProcess,      // 子进程对象
 *   startTime: number,          // 启动时间戳（毫秒）
 *   executablePath: string,     // 可执行文件路径
 *   gameName: string | null,    // 游戏名称
 *   windowTitles?: string[]     // 窗口标题列表（可选）
 * }
 */

const { spawn } = require('child_process')
const { exec } = require('child_process')
const fs = require('fs')
const path = require('path')
const { app } = require('electron')
const windowsUtils = require('../utils/windows-utils')
const fileUtils = require('../utils/file-utils')

/**
 * 解析 Windows .lnk 快捷方式，获取目标路径
 * @param {string} shortcutPath - 快捷方式路径
 * @returns {Promise<{targetPath?: string, workingDir?: string, arguments?: string}>} 解析结果
 */
async function resolveShortcut(shortcutPath) {
  return new Promise((resolve) => {
    // 使用 PowerShell 解析快捷方式
    const psScript = `
      $wshell = New-Object -ComObject WScript.Shell
      $shortcut = $wshell.CreateShortcut("${shortcutPath.replace(/"/g, '\\"')}")
      $result = @{
        TargetPath = $shortcut.TargetPath
        WorkingDirectory = $shortcut.WorkingDirectory
        Arguments = $shortcut.Arguments
      }
      $result | ConvertTo-Json
    `
    
    exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"')}"`, (error, stdout, stderr) => {
      if (error) {
        console.warn('解析快捷方式失败:', error)
        resolve({})
        return
      }
      
      try {
        const result = JSON.parse(stdout.trim())
        resolve({
          targetPath: result.TargetPath,
          workingDir: result.WorkingDirectory,
          arguments: result.Arguments
        })
      } catch (e) {
        console.warn('解析快捷方式结果失败:', e)
        resolve({})
      }
    })
  })
}

/* ============================================================================
 * 启动器（.bat / .cmd）模式相关辅助
 *
 * 背景：很多游戏是靠 .bat 启动器拉起来的（例如配汉化注入工具的
 * "与工具一同启动.bat"）。这种 bat 的真实行为是：
 *   1. 用 inject.exe 注入并启动同目录下的游戏本体 Game.exe
 *   2. 另外拉起工具 UI
 *   3. bat（cmd.exe）自己立刻退出
 * 于是「追踪 bat 自己 spawn 出来的那个 cmd.exe」会得到三个错误结果：
 * 运行时长≈0、运行状态立刻消失、中止时按 .bat 的名字/路径杀进程杀不掉。
 *
 * 解决办法（方案 A：启动器模式 + 目录认领）：
 *   启动器退出是正常的 —— 此时去 .bat 所在目录里「认领」真正的游戏进程，
 *   把被追踪的 PID 换成它，然后照旧返回给渲染层。
 * 只对 .bat / .cmd 生效，其它扩展名走原逻辑，保证零回归。
 * ========================================================================== */

/** 认领轮询总时长（毫秒） */
const LAUNCHER_ADOPT_MAX_WAIT_MS = 20000
/** 认领轮询间隔（毫秒） */
const LAUNCHER_ADOPT_POLL_INTERVAL_MS = 1000
/** 已认领进程的存活巡检间隔（毫秒） */
const ADOPTED_PROCESS_POLL_INTERVAL_MS = 5000

/**
 * 简易 sleep。
 * @param {number} ms - 毫秒
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 转义 PowerShell 单引号字符串里的单引号（' → ''）。
 * 目录必须放进单引号字符串，才能避免被 PowerShell 当成通配符/表达式解析。
 * @param {string} value - 原始字符串
 * @returns {string} 转义后的字符串
 */
function escapePowerShellSingleQuoted(value) {
  return String(value == null ? '' : value).replace(/'/g, "''")
}

/**
 * 归一化目录并补齐尾部分隔符，用于「字面量前缀」比较。
 * 补齐分隔符是为了避免 "E:\Games" 误匹配到 "E:\GamesOther\a.exe"。
 * @param {string} dir - 目录
 * @returns {string} 以分隔符结尾的绝对目录
 */
function normalizeDirectoryForPrefixMatch(dir) {
  let normalized = path.normalize(String(dir == null ? '' : dir).trim())
  if (!normalized.endsWith(path.sep) && !normalized.endsWith('/')) {
    normalized += path.sep
  }
  return normalized
}

/**
 * 🔴 安全护栏：判断某个目录是否「足够具体」，可以安全地执行「按目录清场」。
 *
 * 为什么必须有：按目录杀进程是一把大锤，一旦 executablePath 异常
 * （落到盘符根 "C:\"、系统目录、或 "C:\Games" 这种过短的无意义路径），
 * 就会把整个盘 / 系统目录下正在运行的进程全部杀掉。
 *
 * @param {string} dir - 待判断目录
 * @returns {boolean} true 表示可以安全地按目录清场
 */
function isSafeDirectoryCleanupTarget(dir) {
  if (!dir || typeof dir !== 'string') return false

  const normalized = path.normalize(dir.trim())
  if (!normalized || normalized === '.' || normalized === path.sep) return false
  // 必须是绝对路径（".\Games" 之类一律拒绝）
  if (!path.isAbsolute(normalized)) return false
  // 不能是盘符根目录："X:\" / "X:" 这种形式
  if (/^[a-zA-Z]:[\\/]?$/.test(normalized)) return false

  // 去掉尾部分隔符后长度必须 > 8，过短的路径（如 "C:\Games"）视为无意义路径
  const trimmed = normalized.replace(/[\\/]+$/, '')
  if (trimmed.length <= 8) return false

  return true
}

/**
 * 按目录枚举进程：返回「可执行文件位于指定目录（含子目录）之下」的所有进程。
 *
 * 🔴 极其重要的坑：目录名里可能含方括号，例如
 *    E:\ACG\HentaiGame\[ちっぱいどっとzip]  播种压制器
 *    PowerShell 的 -like 会把 [...] 当成「字符集通配符」，
 *    用它匹配会静默失败或误匹配。
 *    所以这里必须改用 **字面量前缀比较** StartsWith + OrdinalIgnoreCase，
 *    并把目录放进单引号字符串（单引号转义为 ''）。
 *
 * @param {string} dir - 目录
 * @returns {Promise<Array<{pid: number, name: string, path: string}>>} 进程列表（失败时返回 []）
 */
async function findProcessesUnderDirectory(dir) {
  if (!dir || typeof dir !== 'string' || !dir.trim()) {
    return []
  }

  const prefix = normalizeDirectoryForPrefixMatch(dir)
  const psPrefix = escapePowerShellSingleQuoted(prefix)

  // 注意：这里刻意不使用 -like，见上面的注释。
  // ConvertTo-Json 在「只有一个结果」时返回对象而非数组，Node 侧必须兼容两种情况。
  const psScript =
    `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ` +
    `$ErrorActionPreference = 'SilentlyContinue'; ` +
    `Get-Process -ErrorAction SilentlyContinue | ` +
    `Where-Object { $_.Path -and $_.Path.StartsWith('${psPrefix}', 'OrdinalIgnoreCase') } | ` +
    `Select-Object @{Name='pid';Expression={$_.Id}}, @{Name='name';Expression={$_.ProcessName}}, @{Name='path';Expression={$_.Path}} | ` +
    `ConvertTo-Json -Compress`

  return new Promise((resolve) => {
    exec(
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"')}"`,
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          console.warn('[DEBUG] ⚠️ 按目录枚举进程失败:', error.message)
          resolve([])
          return
        }
        if (stderr && stderr.trim()) {
          console.warn('[DEBUG] ⚠️ 按目录枚举进程 stderr:', stderr.trim())
        }

        const text = (stdout || '').trim()
        if (!text) {
          // 没有任何匹配进程
          resolve([])
          return
        }

        try {
          const parsed = JSON.parse(text)
          // ConvertTo-Json 只有一个结果时是对象，多个结果时才是数组
          const list = Array.isArray(parsed) ? parsed : [parsed]
          const result = list
            .filter((item) => item && item.pid)
            .map((item) => ({
              pid: Number(item.pid),
              name: item.name || '',
              path: item.path || ''
            }))
            .filter((item) => Number.isFinite(item.pid) && item.pid > 0)
          resolve(result)
        } catch (e) {
          console.warn('[DEBUG] ⚠️ 解析按目录枚举进程结果失败:', e.message, '原始输出:', text)
          resolve([])
        }
      }
    )
  })
}

/**
 * 判断某个 PID 是否仍然存活。
 * 用 process.kill(pid, 0) 做存在性探测，避免每次都起一个 PowerShell。
 * @param {number} pid - 进程 ID
 * @returns {boolean} true 表示进程仍然存在
 */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM：进程存在但当前进程无权限操作它 —— 依然算「活着」
    if (error && error.code === 'EPERM') return true
    return false
  }
}

/**
 * 认领启动器（.bat / .cmd）拉起的真实游戏进程。
 *
 * 轮询逻辑：
 *  - 反复调用 findProcessesUnderDirectory(gameDir)，排除启动器自己；
 *  - 优先选「有可见窗口」的候选（注入器之类的辅助进程通常没有窗口）；
 *  - 若轮询过半仍没有「有窗口」的候选，退而取目录内第一个候选
 *    （有些游戏窗口创建很慢）；
 *  - 找到立即返回，超时返回 null。
 *
 * @param {string} gameDir - 启动器所在目录
 * @param {number} launcherPid - 启动器（cmd.exe）的 PID，需要排除
 * @param {number} [maxWaitMs] - 最长等待时间
 * @returns {Promise<{pid: number, name: string, path: string, windowTitles: string[]}|null>}
 */
async function adoptLauncherGameProcess(gameDir, launcherPid, maxWaitMs) {
  const totalWaitMs = Number(maxWaitMs) > 0 ? Number(maxWaitMs) : LAUNCHER_ADOPT_MAX_WAIT_MS
  const startedAt = Date.now()
  // 轮询过半的时间点：到点后若还没有「有窗口」的候选，就回退取第一个候选
  const fallbackAt = startedAt + Math.floor(totalWaitMs / 2)
  let firstCandidate = null

  console.log(`[DEBUG] 🧷 开始认领启动器拉起的游戏进程，目录: ${gameDir}, 启动器 PID: ${launcherPid}, 最长等待 ${totalWaitMs}ms`)

  while (Date.now() - startedAt < totalWaitMs) {
    let candidates = await findProcessesUnderDirectory(gameDir)
    // 排除启动器自己（以及可能的空项）
    candidates = candidates.filter((item) => item && item.pid && item.pid !== launcherPid)

    // 优先：有可见窗口的候选就是真游戏
    for (const candidate of candidates) {
      try {
        const titles = await windowsUtils.getAllWindowTitlesByPID(candidate.pid)
        if (titles && titles.length > 0) {
          console.log(`[DEBUG] 🎯 认领成功（有窗口）: PID ${candidate.pid}, 名称 ${candidate.name}, 路径 ${candidate.path}, 窗口标题 ${JSON.stringify(titles)}`)
          return {
            pid: candidate.pid,
            name: candidate.name,
            path: candidate.path,
            windowTitles: titles
          }
        }
      } catch (e) {
        // 单个候选查询失败不影响其它候选
        console.warn(`[DEBUG] ⚠️ 查询候选进程 ${candidate.pid} 窗口标题失败:`, e.message)
      }
    }

    if (!firstCandidate && candidates.length > 0) {
      firstCandidate = candidates[0]
    }

    // 轮询过半仍没有「有窗口」的候选 → 回退取第一个目录内候选
    if (firstCandidate && Date.now() >= fallbackAt) {
      let titles = []
      try {
        titles = (await windowsUtils.getAllWindowTitlesByPID(firstCandidate.pid)) || []
      } catch (e) {
        // 忽略：没有窗口标题也可以认领
      }
      console.log(`[DEBUG] ⏳ 轮询过半仍未见「有窗口」的候选，回退认领目录内首个候选: PID ${firstCandidate.pid}, 名称 ${firstCandidate.name}, 路径 ${firstCandidate.path}`)
      return {
        pid: firstCandidate.pid,
        name: firstCandidate.name,
        path: firstCandidate.path,
        windowTitles: titles
      }
    }

    await sleep(LAUNCHER_ADOPT_POLL_INTERVAL_MS)
  }

  // 超时：如果期间见过候选，也让它兜底（等价于「轮询过半」的宽松版）
  if (firstCandidate) {
    let titles = []
    try {
      titles = (await windowsUtils.getAllWindowTitlesByPID(firstCandidate.pid)) || []
    } catch (e) {
      // 忽略
    }
    console.log(`[DEBUG] ⏳ 认领超时，回退认领目录内首个候选: PID ${firstCandidate.pid}, 名称 ${firstCandidate.name}`)
    return {
      pid: firstCandidate.pid,
      name: firstCandidate.name,
      path: firstCandidate.path,
      windowTitles: titles
    }
  }

  console.warn(`[DEBUG] ⚠️ 认领超时，目录内未找到任何候选进程: ${gameDir}`)
  return null
}

/**
 * 通过多种方式查找并终止与指定路径相关的所有进程
 * @param {string} executablePath - 可执行文件路径或快捷方式路径
 * @param {string} [gameName] - 游戏名称
 */
async function forceTerminateAllRelatedProcesses(executablePath, gameName) {
  console.log('[DEBUG] 🔍 开始查找并终止相关进程，路径:', executablePath, '名称:', gameName)
  
  const methods = []
  const targetPaths = []
  
  // 收集所有可能的目标路径
  if (executablePath) {
    targetPaths.push(executablePath)
  }
  
  // 如果是快捷方式，先解析获取真实路径
  if (executablePath && path.extname(executablePath).toLowerCase() === '.lnk') {
    try {
      const shortcutInfo = await resolveShortcut(executablePath)
      if (shortcutInfo.targetPath) {
        targetPaths.push(shortcutInfo.targetPath)
        console.log('[DEBUG] 📎 快捷方式解析成功，目标路径:', shortcutInfo.targetPath)
      }
    } catch (e) {
      console.warn('[DEBUG] ⚠️ 快捷方式解析失败:', e)
    }
  }
  
  // 方法 1: 通过可执行文件名终止（对所有路径都尝试）
  for (const targetPath of targetPaths) {
    const fileName = path.basename(targetPath, path.extname(targetPath))
    if (fileName && fileName.trim()) {
      methods.push(`Stop-Process -Name "${fileName}" -Force -ErrorAction SilentlyContinue`)
    }
  }
  
  // 方法 2: 通过完整匹配的可执行路径终止（更精确）
  for (const targetPath of targetPaths) {
    if (targetPath && targetPath.trim()) {
      const normalizedPath = targetPath.replace(/\\/g, '\\\\')
      methods.push(`Get-Process | Where-Object { $_.Path -like "*${normalizedPath}*" } | Stop-Process -Force -ErrorAction SilentlyContinue`)
    }
  }
  
  // 方法 3: 通过窗口标题查找（匹配游戏名称）
  if (gameName && gameName.trim()) {
    // 转义特殊字符
    const safeGameName = gameName.replace(/[$&+,:;=?@#|'<>.^*()%!-]/g, '\\$&')
    methods.push(`Get-Process | Where-Object { $_.MainWindowTitle -like "*${safeGameName}*" } | Stop-Process -Force -ErrorAction SilentlyContinue`)
  }
  
  // 方法 4: 启动器（.bat / .cmd）专用 —— 杀掉启动器所在目录下的所有进程。
  // 启动器只是「拉起真游戏然后自己退出」的壳，真正的游戏进程名/路径/窗口标题
  // 与 .bat 完全无关，方法 1~3 全都匹配不上，只能靠「目录归属」清场。
  if (executablePath && ['.bat', '.cmd'].includes(path.extname(executablePath).toLowerCase())) {
    const launcherDir = path.dirname(executablePath)
    // 🔴 安全护栏：只有目录「足够具体」时才允许按目录清场，
    //    否则一旦 executablePath 异常（落在盘符根 / 过短的无意义路径），
    //    会把整个盘或系统目录下的进程全部杀掉。
    if (isSafeDirectoryCleanupTarget(launcherDir)) {
      // 同样必须用 StartsWith（字面量前缀比较），不能用 -like：目录名可能含方括号
      const psDirPrefix = escapePowerShellSingleQuoted(normalizeDirectoryForPrefixMatch(launcherDir))
      console.log('[DEBUG] 🧹 目标为启动器（.bat/.cmd），追加「按目录清场」:', launcherDir)
      methods.push(`Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith('${psDirPrefix}', 'OrdinalIgnoreCase') } | Stop-Process -Force -ErrorAction SilentlyContinue`)
    } else {
      console.warn('[DEBUG] ⚠️ 启动器目录过于宽泛（可能是盘符根目录或无效短路径），已跳过「按目录清场」以保护系统进程:', launcherDir)
    }
  }

  // 组合所有方法执行
  if (methods.length > 0) {
    const combinedScript = methods.join('; ')
    console.log('[DEBUG] 🔪 执行终止命令:', combinedScript)
    
    return new Promise((resolve) => {
      exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${combinedScript.replace(/"/g, '\\"')}"`, (error, stdout, stderr) => {
        if (error) {
          console.warn('[DEBUG] ⚠️ 终止命令执行失败，但继续:', error)
        }
        if (stderr) {
          console.warn('[DEBUG] ⚠️ PowerShell stderr:', stderr)
        }
        if (stdout) {
          console.log('[DEBUG] 📝 PowerShell stdout:', stdout)
        }
        resolve()
      })
    })
  } else {
    console.log('[DEBUG] ℹ️ 没有可用的终止方法')
  }
}

// 存储游戏进程信息的 Map，键为 PID，值为游戏信息对象
const gameProcesses = new Map()

/**
 * 已认领进程的存活巡检定时器。
 * 键 = 已认领的真实游戏进程 PID，值 = { timer, executablePath }。
 *
 * 为什么需要它：认领到的进程不是我们 spawn 的，拿不到 ChildProcess 的 'exit' 事件，
 * 必须自己轮询「它还在不在」，否则游戏自然退出后记录会永远留在 gameProcesses 里。
 */
const adoptedProcessWatchers = new Map()

/**
 * 停止某个已认领进程的存活巡检。
 * @param {number} pid - 已认领进程 PID
 */
function stopAdoptedProcessWatcher(pid) {
  const watcher = adoptedProcessWatchers.get(pid)
  if (watcher && watcher.timer) {
    clearInterval(watcher.timer)
  }
  adoptedProcessWatchers.delete(pid)
}

/**
 * 启动对某个「已认领进程」的存活巡检（每 5 秒一次）。
 *
 * 说明：渲染层只能靠主进程发来的 game-process-ended 事件收尾
 * （它自己的定时巡检拿不到「进程已结束」这个信号），所以这里进程消失时
 * 必须补发一次 game-process-ended，否则运行状态会卡在「运行中」且时长不入库。
 * 发送前会双重检查该 PID 是否还在 gameProcesses 中，保证一个会话只发一次。
 *
 * @param {number} pid - 已认领进程 PID
 * @param {Object} gameInfo - gameProcesses 中的游戏信息对象
 * @param {string} executablePath - 原始可执行文件路径（渲染层按它匹配游戏）
 * @param {Function} getMainWindow - 获取主窗口的函数
 */
function startAdoptedProcessWatcher(pid, gameInfo, executablePath, getMainWindow) {
  stopAdoptedProcessWatcher(pid)

  const timer = setInterval(async () => {
    // 记录已被移除（例如用户点了「中止游戏」）→ 停止巡检，避免重复发结束事件
    if (!gameProcesses.has(pid)) {
      stopAdoptedProcessWatcher(pid)
      return
    }

    if (isProcessAlive(pid)) return

    // 二次确认（等待期间可能刚好被 terminateGame 清理掉）
    stopAdoptedProcessWatcher(pid)
    if (!gameProcesses.has(pid)) return
    gameProcesses.delete(pid)

    const playTime = Math.floor((Date.now() - gameInfo.startTime) / 1000)
    console.log(`[DEBUG] 🔴 已认领的游戏进程 ${pid} 已退出（存活巡检发现），运行时长: ${playTime} 秒`)

    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('game-process-ended', {
        pid: pid,
        playTime: playTime,
        executablePath: executablePath
      })
      console.log('[DEBUG] ✅ 已补发 game-process-ended（已认领进程自然退出）')
    }
    console.log(`[DEBUG] 🗑️ 已从 gameProcesses 中移除已认领 PID: ${pid}`)
  }, ADOPTED_PROCESS_POLL_INTERVAL_MS)

  // 定时器不应阻止 Electron 退出
  if (timer && typeof timer.unref === 'function') {
    timer.unref()
  }

  adoptedProcessWatchers.set(pid, { timer: timer, executablePath: executablePath })
}

// 应用退出时清掉所有已认领进程的巡检定时器，避免残留
app.on('will-quit', () => {
  if (adoptedProcessWatchers.size === 0) return
  console.log(`[DEBUG] 🧹 应用退出，清理 ${adoptedProcessWatchers.size} 个已认领进程巡检定时器`)
  for (const pid of Array.from(adoptedProcessWatchers.keys())) {
    stopAdoptedProcessWatcher(pid)
  }
})

/**
 * 加载设置文件
 * @returns {Promise<Object|null>} 设置对象，如果加载失败则返回null
 */
async function loadSettings() {
  try {
    // 获取当前文件所在目录（public/js/services/）
    const currentDir = __dirname
    // 获取应用根目录（public/）
    const publicDir = path.join(currentDir, '../..')
    // 获取项目根目录（green-resources-manager/）
    const projectRoot = path.join(publicDir, '..')
    
    // 可能的设置文件路径
    const possibleSettingsPaths = [
      path.join(projectRoot, 'SaveData', 'Settings', 'settings.json'),
      path.join(publicDir, '..', 'SaveData', 'Settings', 'settings.json'),
      path.join(process.cwd(), 'SaveData', 'Settings', 'settings.json')
    ]
    
    for (const settingsPath of possibleSettingsPaths) {
      try {
        const normalizedPath = path.normalize(settingsPath)
        if (fs.existsSync(normalizedPath)) {
          const result = await fileUtils.readJsonFile(normalizedPath)
          if (result.success && result.data && result.data.settings) {
            console.log('✅ 成功加载设置文件:', normalizedPath)
            return result.data.settings
          }
        }
      } catch (error) {
        continue
      }
    }
    
    console.warn('⚠️ 未找到设置文件，使用默认设置')
    return null
  } catch (error) {
    console.error('加载设置文件失败:', error)
    return null
  }
}

/**
 * 查找 Ruffle 可执行文件路径
 * @returns {Promise<string|null>} Ruffle 路径，如果未找到则返回null
 */
async function findRufflePath() {
  try {
    // 获取当前文件所在目录（public/js/services/）
    const currentDir = __dirname
    // 获取项目根目录（开发环境）
    const projectRoot = path.join(currentDir, '../../..')
    
    // 判断是否为打包环境
    const isPackaged = app.isPackaged
    
    // 获取应用安装根目录
    let appRootPath
    if (isPackaged) {
      // 打包环境：extraFiles 会将文件放到应用安装根目录（可执行文件所在目录）
      // process.execPath 是可执行文件的路径，其目录就是应用安装根目录
      appRootPath = path.dirname(process.execPath)
      console.log('🔍 查找 Ruffle（打包环境）')
      console.log('  可执行文件路径:', process.execPath)
      console.log('  应用根目录:', appRootPath)
    } else {
      // 开发环境：使用项目根目录
      appRootPath = projectRoot
      console.log('🔍 查找 Ruffle（开发环境）')
      console.log('  项目根目录:', appRootPath)
    }
    
    // 可能的 Ruffle 路径（按优先级排序）
    // 注意：打包后，extraFiles 会将文件放到应用安装根目录下的 third-party/ 目录
    const possiblePaths = []
    
    if (isPackaged) {
      // 打包环境的路径
      possiblePaths.push(
        // 应用安装根目录/third-party/ruffle-nightly-2025_12_20-windows-x86_64/ruffle.exe
        path.join(appRootPath, 'third-party', 'ruffle-nightly-2025_12_20-windows-x86_64', 'ruffle.exe'),
        // 备用路径：尝试在 resources 同级目录查找（某些打包配置可能不同）
        path.join(path.dirname(app.getAppPath()), '..', 'third-party', 'ruffle-nightly-2025_12_20-windows-x86_64', 'ruffle.exe')
      )
    } else {
      // 开发环境的路径
      possiblePaths.push(
        // src/third-party/ruffle-nightly-2025_12_20-windows-x86_64/ruffle.exe
        path.join(appRootPath, 'src', 'third-party', 'ruffle-nightly-2025_12_20-windows-x86_64', 'ruffle.exe')
      )
    }

    // 检查每个路径
    for (const rufflePath of possiblePaths) {
      try {
        const normalizedPath = path.normalize(rufflePath)
        console.log('  📂 检查路径:', normalizedPath)
        if (fs.existsSync(normalizedPath)) {
          console.log('✅ 找到 Ruffle:', normalizedPath)
          return normalizedPath
        }
      } catch (error) {
        // 忽略路径错误，继续查找下一个
        console.log('  ⚠️ 路径检查失败:', error.message)
        continue
      }
    }

    console.warn('⚠️ 未找到 Ruffle 可执行文件')
    console.warn('已检查的路径:', possiblePaths.map(p => path.normalize(p)))
    return null
  } catch (error) {
    console.error('❌ 查找 Ruffle 路径时出错:', error)
    return null
  }
}

/**
 * 获取当前运行的游戏进程数量。
 * @returns {number} 游戏进程数量。
 */
function getGameProcessesCount() {
  return gameProcesses.size
}

/**
 * 通过 PID 查找对应的游戏信息（包括子进程）。
 * 如果直接匹配失败，会通过向上遍历进程树来查找父进程。
 * @param {number} pid - 进程 ID。
 * @returns {Promise<Object|null>} 游戏信息对象或 null。
 */
async function findGameInfoByPID(pid) {
  // 首先检查直接匹配
  if (gameProcesses.has(pid)) {
    return gameProcesses.get(pid)
  }

  // 如果不是直接匹配，检查是否是某个游戏进程的子进程
  // 通过向上遍历进程树来查找
  let currentPid = pid
  const maxDepth = 10 // 防止无限循环
  let depth = 0

  try {
    while (depth < maxDepth) {
      // 获取当前进程的父进程 PID
      const parentPid = await windowsUtils.getParentProcessID(currentPid)

      // 检查父进程是否在我们的游戏进程列表中
      if (gameProcesses.has(parentPid)) {
        console.log(`✅ 通过进程树匹配到游戏: PID ${pid} 是游戏进程 ${parentPid} 的子进程`)
        return gameProcesses.get(parentPid)
      }

      // 如果父进程是系统进程（PID < 100），停止查找
      if (parentPid < 100) {
        break
      }

      currentPid = parentPid
      depth++
    }
  } catch (error) {
    // 如果获取父进程失败，返回 null
    console.warn('检查进程树时出错:', error.message)
    return null
  }

  return null
}

/**
 * 启动游戏进程。
 * @param {string} executablePath - 游戏可执行文件路径。
 * @param {string|null} gameName - 游戏名称。
 * @param {Function} getMainWindow - 获取主窗口的函数。
 * @returns {Promise<{success: boolean, pid?: number, windowTitles?: string[], error?: string}>} 启动结果。
 */
async function launchGame(executablePath, gameName, getMainWindow) {
  try {
    console.log('启动游戏:', executablePath, '游戏名称:', gameName)

    // 检查文件是否存在
    if (!fs.existsSync(executablePath)) {
      throw new Error('游戏文件不存在')
    }

    // 检查是否为Flash游戏（.swf文件）或快捷方式（.lnk）
    const fileExt = path.extname(executablePath).toLowerCase()
    const isFlashGame = fileExt === '.swf'
    const isShortcut = fileExt === '.lnk'
    // 启动器模式：.bat / .cmd 只是「拉起游戏本体后自己退出」的壳（常见于汉化注入工具），
    // 需要额外做「目录认领」。其它扩展名一律走原逻辑，保证零回归。
    const isLauncher = fileExt === '.bat' || fileExt === '.cmd'

    // 启动器模式下的认领状态：
    //   'not-launcher' 非启动器（原逻辑）
    //   'pending'      启动器已启动，尚未判定认领结果
    //   'adopted'      已认领到真实游戏进程
    //   'failed'       认领失败，已按旧行为收尾
    let launcherAdoptionState = isLauncher ? 'pending' : 'not-launcher'
    // 实际被追踪的 PID：启动器模式下会从 cmd.exe 换成真正的游戏进程
    let trackedPid = null

    let gameProcess
    let actualExecutablePath = executablePath

    if (isFlashGame) {
      // Flash游戏：根据设置选择播放器
      console.log('🎮 检测到Flash游戏')
      
      // 加载设置
      const settings = await loadSettings()
      const useBuiltInFlashPlayer = settings?.useBuiltInFlashPlayer !== false // 默认为true
      const customFlashPlayerPath = settings?.customFlashPlayerPath || ''
      
      let flashPlayerPath = null
      
      if (useBuiltInFlashPlayer) {
        // 使用内置 Ruffle
        console.log('📦 使用内置 Flash 播放器 (Ruffle)')
        flashPlayerPath = await findRufflePath()
        if (!flashPlayerPath) {
          throw new Error('未找到内置 Ruffle。请确保 Ruffle 已正确安装到 third-party 目录。')
        }
      } else {
        // 使用自定义播放器
        console.log('🔧 使用自定义 Flash 播放器')
        if (!customFlashPlayerPath || customFlashPlayerPath.trim() === '') {
          // 通知主窗口显示错误（通过返回错误信息）
          const mainWindow = getMainWindow()
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('flash-player-error', {
              type: 'no-path',
              message: '已选择使用自定义 Flash 播放器，但未指定播放器路径。请在设置中配置自定义播放器路径。'
            })
          }
          throw new Error('未指定自定义 Flash 播放器路径。请在设置中配置。')
        }
        
        // 验证自定义播放器路径
        if (!fs.existsSync(customFlashPlayerPath)) {
          const mainWindow = getMainWindow()
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('flash-player-error', {
              type: 'path-not-found',
              message: `自定义 Flash 播放器路径不存在: ${customFlashPlayerPath}`
            })
          }
          throw new Error(`自定义 Flash 播放器路径不存在: ${customFlashPlayerPath}`)
        }
        
        flashPlayerPath = customFlashPlayerPath
      }

      // 使用选定的播放器运行.swf文件
      actualExecutablePath = flashPlayerPath
      // 获取 .swf 文件所在目录作为工作目录
      const swfDir = path.dirname(executablePath)
      gameProcess = spawn(flashPlayerPath, [executablePath], {
        detached: true,
        stdio: 'ignore',
        cwd: swfDir,  // 设置工作目录为 .swf 文件所在目录
        env: { ...process.env }  // 继承当前环境变量（包含 locale 相关设置）
      })
      
      console.log(`✅ 使用 Flash 播放器运行: ${flashPlayerPath} "${executablePath}"`)
      console.log(`   工作目录: ${swfDir}`)
    } else if (isShortcut) {
      // 快捷方式：先解析获取真实路径，然后直接启动真实程序
      console.log('🔗 检测到快捷方式，正在解析...')
      const shortcutInfo = await resolveShortcut(executablePath)
      
      let targetPath = shortcutInfo.targetPath
      let workingDir = shortcutInfo.workingDir || path.dirname(executablePath)
      let args = shortcutInfo.arguments ? shortcutInfo.arguments.split(' ') : []
      
      if (!targetPath || !fs.existsSync(targetPath)) {
        console.warn('⚠️ 无法解析快捷方式或目标文件不存在，回退使用 start 命令')
        // 回退方案：使用 Windows 的 start 命令
        gameProcess = exec(`start "" "${executablePath}"`, {
          detached: true,
          stdio: 'ignore',
          cwd: workingDir,
          env: { ...process.env }
        })
        actualExecutablePath = executablePath
      } else {
        console.log('✅ 快捷方式解析成功，目标路径:', targetPath)
        // 直接启动真实的可执行文件
        actualExecutablePath = targetPath
        gameProcess = spawn(targetPath, args, {
          detached: true,
          stdio: 'ignore',
          cwd: workingDir || path.dirname(targetPath),
          env: { ...process.env }
        })
      }
      console.log(`✅ 快捷方式启动，工作目录: ${workingDir}`)
    } else {
      // 普通游戏：直接运行可执行文件
      // 获取游戏可执行文件所在目录作为工作目录
      const gameDir = path.dirname(executablePath)
      gameProcess = spawn(executablePath, [], {
        detached: true,
        stdio: 'ignore',
        cwd: gameDir,  // 设置工作目录为游戏所在目录
        env: { ...process.env }  // 继承当前环境变量（包含 locale 相关设置）
      })
      console.log(`✅ 游戏启动，工作目录: ${gameDir}`)
    }

    // 记录游戏启动时间
    const startTime = Date.now()
    const gameInfo = {
      process: gameProcess,
      startTime: startTime,
      executablePath: executablePath, // 保存原始路径（.swf文件路径或普通游戏路径）
      actualExecutablePath: actualExecutablePath, // 保存实际运行的可执行文件路径（Ruffle路径或普通游戏路径）
      gameName: gameName || null,
      isFlashGame: isFlashGame
    }

    // 存储进程信息
    gameProcesses.set(gameProcess.pid, gameInfo)

    // 默认追踪启动器进程自己；启动器模式下认领成功后会换成真实游戏进程 PID
    trackedPid = gameProcess.pid

    // 监听进程退出事件
    gameProcess.on('exit', (code, signal) => {
      console.log(`[DEBUG] 🔴 exit事件触发 - 游戏进程 ${gameProcess.pid} 已退出，退出码: ${code}, 信号: ${signal}, 游戏: ${gameName || executablePath}`)

      // 🔴 启动器模式：cmd.exe 秒退是正常现象，绝不能在这里发 game-process-ended
      //    或删除 gameProcesses 记录，否则就是「运行时长≈0 + 运行状态立刻消失」的老毛病。
      //    认领成功后的收尾交给已认领进程的存活巡检；认领失败的收尾在下方补发。
      if (isLauncher) {
        if (launcherAdoptionState === 'pending') {
          console.log(`[DEBUG] ⏳ 启动器已退出（PID ${gameProcess.pid}），等待真实游戏进程出现…（已抑制 game-process-ended，不删除记录）`)
        } else {
          console.log(`[DEBUG] ℹ️ 忽略启动器进程 ${gameProcess.pid} 的退出事件（认领状态: ${launcherAdoptionState}）`)
        }
        return
      }

      // 计算游戏运行时长
      const endTime = Date.now()
      const playTime = Math.floor((endTime - startTime) / 1000) // 转换为秒

      console.log(`[DEBUG] 📊 游戏运行时长: ${playTime} 秒`)

      // 通知渲染进程更新游戏时长
      const mainWindow = getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log(`[DEBUG] 📤 发送 game-process-ended 事件，PID: ${gameProcess.pid}, executablePath: ${executablePath}`)
        mainWindow.webContents.send('game-process-ended', {
          pid: gameProcess.pid,
          playTime: playTime,
          executablePath: executablePath
        })
        console.log(`[DEBUG] ✅ game-process-ended 事件已发送`)
      } else {
        console.log(`[DEBUG] ⚠️ mainWindow 不可用，无法发送 game-process-ended 事件`)
      }

      // 从进程列表中移除
      gameProcesses.delete(gameProcess.pid)
      console.log(`[DEBUG] 🗑️ 已从 gameProcesses 中移除 PID: ${gameProcess.pid}`)
    })

    // 监听进程错误事件
    gameProcess.on('error', (error) => {
      console.error(`游戏进程 ${gameProcess.pid} 发生错误:`, error)
      if (isFlashGame) {
        // 通知主窗口显示错误提示
        const mainWindow = getMainWindow()
        if (mainWindow && !mainWindow.isDestroyed()) {
          const errorMessage = error.message || String(error)
          mainWindow.webContents.send('flash-player-error', {
            type: 'launch-failed',
            message: `Flash 游戏启动失败: ${errorMessage}\n\n可能的原因：\n1. Flash 播放器路径不正确\n2. .swf文件损坏或格式不正确\n3. Flash 播放器版本不兼容`
          })
        }
        console.error('Flash游戏启动失败，可能的原因：')
        console.error('1. Flash 播放器未正确安装或路径不正确')
        console.error('2. .swf文件损坏或格式不正确')
        console.error('3. Flash 播放器版本不兼容')
      }
      gameProcesses.delete(gameProcess.pid)
    })

    // 分离进程，让游戏独立运行
    gameProcess.unref()

    console.log('游戏已启动，进程ID:', gameProcess.pid)

    // 等待一段时间让窗口创建，然后尝试获取所有窗口标题
    let windowTitles = []

    if (isLauncher) {
      // ===== 启动器模式：目录认领 =====
      // 启动器（cmd.exe）已退出，真正的游戏进程在 .bat 所在目录里，去把它认领过来。
      const launcherDir = path.dirname(executablePath)
      const adopted = await adoptLauncherGameProcess(launcherDir, gameProcess.pid, LAUNCHER_ADOPT_MAX_WAIT_MS)

      if (adopted) {
        trackedPid = adopted.pid
        launcherAdoptionState = 'adopted'
        windowTitles = adopted.windowTitles || []

        // 🔴 把 gameProcesses 的条目从 launcher pid 迁移到真实 pid，
        //    这样渲染层的「按 PID 取窗口标题」巡检、结束时长、最小化窗口
        //    全都作用在真正的游戏进程上（渲染层一行都不用改）。
        gameProcesses.delete(gameProcess.pid)

        // 注意：这里必须把 process 置空。
        // terminateGame 第一步会调用 gameInfo.process.kill('SIGTERM')；而 ChildProcess
        // 句柄在进程退出后内部 handle 为空，Node 会退化成 process.kill(pid) —— 那个 PID
        // （启动器的 cmd.exe）此时可能已被系统复用给别的进程，会误杀无关进程。
        // 置空即跳过该步骤，真正结束游戏交给 forceTerminateAllRelatedProcesses 的
        // 「按目录清场」（方法 4）负责。
        gameInfo.process = null
        gameInfo.adoptedPid = adopted.pid

        gameProcesses.set(adopted.pid, gameInfo)

        console.log(`[DEBUG] ✅ 已认领启动器拉起的游戏进程: PID ${adopted.pid}, 名称 ${adopted.name}, 路径 ${adopted.path}`)
        console.log(`[DEBUG] 📋 认领进程窗口标题: ${JSON.stringify(windowTitles)}`)

        // 认领到的进程不是我们 spawn 的，拿不到 'exit' 事件 → 用存活巡检回收
        startAdoptedProcessWatcher(adopted.pid, gameInfo, executablePath, getMainWindow)
      } else {
        // 认领失败：回退到与旧行为等价的收尾（补发 game-process-ended + 删 map），
        // 免得渲染层永远卡在「运行中」。
        launcherAdoptionState = 'failed'
        trackedPid = gameProcess.pid
        console.warn('[DEBUG] ⚠️ 认领失败：目录内未找到启动器拉起的真实游戏进程，回退为旧行为收尾')

        gameProcesses.delete(gameProcess.pid)

        const mainWindow = getMainWindow()
        const playTime = Math.floor((Date.now() - startTime) / 1000)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('game-process-ended', {
            pid: gameProcess.pid,
            playTime: playTime,
            executablePath: executablePath
          })
          console.log('[DEBUG] 📤 认领失败，已补发 game-process-ended（回退行为）')
        }
      }
    } else {
      // ↓↓↓ 以下为【非启动器模式】原始逻辑，逐字未改（仅因包进 else 分支整体缩进）↓↓↓
      try {
        // 等待 1 秒让窗口有时间创建
        await new Promise(resolve => setTimeout(resolve, 1000))

        // 尝试获取所有窗口标题（最多重试 3 次）
        for (let i = 0; i < 3; i++) {
          windowTitles = await windowsUtils.getAllWindowTitlesByPID(gameProcess.pid)
          if (windowTitles && windowTitles.length > 0) {
            console.log('✅ 获取到窗口标题列表:', windowTitles)
            break
          }
          // 如果还没获取到，再等待 2 秒后重试
          if (i < 2) {
            await new Promise(resolve => setTimeout(resolve, 2000))
          }
        }

        if (!windowTitles || windowTitles.length === 0) {
          console.log('⚠️ 未能获取到窗口标题（可能窗口还未创建或进程没有窗口）')
        }
      } catch (error) {
        console.warn('获取窗口标题时出错:', error.message)
        // 不影响启动流程，继续执行
      }
    }

    // 将窗口标题列表保存到 gameInfo 中
    if (windowTitles && windowTitles.length > 0) {
      gameInfo.windowTitles = windowTitles
    }

    return {
      success: true,
      pid: trackedPid,
      windowTitles: windowTitles.length > 0 ? windowTitles : undefined
    }
  } catch (error) {
    console.error('启动游戏失败:', error)
    return { success: false, error: error.message }
  }
}

/**
 * 使用转区工具（如 Locale Emulator 的 LEProc.exe）启动游戏。
 * 调用方式：LEProc.exe "C:\Path\To\Your\Application.exe"（转区工具路径 + 游戏路径作为参数）。
 * @param {string} localeEmulatorPath - 转区工具可执行文件路径（如 LEProc.exe）
 * @param {string} executablePath - 游戏可执行文件路径
 * @param {string|null} gameName - 游戏名称
 * @param {Function} getMainWindow - 获取主窗口的函数
 * @returns {Promise<{success: boolean, pid?: number, windowTitles?: string[], error?: string}>}
 */
async function launchGameWithLocale(localeEmulatorPath, executablePath, gameName, getMainWindow) {
  try {
    if (!localeEmulatorPath || !localeEmulatorPath.trim()) {
      return { success: false, error: '未配置转区工具路径' }
    }
    if (!fs.existsSync(localeEmulatorPath)) {
      return { success: false, error: `转区工具不存在: ${localeEmulatorPath}` }
    }
    if (!fs.existsSync(executablePath)) {
      return { success: false, error: '游戏文件不存在' }
    }

    const fileExt = path.extname(executablePath).toLowerCase()
    if (fileExt === '.swf') {
      return { success: false, error: '转区启动不支持 Flash 游戏，请使用普通启动' }
    }

    const gameDir = path.dirname(executablePath)
    let gameProcess
    
    if (fileExt === '.lnk') {
      // 快捷方式：使用 Windows Shell 结合转区工具启动
      console.log('🔗 转区启动 - 检测到快捷方式')
      // 注意：这里可能需要先解析快捷方式获取真实路径，或者直接让转区工具处理
      // 为了简单，我们先尝试直接传递快捷方式给转区工具
      gameProcess = spawn(localeEmulatorPath, [executablePath], {
        detached: true,
        stdio: 'ignore',
        cwd: gameDir,
        env: { ...process.env }
      })
    } else {
      // 普通可执行文件
      // 调用方式：LEProc.exe "C:\Path\To\Game.exe"
      gameProcess = spawn(localeEmulatorPath, [executablePath], {
        detached: true,
        stdio: 'ignore',
        cwd: gameDir,
        env: { ...process.env }
      })
    }

    const startTime = Date.now()
    const gameInfo = {
      process: gameProcess,
      startTime: startTime,
      executablePath: executablePath,
      actualExecutablePath: localeEmulatorPath,
      gameName: gameName || null,
      isFlashGame: false
    }
    gameProcesses.set(gameProcess.pid, gameInfo)

    gameProcess.on('exit', (code, signal) => {
      const endTime = Date.now()
      const playTime = Math.floor((endTime - startTime) / 1000)
      const mainWindow = getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('game-process-ended', {
          pid: gameProcess.pid,
          playTime: playTime,
          executablePath: executablePath
        })
      }
      gameProcesses.delete(gameProcess.pid)
    })

    gameProcess.on('error', (error) => {
      console.error('转区启动进程错误:', error)
      gameProcesses.delete(gameProcess.pid)
    })

    gameProcess.unref()

    let windowTitles = []
    try {
      await new Promise(resolve => setTimeout(resolve, 1000))
      for (let i = 0; i < 3; i++) {
        windowTitles = await windowsUtils.getAllWindowTitlesByPID(gameProcess.pid)
        if (windowTitles && windowTitles.length > 0) break
        if (i < 2) await new Promise(resolve => setTimeout(resolve, 2000))
      }
      if (windowTitles && windowTitles.length > 0) {
        gameInfo.windowTitles = windowTitles
      }
    } catch (err) {
      console.warn('获取转区进程窗口标题时出错:', err.message)
    }

    return {
      success: true,
      pid: gameProcess.pid,
      windowTitles: windowTitles.length > 0 ? windowTitles : undefined
    }
  } catch (error) {
    console.error('转区启动失败:', error)
    return { success: false, error: error.message }
  }
}

/**
 * 强制终止游戏进程（增强版）。
 * @param {string} executablePath - 游戏可执行文件路径。
 * @param {Function} getMainWindow - 获取主窗口的函数。
 * @param {string} [gameName] - 游戏名称（可选）。
 * @returns {Promise<{success: boolean, pid?: number, playTime?: number, error?: string}>} 终止结果。
 */
async function terminateGame(executablePath, getMainWindow, gameName) {
  try {
    console.log('[DEBUG] 🛑 请求强制结束游戏，executablePath:', executablePath, 'gameName:', gameName)

    if (!executablePath) {
      return { success: false, error: '可执行文件路径不能为空' }
    }

    // 查找匹配的游戏进程（首先尝试我们记录的进程）
    let targetPid = null
    let targetGameInfo = null
    let startTime = null

    for (const [pid, gameInfo] of gameProcesses.entries()) {
      if (gameInfo.executablePath === executablePath) {
        targetPid = pid
        targetGameInfo = gameInfo
        startTime = gameInfo.startTime
        console.log('[DEBUG] 🎯 找到记录的游戏进程，PID:', targetPid)
        break
      }
    }

    // 计算游戏运行时长（如果找到了记录的进程）
    let playTime = 0
    if (startTime) {
      playTime = Math.floor((Date.now() - startTime) / 1000)
    }

    // 第一步：尝试通过我们记录的进程对象终止（如果存在）
    if (targetGameInfo && targetGameInfo.process && !targetGameInfo.process.killed) {
      try {
        console.log('[DEBUG] 🔪 尝试通过 process.kill() 终止记录的进程 PID:', targetPid)
        targetGameInfo.process.kill('SIGTERM')
        
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            try {
              targetGameInfo.process.kill('SIGKILL')
            } catch (e) {}
            resolve()
          }, 2000)
          
          targetGameInfo.process.once('exit', () => {
            clearTimeout(timeout)
            resolve()
          })
        })
      } catch (e) {
        console.warn('[DEBUG] ⚠️ process.kill() 失败:', e)
      }
    }

    // 第二步：无论是否找到了记录的进程，都强制终止所有可能相关的进程！
    console.log('[DEBUG] 🔥 执行强制终止（多种方式）...')
    await forceTerminateAllRelatedProcesses(executablePath, gameName)

    // 第三步：清理我们的进程记录（即使没找到也要清理该路径对应的记录）
    for (const [pid, gameInfo] of gameProcesses.entries()) {
      if (gameInfo.executablePath === executablePath) {
        gameProcesses.delete(pid)
        // 若该条记录是「认领」来的进程，同步停掉它的存活巡检，
        // 避免巡检稍后发现进程已死又补发一次 game-process-ended（重复计时长）
        stopAdoptedProcessWatcher(pid)
        console.log('[DEBUG] 🗑️ 已从 gameProcesses 中移除 PID:', pid)
      }
    }

    // 第四步：通知渲染进程游戏已结束（无论是否成功终止，都发送结束事件）
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('[DEBUG] 📤 发送 game-process-ended 事件（强制终止），executablePath:', executablePath)
      mainWindow.webContents.send('game-process-ended', {
        pid: targetPid,
        playTime: playTime,
        executablePath: executablePath
      })
      console.log('[DEBUG] ✅ game-process-ended 事件已发送')
    }

    console.log('[DEBUG] ✅ 游戏进程已强制终止，PID:', targetPid)
    return { success: true, pid: targetPid, playTime: playTime }
  } catch (error) {
    console.error('[DEBUG] ❌ 强制结束游戏失败:', error)
    return { success: false, error: error.message }
  }
}

/**
 * 最小化所有正在运行的游戏窗口。
 * @returns {Promise<{success: boolean, minimizedCount?: number, error?: string}>} 最小化结果。
 */
async function minimizeAllGameWindows() {
  try {
    console.log('开始最小化所有游戏窗口...')
    console.log(`当前 gameProcesses 中有 ${gameProcesses.size} 个游戏进程`)

    if (gameProcesses.size === 0) {
      console.log('⚠️ 没有正在运行的游戏进程')
      return { success: true, minimizedCount: 0 }
    }

    const minimizedPids = []
    const failedPids = []

    // 遍历所有游戏进程
    for (const [pid, gameInfo] of gameProcesses.entries()) {
      try {
        console.log(`尝试最小化游戏窗口 (PID: ${pid}, 游戏: ${gameInfo.gameName || '未知'})`)

        // 首先检查进程是否还存在
        const checkProcess = await new Promise((resolve) => {
          exec(`powershell -Command "Get-Process -Id ${pid} -ErrorAction SilentlyContinue"`, (error) => {
            resolve(!error)
          })
        })

        if (!checkProcess) {
          console.log(`⚠️ 进程 ${pid} 已不存在，从列表中移除`)
          gameProcesses.delete(pid)
          continue
        }

        const success = await windowsUtils.minimizeWindowByPID(pid)
        if (success) {
          minimizedPids.push(pid)
          console.log(`✅ 已最小化游戏窗口 (PID: ${pid}, 游戏: ${gameInfo.gameName || '未知'})`)
        } else {
          failedPids.push(pid)
          console.log(`⚠️ 无法最小化游戏窗口 (PID: ${pid})，可能没有可见窗口`)
        }
      } catch (error) {
        failedPids.push(pid)
        console.warn(`最小化游戏窗口失败 (PID: ${pid}):`, error.message)
      }
    }

    console.log(`最小化完成: 成功 ${minimizedPids.length} 个, 失败 ${failedPids.length} 个`)
    return { success: true, minimizedCount: minimizedPids.length }
  } catch (error) {
    console.error('最小化游戏窗口时出错:', error)
    return { success: false, error: error.message }
  }
}

/**
 * 注册与游戏进程相关的 IPC 处理器。
 * @param {Object} ipcMain - Electron 的 ipcMain 对象。
 * @param {Function} getMainWindow - 获取主窗口的函数。
 */
function registerIpcHandlers(ipcMain, getMainWindow) {
  // 启动游戏
  ipcMain.handle('launch-game', async (event, executablePath, gameName) => {
    return await launchGame(executablePath, gameName, getMainWindow)
  })

  // 使用转区工具启动游戏（LEProc -run <path>）
  ipcMain.handle('launch-game-with-locale', async (event, localeEmulatorPath, executablePath, gameName) => {
    return await launchGameWithLocale(localeEmulatorPath, executablePath, gameName, getMainWindow)
  })

  // 强制结束游戏
  ipcMain.handle('terminate-game', async (event, executablePath, gameName) => {
    return await terminateGame(executablePath, getMainWindow, gameName)
  })

  // 通过 PID 获取进程的所有窗口标题
  ipcMain.handle('get-all-window-titles-by-pid', async (event, pid) => {
    try {
      if (!pid) {
        return { success: false, error: 'PID 不能为空' }
      }

      const windowTitles = await windowsUtils.getAllWindowTitlesByPID(pid)
      return { success: true, windowTitles: windowTitles || [] }
    } catch (error) {
      console.error('获取窗口标题失败:', error)
      return { success: false, error: error.message, windowTitles: [] }
    }
  })
}

module.exports = {
  getGameProcessesCount,
  minimizeAllGameWindows,
  findGameInfoByPID,
  registerIpcHandlers
}

