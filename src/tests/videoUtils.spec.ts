/**
 * 视频页主进程工具测试（electron/utils/video-utils.js）
 *
 * 重点覆盖三件容易出错、且「静默失效」最难查的事：
 *   1. 递归扫描必须**全量**列出视频（不能像 searchMatchingFiles 那样每个文件夹只取第一个）
 *   2. 封面文件名必须**固定**（<videoId>.jpg）——游戏封面那种 <id>_<时间戳> 会越点越多
 *   3. 根目录不可用时**不能**把整库标记为丢失（U 盘拔了/网络盘掉线）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
// CJS 模块（主进程代码），vite 的 CJS interop 会把 module.exports 作为 default 暴露
import videoUtils from '../../electron/utils/video-utils.js'

let tempRoot = ''
let libraryRoot = ''
let saveDataDir = ''

function touch(filePath: string, content = 'x') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

beforeAll(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ggv-video-test-'))
  libraryRoot = path.join(tempRoot, 'library')
  saveDataDir = path.join(tempRoot, 'SaveData')

  // 根目录下：1 个视频 + 1 个非视频
  touch(path.join(libraryRoot, 'a.mp4'))
  touch(path.join(libraryRoot, 'note.txt'))

  // 第一层子目录：2 个视频（关键：同一文件夹里的第二个也必须扫出来）
  touch(path.join(libraryRoot, '合集A', '01.mkv'))
  touch(path.join(libraryRoot, '合集A', '02.AVI')) // 大写扩展名也要认

  // 第二层子目录：1 个视频
  touch(path.join(libraryRoot, '合集A', '子目录', '03.webm'))

  // 应被跳过的目录
  touch(path.join(libraryRoot, '$RECYCLE.BIN', 'junk.mp4'))
  touch(path.join(libraryRoot, 'node_modules', 'pkg', 'demo.mp4'))
})

afterAll(() => {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  } catch (_) {
    // 忽略清理失败
  }
})

describe('scanVideoRoots', () => {
  it('递归列出所有视频，同一文件夹里不会只取第一个', async () => {
    const result = await videoUtils.scanVideoRoots([libraryRoot])
    const root = result.roots[0]
    const relPaths = root.files.map((f: any) => f.relPath).sort()

    expect(root.ok).toBe(true)
    expect(root.exists).toBe(true)
    expect(relPaths).toEqual([
      'a.mp4',
      '合集A/01.mkv',
      '合集A/02.AVI',
      '合集A/子目录/03.webm'
    ])
  })

  it('每条记录都带绝对路径、正斜杠相对路径、大小与稳定 id', async () => {
    const result = await videoUtils.scanVideoRoots([libraryRoot])
    const file = result.roots[0].files.find((f: any) => f.relPath === '合集A/01.mkv')

    expect(file.fullPath).toBe(path.join(libraryRoot, '合集A', '01.mkv'))
    expect(file.rootPath).toBe(libraryRoot)
    expect(file.name).toBe('01')
    expect(file.fileName).toBe('01.mkv')
    expect(file.ext).toBe('mkv')
    expect(typeof file.size).toBe('number')
    expect(file.id).toBe(videoUtils.makeVideoId(file.fullPath))
  })

  it('跳过 $RECYCLE.BIN / node_modules 之类的目录', async () => {
    const result = await videoUtils.scanVideoRoots([libraryRoot])
    const all = result.roots[0].files.map((f: any) => f.relPath.toLowerCase()).join('|')
    expect(all).not.toContain('recycle')
    expect(all).not.toContain('node_modules')
  })

  it('根目录不存在时 exists=false / ok=false（调用方据此不做丢失标记）', async () => {
    const missing = path.join(tempRoot, 'this-folder-does-not-exist')
    const result = await videoUtils.scanVideoRoots([missing])
    const root = result.roots[0]

    expect(root.exists).toBe(false)
    expect(root.ok).toBe(false)
    expect(root.files).toEqual([])
    expect(typeof root.error).toBe('string')
  })

  it('没有绑定任何目录时返回空结果（不会报错）', async () => {
    const result = await videoUtils.scanVideoRoots([])
    expect(result.ok).toBe(true)
    expect(result.roots).toEqual([])
    expect(result.totalFiles).toBe(0)
  })

  it('支持自定义扩展名清单', async () => {
    const result = await videoUtils.scanVideoRoots([libraryRoot], { extensions: ['mkv'] })
    const relPaths = result.roots[0].files.map((f: any) => f.relPath)
    expect(relPaths).toEqual(['合集A/01.mkv'])
  })
})

describe('normalizeExtensions / makeVideoId', () => {
  it('扩展名统一成小写并补点、去重', () => {
    expect(videoUtils.normalizeExtensions(['mp4', '.MKV', 'Avi', 'mp4'])).toEqual(['.mp4', '.mkv', '.avi'])
  })

  it('空清单回落到内置默认清单', () => {
    const list = videoUtils.normalizeExtensions([])
    expect(list).toContain('.mp4')
    expect(list).toContain('.mkv')
  })

  it('id 与路径强绑定：大小写/斜杠不同也算同一个文件', () => {
    const a = videoUtils.makeVideoId('D:\\Videos\\A.mp4')
    const b = videoUtils.makeVideoId('d:/videos/a.mp4')
    expect(a).toBe(b)
    expect(a.startsWith('v')).toBe(true)
    expect(a.length).toBe(21)
  })

  it('路径不同则 id 不同（改名后会被判定为新文件、旧记录变成丢失）', () => {
    expect(videoUtils.makeVideoId('D:\\Videos\\A.mp4'))
      .not.toBe(videoUtils.makeVideoId('D:\\Videos\\B.mp4'))
  })
})

describe('封面：固定文件名 + 覆盖式 + 可删除', () => {
  const videoId = 'v1a2b3c4d5e6f7a8b9c0d'

  it('相对路径与绝对路径都是固定名（不带 <时间戳>，这是「不膨胀」的关键）', () => {
    const relative = videoUtils.getVideoCoverRelativePath(videoId)
    expect(relative).toBe(`videos/covers/${videoId}.jpg`)
    // 游戏封面那种 <id>_<时间戳> 命名靠下划线区分，绝不能出现在视频封面里
    expect(relative).not.toContain('_')

    const absolute = videoUtils.getVideoCoverFile(saveDataDir, videoId)
    expect(absolute).toBe(path.join(saveDataDir, 'videos', 'covers', `${videoId}.jpg`))

    // 反复取同一个 id 的名字必须完全一致（否则就等于每次新建文件）
    expect(videoUtils.getVideoCoverRelativePath(videoId)).toBe(relative)
  })

  it('连续写两次封面只留一个文件（覆盖，不是新增）', async () => {
    const first = await videoUtils.saveVideoCoverFromDataUrl(
      'data:image/jpeg;base64,' + Buffer.from('first-image').toString('base64'),
      saveDataDir,
      videoId
    )
    expect(first.ok).toBe(true)

    const second = await videoUtils.saveVideoCoverFromDataUrl(
      'data:image/jpeg;base64,' + Buffer.from('second-image-longer').toString('base64'),
      saveDataDir,
      videoId
    )
    expect(second.ok).toBe(true)

    const coverDir = videoUtils.getVideoCoverDir(saveDataDir)
    const files = fs.readdirSync(coverDir)
    expect(files).toEqual([`${videoId}.jpg`])
    expect(fs.readFileSync(path.join(coverDir, files[0]), 'utf8')).toBe('second-image-longer')
  })

  it('删除封面时会顺手清掉历史遗留的 <id>_<时间戳>.jpg 孤儿', async () => {
    const coverDir = videoUtils.getVideoCoverDir(saveDataDir)
    fs.mkdirSync(coverDir, { recursive: true })
    fs.writeFileSync(path.join(coverDir, `${videoId}_1700000000000.jpg`), 'legacy')

    const result = await videoUtils.deleteVideoCover(saveDataDir, videoId)
    expect(result.ok).toBe(true)
    expect(result.removed.sort()).toEqual([`${videoId}.jpg`, `${videoId}_1700000000000.jpg`].sort())
    expect(fs.readdirSync(coverDir)).toEqual([])
  })

  it('拒绝非法 dataURL', async () => {
    const result = await videoUtils.saveVideoCoverFromDataUrl('not-a-data-url', saveDataDir, 'vbad')
    expect(result.ok).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* 「重新关联到…」的路径校验（主人选的方案 C：不猜，只校验用户挑的文件）           */
