/**
 * 视频库 composable 的「层级浏览」与「打开次数」逻辑测试
 *
 * 这里刻意不碰 Electron：只喂假数据，验证
 *   - 每一层只显示「本层」的视频（子目录里的不混进来）
 *   - 子文件夹卡片的数量按递归统计
 *   - 面包屑与解绑后的过滤行为
 *   - 打开次数 +1 与 visitedSessions 时间线
 */
import { describe, it, expect, vi } from 'vitest'
import { ref, computed } from 'vue'
import { useVideoLibrary } from '../composables/video/useVideoLibrary'

/** 造一个「像 ResourceField」的字段包装（fieldValue 两种形态都认） */
function field<T>(value: T) {
  return { value }
}

function makeItem(id: string, rootPath: string, relPath: string, extra: Record<string, any> = {}) {
  const folder = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : ''
  void folder
  return {
    id: field(id),
    rootPath: field(rootPath),
    relPath: field(relPath),
    resourcePath: field(`${rootPath}\\${relPath.replace(/\//g, '\\')}`),
    fileSize: field(0),
    watchCount: field(0),
    visitedSessions: field([]),
    lastAccessSeenMs: field(0),
    fileExists: field(true),
    ...extra
  }
}

const ROOT_A = 'D:\\VideosA'
const ROOT_B = 'E:\\VideosB'

function setup() {
  const items = ref<any[]>([
    makeItem('v1', ROOT_A, 'top.mp4'),
    makeItem('v2', ROOT_A, '合集A/01.mkv'),
    makeItem('v3', ROOT_A, '合集A/02.mkv'),
    makeItem('v4', ROOT_A, '合集A/子目录/03.webm'),
    makeItem('v5', ROOT_B, 'b1.mp4')
  ])

  const lib = useVideoLibrary({
    enabled: true,
    items: items as any,
    resourceClass: class FakeVideo {},
    isElectronEnvironment: ref(false),
    save: vi.fn(async () => true)
  })

  // 直接把绑定目录塞进去（绕过设置读写）
  lib.roots.value = [ROOT_A, ROOT_B]

  return { items, lib }
}

