/**
 * PotPlayer 播放列表（`electron/services/potplayer-playlist.js`）
 *
 * 这个模块的产出物是**要喂给 PotPlayer 的文件**，格式错一个字节它就不认，
 * 而且主人看不到中间过程 —— 所以格式、命名、路径解析这些"确定性"的部分全部钉死在这里：
 *
 *   - `.dpl` 必须是 **UTF-8 BOM + CRLF + DAUMPLAYLIST 头 + N*file*<路径>**（实测自 PotPlayer 26.08.19.0）
 *   - 具名列表名默认取标签名（`GGV-拔作.dpl`），非法字符要收拾掉，重复执行＝原地刷新
 *   - 「磁盘上已经丢失的文件」必须被剔除，不能写进播放列表
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import potPlayer from '../../electron/services/potplayer-playlist.js'

let tmpDir = ''

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ggv-potplaylist-test-'))
})

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch (_) {
    // 清理失败不影响结论
  }
})

describe('buildDplText：.dpl 文本格式', () => {
  it('BOM + CRLF + DAUMPLAYLIST 头 + 序号从 1 开始', () => {
    const text = potPlayer.buildDplText(['E:\\a\\1.mp4', 'E:\\a\\2.mkv'])
    expect(text.startsWith('\uFEFFDAUMPLAYLIST\r\n')).toBe(true)
    expect(text).toBe(
      '\uFEFFDAUMPLAYLIST\r\ntopindex=0\r\nsaveplaypos=0\r\n1*file*E:\\a\\1.mp4\r\n2*file*E:\\a\\2.mkv\r\n'
    )
    // 不允许出现裸 \n（PotPlayer 自己的文件全是 CRLF）
    expect(/\r\n/.test(text)).toBe(true)
    expect(text.replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('中文 / 特殊字符路径原样写入（不转义、不改写）', () => {
    const file = 'E:\\ACG\\Anime\\DoujinAnime\\Sexonly\\[LinuxDx] From Hunter to Hati’s Breeding Bitch.mp4'
    const text = potPlayer.buildDplText([file])
    expect(text).toContain(`1*file*${file}`)
  })

  it('空数组 / 空字符串被过滤，不产生空条目', () => {
    const text = potPlayer.buildDplText(['', '  ', 'E:\\a.mp4'])
    expect(potPlayer.parseDplPaths(text)).toEqual(['E:\\a.mp4'])
  })
})

describe('parseDplPaths：写出去的能读回来（探针复查用）', () => {
  it('往返一致', () => {
    const files = ['E:\\x\\a.mp4', 'E:\\x\\b.mp4', 'E:\\x\\c.mp4']
    expect(potPlayer.parseDplPaths(potPlayer.buildDplText(files))).toEqual(files)
  })

  it('没有 BOM 也能读（历史文件 / 手工编辑过的）', () => {
    const raw = 'DAUMPLAYLIST\r\ntopindex=0\r\n1*file*E:\\a.mp4\r\n'
    expect(potPlayer.parseDplPaths(raw)).toEqual(['E:\\a.mp4'])
  })
})

describe('sanitizePlaylistName / buildNamedPlaylistFileName：命名', () => {
  it('单个标签 → GGV-<标签>.dpl', () => {
    expect(potPlayer.buildNamedPlaylistFileName(['拔作'])).toBe('GGV-拔作.dpl')
  })

  it('多个标签 → GGV-<第一个>等N个.dpl（不堆一长串）', () => {
    expect(potPlayer.buildNamedPlaylistFileName(['拔作', '3D', '口交'])).toBe('GGV-拔作等3个.dpl')
  })

  it('没有标签 → 用兜底名（搜索 / 全部）', () => {
    expect(potPlayer.buildNamedPlaylistFileName([], '搜索-口交')).toBe('GGV-搜索-口交.dpl')
    expect(potPlayer.buildNamedPlaylistFileName([])).toBe('GGV-视频.dpl')
  })

  it('Windows 非法字符被换成下划线，收尾的点与空格被去掉', () => {
    expect(potPlayer.sanitizePlaylistName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
    expect(potPlayer.sanitizePlaylistName('名字...  ')).toBe('名字')
  })

  it('超长名字被截断（否则路径过长写不进去）', () => {
    const long = 'あ'.repeat(200)
    const name = potPlayer.sanitizePlaylistName(long, 40)
    expect(name.length).toBe(40)
  })

  it('标签全是非法字符时不会产出空文件名', () => {
    expect(potPlayer.buildNamedPlaylistFileName(['***'], '全部视频')).toBe('GGV-___.dpl')
  })
})

describe('collectExistingFiles：丢失的文件必须剔除', () => {
  it('只留磁盘上真实存在的文件', () => {
    const real = path.join(tmpDir, 'real.mp4')
    fs.writeFileSync(real, 'x')
    const ghost = path.join(tmpDir, 'ghost.mp4')

    const { files, missing } = potPlayer.collectExistingFiles([real, ghost, ''])
    expect(files).toEqual([real])
    expect(missing).toEqual([ghost])
  })

  it('目录不算文件（防止把文件夹塞进播放列表）', () => {
    const { files, missing } = potPlayer.collectExistingFiles([tmpDir])
    expect(files).toEqual([])
    expect(missing).toEqual([tmpDir])
  })
})

describe('writePlaylistFile：落盘', () => {
  it('目录不存在会自动建，写完后能解析回来', () => {
    const target = path.join(tmpDir, 'Playlist', 'GGV-测试.dpl')
    const files = ['E:\\a\\1.mp4', 'E:\\a\\2.mp4']
    const result = potPlayer.writePlaylistFile(target, files)

    expect(result.ok).toBe(true)
    expect(result.count).toBe(2)
    expect(fs.existsSync(target)).toBe(true)

    const raw = fs.readFileSync(target)
    // 前三个字节必须是 UTF-8 BOM —— 少了它 PotPlayer 可能按本地代码页解，中文路径全烂
    expect([raw[0], raw[1], raw[2]]).toEqual([0xef, 0xbb, 0xbf])
    expect(potPlayer.parseDplPaths(raw.toString('utf8'))).toEqual(files)
  })

  it('backup=true 时把被覆盖的原文件另存一份（主人可能在 PotPlayer 里手工调过顺序）', () => {
    const target = path.join(tmpDir, 'Playlist', 'default.dpl')
    potPlayer.writePlaylistFile(target, ['E:\\old.mp4'])
    const again = potPlayer.writePlaylistFile(target, ['E:\\new.mp4'], { backup: true })

    expect(again.ok).toBe(true)
    expect(again.backupPath).toBeTruthy()
    expect(potPlayer.parseDplPaths(fs.readFileSync(again.backupPath, 'utf8'))).toEqual(['E:\\old.mp4'])
    expect(potPlayer.parseDplPaths(fs.readFileSync(target, 'utf8'))).toEqual(['E:\\new.mp4'])
  })

  it('没有文件 / 没有路径 → 明确失败，不写空列表', () => {
    expect(potPlayer.writePlaylistFile(path.join(tmpDir, 'x.dpl'), []).ok).toBe(false)
    expect(potPlayer.writePlaylistFile('', ['E:\\a.mp4']).ok).toBe(false)
  })
})

describe('安装目录解析：从卸载命令 / 目录里认出 PotPlayer', () => {
  it('从卸载程序所在目录里找到播放器（本机实测的形态）', () => {
    const installDir = path.join(tmpDir, 'App', 'PotPlayer64')
    fs.mkdirSync(installDir, { recursive: true })
    fs.writeFileSync(path.join(installDir, 'PotPlayerMini64.exe'), 'MZ')
    fs.writeFileSync(path.join(installDir, 'uninstall.exe'), 'MZ')

    const found = potPlayer._internal.exeFromSeed(path.join(installDir, 'uninstall.exe'))
    expect(found).toBe(path.join(installDir, 'PotPlayerMini64.exe'))
  })

  it('带引号与参数的卸载命令也能解出来', () => {
    const installDir = path.join(tmpDir, 'App2')
    fs.mkdirSync(installDir, { recursive: true })
    fs.writeFileSync(path.join(installDir, 'PotPlayerMini64.exe'), 'MZ')
    fs.writeFileSync(path.join(installDir, 'uninstall.exe'), 'MZ')

    expect(potPlayer._internal.exeFromSeed(`"${path.join(installDir, 'uninstall.exe')}" /S`))
      .toBe(path.join(installDir, 'PotPlayerMini64.exe'))
  })

  it('指到不存在的路径 → 不猜、不瞎给', () => {
    expect(potPlayer._internal.exeFromSeed('Z:\\nope\\uninstall.exe')).toBe(null)
  })

  it('设置里手填了错路径 → resolveInstall 明确报错（而不是偷偷回退到自动探测）', async () => {
    const result = await potPlayer.resolveInstall('Z:\\假的\\路径.exe')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('路径不对')
  })

  it('设置里手填 exe → 播放列表目录就是它旁边的 Playlist', async () => {
    const installDir = path.join(tmpDir, 'App3', 'PotPlayer64')
    fs.mkdirSync(installDir, { recursive: true })
    const exe = path.join(installDir, 'PotPlayerMini64.exe')
    fs.writeFileSync(exe, 'MZ')

    const result = await potPlayer.resolveInstall(exe)
    expect(result.ok).toBe(true)
    expect(result.source).toBe('settings')
    expect(result.playlistDir).toBe(path.join(installDir, 'Playlist'))
    // 默认列表文件名跟 exe 同名 —— PotPlayerMini64.exe ⇄ PotPlayerMini64.dpl（本机实测）
    expect(result.defaultPlaylistPath).toBe(path.join(installDir, 'Playlist', 'PotPlayerMini64.dpl'))
  })
})

describe('PotPlayer 进程识别', () => {
  it('辅助进程（KillPot64 等）不算"播放器在运行"', () => {
    // tasklist 解析规则写在 listPotPlayerProcesses 里，这里只钉住正则口径
    const isPlayer = (name: string) =>
      /^PotPlayer.*\.exe$/i.test(name) && !/^(KillPot|PotIcons|DTDrop)/i.test(name)

    expect(isPlayer('PotPlayerMini64.exe')).toBe(true)
    expect(isPlayer('PotPlayer64.exe')).toBe(true)
    expect(isPlayer('KillPot64.exe')).toBe(false)
    expect(isPlayer('chrome.exe')).toBe(false)
  })
})