/* -------------------------------------------------------------------------- */

describe('resolveRelinkTarget', () => {
  // ⚠️ 不能在 describe 体里算：那是「收集阶段」，beforeAll 还没跑，libraryRoot 还是空串
  const nestedRootOf = () => path.join(libraryRoot, '合集A')

  it('文件在绑定根目录内 → 算出根目录与相对路径', () => {
    const target = path.join(libraryRoot, '合集A', '子目录', '03.webm')
    const result = videoUtils.resolveRelinkTarget([libraryRoot], target)

    expect(result.ok).toBe(true)
    expect(result.insideRoot).toBe(true)
    expect(result.rootPath).toBe(libraryRoot)
    expect(result.relPath).toBe('合集A/子目录/03.webm')
    expect(result.fileName).toBe('03.webm')
    expect(result.name).toBe('03')
    expect(result.size).toBeGreaterThan(0)
  })

  it('相对路径用正斜杠、且不带根目录前缀（层级浏览靠它）', () => {
    const result = videoUtils.resolveRelinkTarget([libraryRoot], path.join(libraryRoot, 'a.mp4'))
    expect(result.relPath).toBe('a.mp4')
  })

  it('选了不在任何绑定目录里的文件 → 明确拒绝（否则下次扫描又变回「丢失」）', () => {
    const outside = path.join(tempRoot, 'outside.mp4')
    touch(outside)
    const result = videoUtils.resolveRelinkTarget([libraryRoot], outside)

    expect(result.ok).toBe(false)
    expect(result.insideRoot).toBe(false)
    expect(result.error).toContain('不在任何已绑定文件夹内')
  })

  it('一个目录都没绑定时同样拒绝（而不是默默接受）', () => {
    const result = videoUtils.resolveRelinkTarget([], path.join(libraryRoot, 'a.mp4'))
    expect(result.ok).toBe(false)
    expect(result.insideRoot).toBe(false)
  })

  it('文件不存在 → 拒绝', () => {
    const result = videoUtils.resolveRelinkTarget([libraryRoot], path.join(libraryRoot, 'ghost.mp4'))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('不存在')
  })

  it('选的是文件夹 → 拒绝', () => {
    const result = videoUtils.resolveRelinkTarget([libraryRoot], path.join(libraryRoot, '合集A'))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('不是一个文件')
  })

  it('根目录嵌套时取最长匹配（内层优先）', () => {
    const nestedRoot = nestedRootOf()
    const target = path.join(nestedRoot, '01.mkv')
    const result = videoUtils.resolveRelinkTarget([libraryRoot, nestedRoot], target)

    expect(result.rootPath).toBe(nestedRoot)
    expect(result.relPath).toBe('01.mkv')
  })

  it('大小写与斜杠方向不影响判定（Windows 语义）', () => {
    const target = path.join(libraryRoot, 'a.mp4')
    const result = videoUtils.resolveRelinkTarget([libraryRoot.toUpperCase()], target)
    expect(result.ok).toBe(true)
    expect(result.relPath).toBe('a.mp4')
  })

  it('只选中了相似前缀的兄弟目录时不算命中（A 与 AB 不能混淆）', () => {
    const sibling = `${libraryRoot}-other`
    fs.mkdirSync(sibling, { recursive: true })
    const target = path.join(sibling, 'x.mp4')
    touch(target)

    const result = videoUtils.resolveRelinkTarget([libraryRoot], target)
    expect(result.ok).toBe(false)
    expect(result.insideRoot).toBe(false)
  })
})

