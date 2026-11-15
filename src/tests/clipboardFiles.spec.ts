/**
 * 剪贴板文件列表（`electron/services/clipboard-files.js`）
 *
 * 这个功能的风险点全在"看不见的地方"：
 *   - 资源管理器只认内置的 **CF_HDROP**（文件拖放列表），不认 Electron 的自定义 `FileNameW`
 *   - WinForms 的剪贴板 API **必须在 STA 线程**上调，PowerShell 7（pwsh）默认 MTA 会直接抛异常
 *   - 写完必须 `copy: true`（内部走 OleFlushClipboard）—— 否则 PowerShell 一退出，
 *     主人按 Ctrl+V 什么也粘不出来
 *   - 几百个中文长路径绝不拼进命令行（长度上限 + 引号地狱），一律走临时 JSON 清单
 *
 * 这里钉住脚本内容与清单格式；**真机粘贴**由 `.temp/` 里的探针在真剪贴板上验证
 * （单测不该去动主人的剪贴板）。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import clipboardFiles from '../../electron/services/clipboard-files.js'

describe('buildClipboardManifest：交给 PowerShell 的清单', () => {
  it('是 JSON 数组，中文与反斜杠原样保留', () => {
    const files = ['E:\\ACG\\番剧\\第01话.mp4', 'E:\\ACG\\a"b.mp4']
    const manifest = clipboardFiles.buildClipboardManifest(files)
    expect(JSON.parse(manifest)).toEqual(files)
    // 路径不参与命令行拼接，所以引号不需要"转义成命令行安全"的形态
    expect(manifest).toContain('第01话.mp4')
  })

  it('空输入得到空数组（不是 null）', () => {
    expect(JSON.parse(clipboardFiles.buildClipboardManifest([] as any))).toEqual([])
  })
})

describe('buildPowerShellScript：写剪贴板的脚本', () => {
  const script = clipboardFiles.buildPowerShellScript()

  it('用 WinForms 的 SetFileDropList + SetDataObject(..., $true)', () => {
    expect(script).toContain('Add-Type -AssemblyName System.Windows.Forms')
    expect(script).toContain('SetFileDropList')
    // $true = copy，内部触发 OleFlushClipboard；写成 $false 就是"进程一退剪贴板就空"
    expect(script).toContain('SetDataObject($data, $true)')
  })

  it('清单从环境变量指向的临时文件读，且按 UTF-8 解', () => {
    expect(script).toContain('$env:GGV_CLIP_MANIFEST')
    expect(script).toContain('-Encoding UTF8')
    expect(script).toContain('ConvertFrom-Json')
  })

  it('脚本里不出现任何具体路径（路径走文件，不走命令行）', () => {
    expect(script).not.toContain('E:\\')
    expect(script).not.toContain('C:\\')
  })

  it('回一行 OK <数量>，让调用方能区分"跑了"和"没跑起来"', () => {
    expect(script).toContain('"OK "')
  })

  it('🔴 绝不用 @($raw | ConvertFrom-Json)（PS 5.1 会把 N 个路径拼成一条）', () => {
    // 2026-10-10 真机踩到：@() 包住管道会得到「1 个元素，内容是内部数组」，
    // 于是 [string]$p 把整数组按空格拼成一条假路径塞进剪贴板。
    expect(script).not.toContain('@($raw | ConvertFrom-Json)')
    expect(script).toContain('$parsed = $raw | ConvertFrom-Json')
    expect(script).toContain('[string[]]$parsed')
  })

  it('逐个加进 StringCollection，而不是整串塞进去', () => {
    expect(script).toContain('foreach ($p in $paths) { [void]$col.Add([string]$p) }')
  })
})

describe('buildReadBackScript：跨进程回读（持久化的判据）', () => {
  const script = clipboardFiles.buildReadBackScript()

  it('读的正是 CF_HDROP 的文件列表', () => {
    expect(script).toContain('[System.Windows.Forms.Clipboard]::GetFileDropList()')
  })

  it('先回数量再逐条回路径（探针按行解析）', () => {
    expect(script).toContain('"COUNT "')
    expect(script).toContain('"PATH "')
  })

  it('先探格式在不在：空的 CF_HDROP 会让 .NET 抛 AccessViolationException（catch 不住）', () => {
    expect(script).toContain('ContainsFileDropList()')
  })
})

describe('copyFilesToClipboard：前置校验', () => {
  it('文件全都不是真实文件 → 直接失败，不写剪贴板、不报成功', async () => {
    const ghost = path.join('Z:', 'nope', 'ghost.mp4')
    const result = await clipboardFiles.copyFilesToClipboard([ghost])

    expect(result.ok).toBe(false)
    expect(result.count).toBe(0)
    expect(result.missing).toEqual([ghost])
    expect(String(result.message)).toContain('都不存在')
    // 早退分支不该带 verified 字段（带上了说明它真去动了剪贴板）
    expect(result.verified).toBeUndefined()
  })

  it('空数组同样直接失败', async () => {
    const result = await clipboardFiles.copyFilesToClipboard([])
    expect(result.ok).toBe(false)
    expect(result.count).toBe(0)
  })
})

/**
 * 真剪贴板往返（**默认跳过**，会覆盖主人当前剪贴板）。
 *
 * 为什么值得留着：上面那些脚本形状的断言只能防"改回坑里"，
 * 真正证明"资源管理器能粘出 N 个文件"的只有真写一次、再**跨进程**读回来。
 * 这次修的那个空格拼接 bug 就是这一步抓出来的 —— 形状断言当时是绿的。
 *
 * 手动跑：`$env:GGV_CLIPBOARD_LIVE='1'; npx vitest run src/tests/clipboardFiles.spec.ts`
 */
const liveTest = process.env.GGV_CLIPBOARD_LIVE === '1' ? it : it.skip

describe('真剪贴板往返（需要 GGV_CLIPBOARD_LIVE=1）', () => {
  liveTest('3 个文件 → 剪贴板里就是 3 条，能被另一个进程读回来', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ggv-clip-live-'))
    const files = ['one.mp4', 'two.mp4', 'three.mp4'].map(name => {
      const file = path.join(dir, name)
      fs.writeFileSync(file, 'x')
      return file
    })

    try {
      const result = await clipboardFiles.copyFilesToClipboard(files, { verify: true })
      expect(result.ok).toBe(true)
      expect(result.count).toBe(3)
      expect(result.verified).toBe(true)

      const back = await clipboardFiles.readClipboardFileList()
      expect(back).toEqual(files)
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch (_) { /* 忽略 */ }
    }
  }, 60000)
})