describe('视频库 · 层级浏览', () => {
  it('「全部」层显示所有绑定目录里的视频', () => {
    const { lib } = setup()
    expect(lib.scopedItems.value.map((i: any) => i.id.value)).toEqual(['v1', 'v2', 'v3', 'v4', 'v5'])
  })

  it('「全部」层给出每个根目录一张文件夹卡片，数量是递归总数', () => {
    const { lib } = setup()
    const cards = lib.folderCards.value
    expect(cards).toHaveLength(2)
    expect(cards[0].kind).toBe('root')
    expect(cards[0].name).toBe(ROOT_A)
    expect(cards[0].count).toBe(4) // top + 合集A 两个 + 子目录一个
    expect(cards[1].count).toBe(1)
  })

  it('进入根目录后：只显示本层视频，子目录里的文件不混进来', () => {
    const { lib } = setup()
    lib.currentRoot.value = ROOT_A
    lib.currentRel.value = ''

    expect(lib.scopedItems.value.map((i: any) => i.id.value)).toEqual(['v1'])
    expect(lib.folderCards.value.map((c: any) => c.name)).toEqual(['合集A'])
    expect(lib.folderCards.value[0].count).toBe(3) // 合集A 下 2 个 + 子目录 1 个
  })

  it('文件夹卡片带上「子树视频标签的并集」（含更深层级，2026-10-05 改口径）', () => {
    const items = ref<any[]>([
      makeItem('v1', ROOT_A, '合集A/01.mkv', { tags: field(['3D作品', '收藏']) }),
      makeItem('v2', ROOT_A, '合集A/02.mkv', { tags: field(['2D作品']) }),
      makeItem('v3', ROOT_A, '合集A/深层B/03.webm', { tags: field(['深层标签']) }),
      makeItem('v4', ROOT_A, '顶层.mp4', { tags: field(['根标签']) })
    ])
    const lib = useVideoLibrary({
      enabled: true,
      items: items as any,
      resourceClass: class FakeVideo {},
      isElectronEnvironment: ref(false),
      save: vi.fn(async () => true)
    })
    lib.roots.value = [ROOT_A]

    // 「全部」层的根卡片：整棵根目录树的标签并集
    expect(lib.folderCards.value[0].tags).toEqual(
      ['2D作品', '3D作品', '深层标签', '根标签', '收藏'].sort((a, b) => a.localeCompare(b, 'zh-CN'))
    )

    // 进入根目录 → 合集A 卡片 = 它整棵子树的并集（含 深层B）
    lib.currentRoot.value = ROOT_A
    const folderA = lib.folderCards.value.find((c: any) => c.name === '合集A')
    expect(folderA.tags).toEqual(['2D作品', '3D作品', '深层标签', '收藏'].sort((a, b) => a.localeCompare(b, 'zh-CN')))
  })

  it('「只有子文件夹」的目录层：左栏筛选池不为空（主人报的第 1 个问题）', () => {
    const items = ref<any[]>([
      makeItem('v1', ROOT_A, '外层/内层/深一层/x.mp4', { tags: field(['深层标签']) })
    ])
    const lib = useVideoLibrary({
      enabled: true,
      items: items as any,
      resourceClass: class FakeVideo {},
      isElectronEnvironment: ref(false),
      save: vi.fn(async () => true)
    })
    lib.roots.value = [ROOT_A]
    lib.currentRoot.value = ROOT_A
    lib.currentRel.value = '外层'

    // 这一层直接子文件是 0 个（正例是"同时有视频和子文件夹"）
    expect(lib.scopedItems.value).toHaveLength(0)
    // 但筛选池（子树）里要有东西，否则左栏标签/作者/格式全空
    expect(lib.scopePool.value.map((i: any) => i.id.value)).toEqual(['v1'])
    // 内层目录卡片照旧，且带着深层视频的标签并集
    expect(lib.folderCards.value.map((c: any) => c.name)).toEqual(['内层'])
    expect(lib.folderCards.value[0].tags).toEqual(['深层标签'])
  })

  it('进入子目录后：只显示那一层的视频，并列出更深的子目录', () => {
    const { lib } = setup()
    lib.currentRoot.value = ROOT_A
    lib.currentRel.value = '合集A'

    expect(lib.scopedItems.value.map((i: any) => i.id.value).sort()).toEqual(['v2', 'v3'])
    expect(lib.folderCards.value.map((c: any) => c.name)).toEqual(['子目录'])
    expect(lib.folderCards.value[0].rel).toBe('合集A/子目录')
  })

  it('面包屑：全部 › 根目录 › 子目录 › 子子目录', () => {
    const { lib } = setup()
    lib.currentRoot.value = ROOT_A
    lib.currentRel.value = '合集A/子目录'

    expect(lib.breadcrumb.value.map((c: any) => c.label)).toEqual(['全部', ROOT_A, '合集A', '子目录'])
    expect(lib.breadcrumb.value[3].rel).toBe('合集A/子目录')
  })

  it('上一级：从子子目录退到子目录，再退到根目录，最后回到全部', () => {
    const { lib } = setup()
    lib.currentRoot.value = ROOT_A
    lib.currentRel.value = '合集A/子目录'

    lib.goUp()
    expect(lib.currentRel.value).toBe('合集A')
    lib.goUp()
    expect(lib.currentRel.value).toBe('')
    expect(lib.currentRoot.value).toBe(ROOT_A)
    lib.goUp()
    expect(lib.currentRoot.value).toBeNull()
  })

  it('解绑的根目录不再显示（但记录仍在 items 里，重新绑定就能回来）', () => {
    const { items, lib } = setup()
    lib.roots.value = [ROOT_B]

    expect(lib.scopedItems.value.map((i: any) => i.id.value)).toEqual(['v5'])
    expect(items.value).toHaveLength(5)
  })

  it('一个目录都没绑定时，页面是空的（会走「绑定文件夹」空状态）', () => {
    const { lib } = setup()
    lib.roots.value = []
    expect(lib.scopedItems.value).toEqual([])
    expect(lib.folderCards.value).toEqual([])
    expect(lib.hasRoots.value).toBe(false)
  })

  it('根目录名比较不区分大小写与斜杠方向', () => {
    const { lib } = setup()
    lib.currentRoot.value = 'd:/videosa'
    expect(lib.scopedItems.value.map((i: any) => i.id.value)).toEqual(['v1'])
  })
})

