/**
 * @module ClipboardFiles
 * @description 把一批**真实文件**放进 Windows 剪贴板（等价于在资源管理器里按了 Ctrl+C）。
 *
 * 主人的场景（2026-10-10）：给某个标签下的视频做**第二份备份**（存到工作区/存储区之外的
 * 网盘等）。GGV **不做任何真实的文件读写与删除** —— 这里只把路径交给 Windows，
 * 之后主人在网盘客户端或目标文件夹里自己 Ctrl+V，复制动作是资源管理器做的。
 *
 * ---------------------------------------------------------------------------
 * 为什么不用 Electron 的 clipboard：
 *   `clipboard.writeBuffer('FileNameW', ...)` 只是注册一个**自定义格式**，而资源管理器的
 *   "粘贴"只认内置的 **CF_HDROP**（文件拖放列表，格式号 15）。Electron 没有暴露 CF_HDROP，
 *   `clipboard.write()` 也没有 filePaths 字段 —— 见 electron/electron 的 clipboard API。
 *
 * 所以这里借系统自带的 **Windows PowerShell 5.1 + WinForms**：
 *
 *     [Clipboard]::SetDataObject($dataObject, $true)
 *
 * 第二个参数 `copy: true` 是关键 —— 它内部走 `OleSetClipboard` + **`OleFlushClipboard`**，
 * 把数据真正刷进系统剪贴板；否则数据只在"占有剪贴板的那个进程"活着时有效，
 * PowerShell 一退出，主人按 Ctrl+V 就什么也粘不出来。
 *
 * ---------------------------------------------------------------------------
 * 两个必须踩准的细节：
 *   1. **STA 线程**：WinForms 的剪贴板 API 在 MTA 线程上会抛 `ThreadStateException`。
 *      `powershell.exe`（5.1）默认 STA，但仍显式带 `-STA`；**绝不能用 pwsh**（PowerShell 7
 *      默认 MTA，且很多机器上没有）。
 *   2. **参数不走命令行**：几百个中文长路径拼进命令行会爆长度上限、还会被引号咬到。
 *      改成写一份 JSON 清单到临时文件，脚本按 UTF-8 读它。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')

/** 交给 PowerShell 读的清单文件名（带 pid + 时间戳，避免并发踩踏） */
function makeManifestPath() {
  return path.join(os.tmpdir(), `ggv-clipboard-${process.pid}-${Date.now()}.json`)
}

/**
 * 生成清单内容（纯函数，单测用）。
 * 用 JSON 而不是"一行一个路径"：路径理论上可能含换行/特殊字符，JSON 转义是免费的保险。
 * @param {string[]} files
 * @returns {string}
 */
function buildClipboardManifest(files) {
  return JSON.stringify((Array.isArray(files) ? files : []).map(f => String(f)))
}

/**
 * 写剪贴板用的 PowerShell 脚本（纯函数，单测用）。
 *
 * 说明：
 *   - `Add-Type -AssemblyName System.Windows.Forms` 拿到 WinForms 剪贴板
 *   - `DataObject.SetFileDropList` + `Clipboard.SetDataObject(..., $true)` → 真正的 CF_HDROP 且持久
 *   - 最后回一行 `OK <数量>`，让调用方能区分"脚本跑了"和"脚本没跑起来"
 *
 * 🔴 这里钉着一个 **PowerShell 5.1 的经典坑**（2026-10-10 真机踩到并修复）：
 *
 *     $paths = @($raw | ConvertFrom-Json)      # ✗ 得到「1 个元素，内容是内部数组」
 *     $paths = $raw | ConvertFrom-Json          # ✓ 先赋值再转 [string[]]
 *
 *   写成 `@(...)` 那种形式时，`foreach` 只迭代 1 次、`$p` 是整个数组，
 *   于是 `[string]$p` 把 N 个路径**按空格拼成一条**塞进剪贴板 ——
 *   资源管理器里粘出来就是"1 个名字奇怪的假文件"。
 *   （当时的自检把这个失败抓了出来：期望 6 个、回读到 1 个 → 报错而不是假成功。）
 *
 * @returns {string}
 */
function buildPowerShellScript() {
  return [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Windows.Forms',
    '$raw = Get-Content -LiteralPath $env:GGV_CLIP_MANIFEST -Raw -Encoding UTF8',
    '$parsed = $raw | ConvertFrom-Json',
    '$paths = @()',
    // 逐个转成字符串数组：单元素 JSON 与多元素 JSON 都得到"每个路径一个元素"
    'if ($parsed -ne $null) { $paths = [string[]]$parsed }',
    '$col = New-Object System.Collections.Specialized.StringCollection',
    'foreach ($p in $paths) { [void]$col.Add([string]$p) }',
    '$data = New-Object System.Windows.Forms.DataObject',
    '$data.SetFileDropList($col)',
    '[System.Windows.Forms.Clipboard]::SetDataObject($data, $true)',
    'Write-Output ("OK " + $paths.Count)'
  ].join('; ')
}