describe('statVideoFiles', () => {  it('分别回报存在与不存在', async () => {
    const existing = path.join(libraryRoot, 'a.mp4')
    const missing = path.join(libraryRoot, 'nope.mp4')
    const result = await videoUtils.statVideoFiles([existing, missing])

    expect(result[0].exists).toBe(true)
    expect(typeof result[0].atimeMs).toBe('number')
    expect(result[1].exists).toBe(false)
  })
})

describe('ffmpeg 抽帧（本机装了 ffmpeg 才跑）', () => {
  const info = videoUtils.findFfmpeg()

  it('能定位到 ffmpeg 或明确报告没有', () => {
    expect(info).toHaveProperty('ffmpeg')
    expect(info).toHaveProperty('source')
    if (!info.ffmpeg) {
      console.info('[skip] 本机没有 ffmpeg，跳过抽帧实测')
    }
  })

  it.skipIf(!info.ffmpeg)('真的能从视频里抽出一帧 jpg（覆盖式写入）', async () => {
    const { execFileSync } = await import('child_process')
    const videoPath = path.join(tempRoot, 'sample.mp4')
    // 用 ffmpeg 造一段 2 秒的测试视频
    execFileSync(info.ffmpeg as string, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=10',
      '-pix_fmt', 'yuv420p', videoPath
    ], { windowsHide: true })

    const coverFile = videoUtils.getVideoCoverFile(saveDataDir, 'vsample')
    const result = await videoUtils.grabRandomFrame(videoPath, coverFile, { maxWidth: 320 })

    expect(result.ok).toBe(true)
    expect(result.method).toBe('ffmpeg')
    expect(fs.existsSync(coverFile)).toBe(true)
    expect(fs.statSync(coverFile).size).toBeGreaterThan(0)
    // 时长探测成功时，抽帧点应落在视频内部
    if (result.duration) {
      expect(result.time).toBeGreaterThanOrEqual(0)
      expect(result.time).toBeLessThanOrEqual(result.duration)
    }

    // 再抽一次：仍然是同一个文件（覆盖）
    const again = await videoUtils.grabRandomFrame(videoPath, coverFile, { maxWidth: 320 })
    expect(again.ok).toBe(true)
    expect(fs.readdirSync(path.dirname(coverFile)).filter((f: string) => f.startsWith('vsample'))).toHaveLength(1)
  })

  it('源文件不存在时明确回报 source-missing', async () => {
    const result = await videoUtils.grabRandomFrame(
      path.join(tempRoot, 'ghost.mp4'),
      path.join(tempRoot, 'ghost.jpg')
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('source-missing')
  })
})