describe('视频库 · 打开次数', () => {
  it('bumpOpenCount 同时维护次数与时间线，并把 atime 基线顶到现在', async () => {
    const { lib } = setup()
    const item = lib.scopedItems.value[0]

    await lib.bumpOpenCount(item, Date.parse('2026-01-02T03:04:05.000Z'))

    expect(item.watchCount.value).toBe(1)
    expect(item.visitedSessions.value).toEqual(['2026-01-02T03:04:05.000Z'])
    expect(item.lastAccessSeenMs.value).toBeGreaterThanOrEqual(Date.parse('2026-01-02T03:04:05.000Z'))

    await lib.bumpOpenCount(item, Date.parse('2026-01-03T00:00:00.000Z'))
    expect(item.watchCount.value).toBe(2)
    expect(item.visitedSessions.value).toHaveLength(2)
  })
})

describe('视频库 · 关闭态不影响其它页面', () => {
  it('enabled=false 时 scopedItems 就是原始 items（游戏页复用时不会丢数据）', () => {
    const items = ref<any[]>([makeItem('v1', ROOT_A, 'a.mp4')])
    const lib = useVideoLibrary({
      enabled: false,
      items: items as any,
      resourceClass: class FakeVideo {},
      isElectronEnvironment: ref(false),
      save: vi.fn(async () => true)
    })
    expect(lib.scopedItems.value).toBe(items.value)
    expect(computed(() => lib.folderCards.value).value).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* 扫描同步：新增 / 丢失标记 / 根目录掉线                                       */
/* -------------------------------------------------------------------------- */

function scanFile(id: string, rootPath: string, relPath: string, size = 100) {
  return {
    id,
    relPath,
    fullPath: `${rootPath}\\${relPath.replace(/\//g, '\\')}`,
    rootPath,
    name: relPath.split('/').pop()!.replace(/\.[^.]+$/, ''),
    fileName: relPath.split('/').pop(),
    ext: 'mp4',
    size,
    mtimeMs: 1,
    atimeMs: 1
  }
}

/** 造一个只实现 videoScan 的假 electronAPI */
function installFakeApi(scanResponse: any) {
  const videoScan = vi.fn(async () => scanResponse)
  ;(globalThis as any).window.electronAPI = { videoScan }
  return { videoScan }
}

function makeVideoClass() {
  // 只要能被 new 出来并承载字段即可
  return class FakeVideo {
    [key: string]: any
  }
}

describe('视频库 · 扫描同步', () => {
  it('扫描到的新文件会建记录，并带上路径/大小/入库时间', async () => {
    const items = ref<any[]>([])
    installFakeApi({
      ok: true,
      data: {
        scannedAt: '2026-01-01T00:00:00.000Z',
        roots: [{ root: ROOT_A, ok: true, exists: true, files: [scanFile('v1', ROOT_A, '合集/a.mp4', 2048)] }]
      }
    })

    const save = vi.fn(async () => true)
    const lib = useVideoLibrary({
      enabled: true,
      items: items as any,
      resourceClass: makeVideoClass(),
      isElectronEnvironment: ref(true),
      save
    })
    lib.roots.value = [ROOT_A]
    await lib.rescan()

    expect(items.value).toHaveLength(1)
    const created = items.value[0]
    expect(created.id).toBe('v1')
    expect(created.resourcePath).toBe(`${ROOT_A}\\合集\\a.mp4`)
    expect(created.fileSize).toBe(2048)
    expect(created.fileExists).toBe(true)
    // 入库时间是「发现它的那一刻」，不是扫描时间戳
    expect(Number.isFinite(Date.parse(String(created.addedDate)))).toBe(true)
    expect(save).toHaveBeenCalled()
  })

  it('扫描不到但根目录可用的记录 → 标记为丢失（左栏「丢失的文件」靠它）', async () => {
    const items = ref<any[]>([makeItem('v1', ROOT_A, '还在.mp4'), makeItem('v2', ROOT_A, '没了.mp4')])
    installFakeApi({
      ok: true,
      data: {
        scannedAt: '2026-01-02T00:00:00.000Z',
        roots: [{ root: ROOT_A, ok: true, exists: true, files: [scanFile('v1', ROOT_A, '还在.mp4')] }]
      }
    })

    const save = vi.fn(async () => true)
    const lib = useVideoLibrary({
      enabled: true,
      items: items as any,
      resourceClass: makeVideoClass(),
      isElectronEnvironment: ref(true),
      save
    })
    lib.roots.value = [ROOT_A]
    await lib.rescan()

    expect(items.value[0].fileExists.value).toBe(true)
    expect(items.value[1].fileExists.value).toBe(false)
    expect(save).toHaveBeenCalled()
  })

  it('根目录掉线（U 盘拔了/网络盘断）时绝不标记丢失，避免整库误报', async () => {
    const items = ref<any[]>([makeItem('v1', ROOT_A, 'a.mp4'), makeItem('v2', ROOT_A, 'b.mp4')])
    installFakeApi({
      ok: true,
      data: {
        scannedAt: '2026-01-03T00:00:00.000Z',
        roots: [{ root: ROOT_A, ok: false, exists: false, error: '目录不存在或未挂载', files: [] }]
      }
    })

    const save = vi.fn(async () => true)
    const lib = useVideoLibrary({
      enabled: true,
      items: items as any,
      resourceClass: makeVideoClass(),
      isElectronEnvironment: ref(true),
      save
    })
    lib.roots.value = [ROOT_A]
    await lib.rescan()

    expect(items.value.every((i: any) => i.fileExists.value === true)).toBe(true)
    expect(lib.rootInfos.value[0].available).toBe(false)
    expect(save).not.toHaveBeenCalled()
  })

  it('文件回来了 → 丢失标记自动解除', async () => {
    const items = ref<any[]>([makeItem('v1', ROOT_A, 'a.mp4', { fileExists: field(false) })])
    installFakeApi({
      ok: true,
      data: {
        scannedAt: '2026-01-04T00:00:00.000Z',
        roots: [{ root: ROOT_A, ok: true, exists: true, files: [scanFile('v1', ROOT_A, 'a.mp4')] }]
      }
    })

    const lib = useVideoLibrary({
      enabled: true,
      items: items as any,
      resourceClass: makeVideoClass(),
      isElectronEnvironment: ref(true),
      save: vi.fn(async () => true)
    })
    lib.roots.value = [ROOT_A]
    await lib.rescan()

    expect(items.value[0].fileExists.value).toBe(true)
  })

  it('重新扫描时保留用户标签与打开次数（同步只动文件相关字段）', async () => {
    const items = ref<any[]>([
      makeItem('v1', ROOT_A, 'a.mp4', { tags: field(['教学', '收藏']), watchCount: field(7) })
    ])
    installFakeApi({
      ok: true,
      data: {
        scannedAt: '2026-01-05T00:00:00.000Z',
        roots: [{ root: ROOT_A, ok: true, exists: true, files: [scanFile('v1', ROOT_A, 'a.mp4', 999)] }]
      }
    })

    const lib = useVideoLibrary({
      enabled: true,
      items: items as any,
      resourceClass: makeVideoClass(),
      isElectronEnvironment: ref(true),
      save: vi.fn(async () => true)
    })
    lib.roots.value = [ROOT_A]
    await lib.rescan()

    expect(items.value[0].tags.value).toEqual(['教学', '收藏'])
    expect(items.value[0].watchCount.value).toBe(7)
    expect(items.value[0].fileSize.value).toBe(999) // 大小按实际文件更新
  })

  it('没有绑定目录时不发 IPC 请求', async () => {
    const items = ref<any[]>([])
    const { videoScan } = installFakeApi({ ok: true, data: { roots: [], scannedAt: '', totalFiles: 0 } })
    const lib = useVideoLibrary({
      enabled: true,
      items: items as any,
      resourceClass: makeVideoClass(),
      isElectronEnvironment: ref(true),
      save: vi.fn(async () => true)
    })
    lib.roots.value = []
    await lib.rescan()
    expect(videoScan).not.toHaveBeenCalled()
  })

  it('整个子文件夹改名 → 第一次扫描就自动重连，不新建记录、不标丢失（主人报的第 2 个问题）', async () => {
    const items = ref<any[]>([
      makeItem('v1', ROOT_A, '合集A/01.mkv', { fileName: field('01.mkv'), tags: field(['教学']), watchCount: field(3) }),
      makeItem('v2', ROOT_A, '合集A/02.mkv', { fileName: field('02.mkv'), tags: field(['收藏']) }),
      makeItem('v3', ROOT_A, '合集A/深层/03.mkv', { fileName: field('03.mkv') })
    ])
    installFakeApi({
      ok: true,
      data: {
        scannedAt: '2026-10-05T00:00:00.000Z',
        roots: [{
          root: ROOT_A,
          ok: true,
          exists: true,
          files: [
            scanFile('n1', ROOT_A, '合集A2/01.mkv'),
            scanFile('n2', ROOT_A, '合集A2/02.mkv'),
            scanFile('n3', ROOT_A, '合集A2/深层/03.mkv')
          ]
        }]
      }
    })

    const save = vi.fn(async () => true)
    const lib = useVideoLibrary({
      enabled: true,
      items: items as any,
      resourceClass: makeVideoClass(),
      isElectronEnvironment: ref(true),
      save
    })
    lib.roots.value = [ROOT_A]
    await lib.rescan()

    // 一条新记录都不该建：231 个文件变成 462 条的根源就在这里
    expect(items.value).toHaveLength(3)
    expect(items.value.map((i: any) => i.id.value)).toEqual(['v1', 'v2', 'v3'])
    // 路径跟着换，标签与打开次数一个都不能丢
    expect(items.value[0].resourcePath.value).toBe(`${ROOT_A}\\合集A2\\01.mkv`)
    expect(items.value[0].relPath.value).toBe('合集A2/01.mkv')
    expect(items.value[0].tags.value).toEqual(['教学'])
    expect(items.value[0].watchCount.value).toBe(3)
    expect(items.value.every((i: any) => i.fileExists.value === true)).toBe(true)
    // 回收站里干干净净
    expect(lib.missingItems.value).toEqual([])
    expect(save).toHaveBeenCalled()
  })

  it('同名文件有多个候选时绝不乱认（宁可各留一条）', async () => {
    const items = ref<any[]>([
      makeItem('v1', ROOT_A, 'A/x.mp4', { fileName: field('x.mp4') }),
      makeItem('v2', ROOT_A, 'B/x.mp4', { fileName: field('x.mp4') })
    ])
    installFakeApi({
      ok: true,
      data: {
        scannedAt: '2026-10-05T00:00:00.000Z',
        roots: [{
          root: ROOT_A,
          ok: true,
          exists: true,
          files: [scanFile('n1', ROOT_A, 'C/x.mp4')]
        }]
      }
    })

    const lib = useVideoLibrary({
      enabled: true,
      items: items as any,
      resourceClass: makeVideoClass(),
      isElectronEnvironment: ref(true),
      save: vi.fn(async () => true)
    })
    lib.roots.value = [ROOT_A]
    await lib.rescan()

    // 新文件建新记录，两条老的标丢失 —— 不猜哪条才是它
    expect(items.value).toHaveLength(3)
    expect(items.value.filter((i: any) => i.fileExists.value === false)).toHaveLength(2)
    expect(lib.missingItems.value).toHaveLength(2)
  })
})

/* -------------------------------------------------------------------------- */
/* 回收站：主视图只显示真实存在的文件                                            */
/* -------------------------------------------------------------------------- */

describe('视频库 · 回收站（丢失的文件）', () => {
  function setupMissing() {
    const items = ref<any[]>([
      makeItem('v1', ROOT_A, 'alive/还活着.mp4', { fileName: field('还活着.mp4') }),
      makeItem('v2', ROOT_A, '合集A/gone1.mp4', {
        fileName: field('gone1.mp4'), fileExists: field(false), tags: field(['教学'])
      }),
      makeItem('v3', ROOT_A, '合集A/子目录/gone2.mp4', {
        fileName: field('gone2.mp4'), fileExists: field(false), tags: field(['收藏'])
      }),
      makeItem('v4', ROOT_B, '别的根/gone3.mp4', {
        fileName: field('gone3.mp4'), fileExists: field(false)
      })
    ])
    const lib = useVideoLibrary({
      enabled: true,
      items: items as any,
      resourceClass: class FakeVideo {},
      isElectronEnvironment: ref(false),
      save: vi.fn(async () => true)
    })
    lib.roots.value = [ROOT_A, ROOT_B]
    return { items, lib }
  }

  it('主视图不含丢失的文件，也不含丢失撑起来的文件夹卡片', () => {
    const { lib } = setupMissing()
    expect(lib.scopedItems.value.map((i: any) => i.id.value)).toEqual(['v1'])

    // 进到根目录层：只剩 alive 一张卡 —— 已经消失的「合集A」不再留在主视图里
    lib.currentRoot.value = ROOT_A
    expect(lib.folderCards.value.map((c: any) => c.name)).toEqual(['alive'])
    // 而 ROOT_B 下唯一的东西是丢失文件 → 一张卡都不该有
    lib.currentRoot.value = ROOT_B
    expect(lib.folderCards.value).toEqual([])
  })

  it('丢失的记录只出现在回收站里（按原目录重建）', () => {
    const { lib } = setupMissing()
    expect(lib.missingItems.value.map((i: any) => i.id.value).sort()).toEqual(['v2', 'v3', 'v4'])

    // 顶层：合集A（2 个：自己 1 个 + 子目录 1 个）与 别的根（1 个）
    const top = lib.recycleFolderCards.value
    expect(top.map((c: any) => c.name).sort()).toEqual(['别的根', '合集A'])
    expect(top.every((c: any) => c.kind === 'missing')).toBe(true)
    const hejiA = top.find((c: any) => c.name === '合集A')
    expect(hejiA.count).toBe(2)
    // 回收站里的文件夹也带子树标签并集（方便按标签找回）
    expect(hejiA.tags).toEqual(['教学', '收藏'].sort((a, b) => a.localeCompare(b, 'zh-CN')))

    // 进入 合集A → 列出它这一层的丢失文件 + 更深的子目录卡片
    lib.setRecycleRel('合集A')
    expect(lib.recycleFiles.value.map((i: any) => i.id.value)).toEqual(['v2'])
    expect(lib.recycleFolderCards.value.map((c: any) => c.rel)).toEqual(['合集A/子目录'])

    // 回到顶层
    lib.resetRecycle()
    expect(lib.recycleRel.value).toBe('')
  })

  it('切换目录/回到上一级会自动退出回收站的层级', () => {
    const { lib } = setupMissing()
    lib.setRecycleRel('合集A')
    lib.enterFolder({ kind: 'root', root: ROOT_A, rel: '', name: ROOT_A, key: 'r', count: 0, fullPath: ROOT_A, tags: [] })
    expect(lib.recycleRel.value).toBe('')
  })
})

/* -------------------------------------------------------------------------- */
/* 「整个文件夹重新关联到…」：批量接回 + 合并扫描重复记录                         */
/* -------------------------------------------------------------------------- */

describe('视频库 · 整夹重新关联', () => {
  it('挑一次新目录就把整夹接回来，并合并同路径的重复记录', async () => {
    const items = ref<any[]>([
      // 老记录：文件"丢了"，但带着标签与打开次数
      makeItem('v1', ROOT_A, '合集A/01.mkv', {
        fileName: field('01.mkv'), fileExists: field(false), tags: field(['教学']), watchCount: field(5)
      }),
      makeItem('v2', ROOT_A, '合集A/02.mkv', {
        fileName: field('02.mkv'), fileExists: field(false)
      }),
      // 扫描按新路径建出来的"空壳"记录
      makeItem('n1', ROOT_A, '合集A2/01.mkv', { fileName: field('01.mkv') })
    ])

    const videoRelinkBatch = vi.fn(async () => ({
      ok: true,
      folderPath: `${ROOT_A}\\合集A2`,
      results: [
        {
          id: 'v1', ok: true, path: `${ROOT_A}\\合集A2\\01.mkv`, rootPath: ROOT_A,
          relPath: '合集A2/01.mkv', fileName: '01.mkv', size: 111
        },
        { id: 'v2', ok: false, reason: 'not-found', message: '找不到' }
      ]
    }))
    ;(globalThis as any).window.electronAPI = {
      selectFolder: vi.fn(async () => ({ success: true, path: `${ROOT_A}\\合集A2` })),
      videoRelinkBatch
    }

    const save = vi.fn(async () => true)
    const lib = useVideoLibrary({
      enabled: true,
      items: items as any,
      resourceClass: makeVideoClass(),
      isElectronEnvironment: ref(true),
      save
    })
    lib.roots.value = [ROOT_A]

    const card = lib.recycleFolderCards.value[0]
    expect(card.rel).toBe('合集A')
    const summary = await lib.relinkMissingFolder(card)

    expect(summary).toEqual({ ok: 1, merged: 1, failed: 1 })
    expect(videoRelinkBatch).toHaveBeenCalledTimes(1)
    // 入参是「相对丢失文件夹的内层路径」
    const payload = videoRelinkBatch.mock.calls[0][0]
    expect(payload.entries).toEqual([
      { id: 'v1', innerRel: '01.mkv', fileName: '01.mkv' },
      { id: 'v2', innerRel: '02.mkv', fileName: '02.mkv' }
    ])

    // 老记录接回来了：ID / 标签 / 打开次数都保住，重复记录被合并后删除
    expect(items.value.map((i: any) => i.id.value).sort()).toEqual(['v1', 'v2'])
    expect(items.value[0].fileExists.value).toBe(true)
    expect(items.value[0].tags.value).toEqual(['教学'])
    expect(items.value[0].watchCount.value).toBe(5)
    expect(items.value[0].resourcePath.value).toBe(`${ROOT_A}\\合集A2\\01.mkv`)
    expect(save).toHaveBeenCalled()
  })

  it('在子目录里进回收站：卡片的 rel 相对当前层，切 relPath 用相对根目录的那一段', async () => {
    const items = ref<any[]>([
      makeItem('v1', ROOT_A, '外层/内层/01.mkv', {
        fileName: field('01.mkv'), fileExists: field(false), tags: field(['教学'])
      })
    ])
    const videoRelinkBatch = vi.fn(async () => ({
      ok: true,
      folderPath: `${ROOT_A}\\外层\\内层2`,
      results: [{
        id: 'v1', ok: true, path: `${ROOT_A}\\外层\\内层2\\01.mkv`, rootPath: ROOT_A,
        relPath: '外层/内层2/01.mkv', fileName: '01.mkv', size: 10
      }]
    }))
    ;(globalThis as any).window.electronAPI = {
      selectFolder: vi.fn(async () => ({ success: true, path: `${ROOT_A}\\外层\\内层2` })),
      videoRelinkBatch
    }

    const lib = useVideoLibrary({
      enabled: true,
      items: items as any,
      resourceClass: makeVideoClass(),
      isElectronEnvironment: ref(true),
      save: vi.fn(async () => true)
    })
    lib.roots.value = [ROOT_A]
    lib.currentRoot.value = ROOT_A
    lib.currentRel.value = '外层'

    const card = lib.recycleFolderCards.value[0]
    expect(card.rel).toBe('内层') // 相对当前层（'外层'）
    expect(card.fullPath).toBe(`${ROOT_A}\\外层\\内层`) // 磁盘上的旧绝对路径

    const summary = await lib.relinkMissingFolder(card)

    expect(summary.ok).toBe(1)
    // 内层相对路径必须是「相对丢失文件夹」的，而不是相对根目录的
    expect(videoRelinkBatch.mock.calls[0][0].entries).toEqual([
      { id: 'v1', innerRel: '01.mkv', fileName: '01.mkv' }
    ])
    expect(items.value[0].fileExists.value).toBe(true)
    expect(items.value[0].relPath.value).toBe('外层/内层2/01.mkv')
  })

  it('用户取消选择文件夹时什么都不做', async () => {    const items = ref<any[]>([
      makeItem('v1', ROOT_A, '合集A/01.mkv', { fileName: field('01.mkv'), fileExists: field(false) })
    ])
    const videoRelinkBatch = vi.fn()
    ;(globalThis as any).window.electronAPI = {
      selectFolder: vi.fn(async () => ({ success: false })),
      videoRelinkBatch
    }

    const lib = useVideoLibrary({
      enabled: true,
      items: items as any,
      resourceClass: makeVideoClass(),
      isElectronEnvironment: ref(true),
      save: vi.fn(async () => true)
    })
    lib.roots.value = [ROOT_A]

    const summary = await lib.relinkMissingFolder(lib.recycleFolderCards.value[0])
    expect(summary).toEqual({ ok: 0, merged: 0, failed: 0 })
    expect(videoRelinkBatch).not.toHaveBeenCalled()
    expect(items.value[0].fileExists.value).toBe(false)
  })
})