/**
 * 写只读回读用的 PowerShell 脚本（探针 / 自检用）：把当前剪贴板里的文件列表读出来。
 * 这是**跨进程**回读 —— 只有数据真的刷进了系统剪贴板才读得到，所以它能证明持久化成功。
 *
 * ⚠️ `Clipboard.GetFileDropList()` 遇到**空的** CF_HDROP 会抛 `AccessViolationException`
 * （.NET 的 OleConverter 解析 0 条目 DROPFILES 的老 bug，且这种异常 catch 不住）。
 * 所以先用 `ContainsFileDropList()` 探一下格式在不在，不在就直接回 0。
 *
 * @returns {string}
 */
function buildReadBackScript() {
  return [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Windows.Forms',
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
    'if (-not [System.Windows.Forms.Clipboard]::ContainsFileDropList()) { Write-Output "COUNT 0"; exit 0 }',
    '$items = [System.Windows.Forms.Clipboard]::GetFileDropList()',
    'if ($items -eq $null) { Write-Output "COUNT 0"; exit 0 }',
    'Write-Output ("COUNT " + $items.Count)',
    'foreach ($i in $items) { Write-Output ("PATH " + $i) }'
  ].join('; ')
}

/**
 * 跑一段 PowerShell（隐藏窗口、不做 profile、显式 STA）。
 * @param {string} script
 * @param {{ env?: object, timeout?: number }} [options]
 * @returns {Promise<{ ok: boolean, stdout: string, stderr: string, message?: string }>}
 */
function runPowerShell(script, options = {}) {
  const { env, timeout = 15000 } = options
  return new Promise(resolve => {
    let settled = false
    const done = payload => {
      if (settled) return
      settled = true
      resolve(payload)
    }

    try {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script],
        {
          windowsHide: true,
          timeout,
          maxBuffer: 16 * 1024 * 1024,
          encoding: 'utf8',
          env: env || process.env
        },
        (error, stdout, stderr) => {
          done({
            ok: !error,
            stdout: String(stdout || ''),
            stderr: String(stderr || ''),
            message: error ? error.message : undefined
          })
        }
      )
    } catch (error) {
      done({ ok: false, stdout: '', stderr: '', message: error.message || String(error) })
    }
  })
}

/**
 * 剪贴板里当前的**文件**列表（不是文本）。读不到就返回空数组。
 * @returns {Promise<string[]>}
 */
async function readClipboardFileList() {
  if (process.platform !== 'win32') return []
  const result = await runPowerShell(buildReadBackScript())
  if (!result.ok) return []
  return String(result.stdout || '')
    .split(/\r?\n/)
    .filter(line => line.startsWith('PATH '))
    .map(line => line.slice(5))
}

/**
 * 把文件放进剪贴板。
 *
 * 全程**不读写主人的视频文件**（只 stat 判断存在性），不复制、不移动、不删除。
 *
 * @param {string[]} paths 文件绝对路径
 * @param {{ verify?: boolean }} [options] verify=true 时另起一个进程回读剪贴板核对数量
 * @returns {Promise<{ ok: boolean, count: number, missing: string[], verified?: boolean, message?: string }>}
 */
async function copyFilesToClipboard(paths, options = {}) {
  const { verify = true } = options
  const input = (Array.isArray(paths) ? paths : []).map(p => String(p || '').trim()).filter(Boolean)

  const files = []
  const missing = []
  for (const file of input) {
    let isFile = false
    try {
      isFile = fs.statSync(file).isFile()
    } catch (_) {
      isFile = false
    }
    if (isFile) files.push(file)
    else missing.push(file)
  }

  if (files.length === 0) {
    return { ok: false, count: 0, missing, message: '选中的文件在磁盘上都不存在了（可用「重新关联到…」接回来）' }
  }
  if (process.platform !== 'win32') {
    return { ok: false, count: 0, missing, message: '剪贴板文件列表只在 Windows 上可用' }
  }

  const manifestPath = makeManifestPath()
  try {
    fs.writeFileSync(manifestPath, buildClipboardManifest(files), 'utf8')
  } catch (error) {
    return { ok: false, count: 0, missing, message: `写入临时清单失败：${error.message}` }
  }

  try {
    const result = await runPowerShell(buildPowerShellScript(), {
      env: { ...process.env, GGV_CLIP_MANIFEST: manifestPath }
    })

    if (!result.ok || !/OK\s+\d+/.test(result.stdout)) {
      return {
        ok: false,
        count: 0,
        missing,
        message: `写入剪贴板失败：${(result.stderr || result.message || '').trim().slice(0, 200) || 'PowerShell 没有返回成功标记'}`
      }
    }

    if (!verify) return { ok: true, count: files.length, missing, verified: false }

    const back = await readClipboardFileList()
    const verified = back.length === files.length
    if (!verified) {
      return {
        ok: false,
        count: files.length,
        missing,
        verified: false,
        message: `剪贴板校验不通过：期望 ${files.length} 个，回读到 ${back.length} 个。请重试一次`
      }
    }

    return { ok: true, count: files.length, missing, verified: true }
  } finally {
    try {
      fs.unlinkSync(manifestPath)
    } catch (_) {
      // 临时文件删不掉不影响主流程
    }
  }
}

module.exports = {
  buildClipboardManifest,
  buildPowerShellScript,
  buildReadBackScript,
  copyFilesToClipboard,
  readClipboardFileList
}
