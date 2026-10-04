/**
 * 视频库 composable
 *
 * 职责（对应「视频」页的只读标签管理定位）：
 *   1. 绑定文件夹的增删与持久化（settings.videoRoots / videoExtensions）
 *   2. 递归扫描 → 与 SQLite 里的视频记录做**增量同步**：
 *        新增文件 → 建记录；文件消失 → 标记 fileExists=false（左侧「丢失的文件」筛选靠它）；
 *        文件还在 → 只更新大小/时间，**绝不碰用户打的标签**
 *   3. 层级浏览：当前根目录 + 当前相对子目录 → 面包屑、子文件夹卡片、当前层视频
 *   4. 实时更新：fs.watch（主进程）变化事件 → debounce 后自动重新扫描
 *   5. 打开次数：App 内点开立即 +1；外部播放器打开靠 atime 轮询兜底（带去重）
 *   6. 抽帧封面：ffmpeg 优先，失败回退 <video>+<canvas>；固定文件名**覆盖式**写入，永不膨胀
 *
 * 设计取舍：
 *   - 记录 ID = 文件绝对路径的哈希（主进程 makeVideoId 生成）——
 *     文件改名后旧记录变成「丢失的文件」，路径复用则标签原样回来。
 *   - 解绑的根目录**不删记录**，只是不再显示；重新绑定即可恢复标签。
 *   - 根目录不可用（U 盘拔了/网络盘掉线）时**不做丢失标记**，避免整库误报。
 */
import { ref, computed, type Ref } from 'vue'
import notify from '../../utils/NotificationService'
import saveManager from '../../utils/SaveManager'
// 文件夹标签并集 / 筛选下的可见性（纯函数，可单测）
import { collectFolderTags } from '../../utils/videoFolderFilter'

/** 与主进程 video-utils.DEFAULT_VIDEO_EXTENSIONS 保持一致（这里只用于设置页展示与回退） */
export const DEFAULT_VIDEO_EXTENSIONS = [
  '.mp4', '.mkv', '.avi', '.wmv', '.mov', '.flv', '.webm', '.m4v',
  '.mpg', '.mpeg', '.ts', '.m2ts', '.mts', '.rmvb', '.rm', '.3gp',
  '.vob', '.ogv', '.ogm', '.asf', '.f4v', '.divx', '.m2v', '.dat'
]

/** atime 兜底轮询间隔（毫秒）——NTFS 的 atime 是懒写，所以不必查得太勤 */
const ATIME_POLL_INTERVAL = 60 * 1000

/** atime 与「我们已知的访问时间」相差超过这个阈值才算一次新的外部打开 */
const ATIME_NEW_OPEN_THRESHOLD = 2000

/** 每轮 atime 轮询最多查多少个文件，避免大目录把主进程问爆 */
const ATIME_POLL_BATCH_LIMIT = 800

/** 抽帧封面的目标宽度（控制封面体积） */
const COVER_MAX_WIDTH = 640

export interface VideoRootInfo {
  root: string
  available: boolean
  error?: string
  fileCount: number
}

export interface FolderCard {
  key: string
  name: string
  kind: 'root' | 'folder'
  root: string | null
  rel: string
  count: number
  fullPath: string
  /**
   * 该文件夹**直接**包含的视频标签并集（不含子文件夹）——
   * 用于「筛选条件下仍显示文件夹」（见 utils/videoFolderFilter.ts）
   */
  tags: string[]
}

export interface BreadcrumbItem {
  label: string
  root: string | null
  rel: string
}

export interface UseVideoLibraryOptions {
  /** 是否为视频页（false 时所有能力空转，保证复用到其它页面也安全） */
  enabled: boolean
  /** 全量记录（与页面共用同一个 ref，增删就地生效） */
  items: Ref<any[]>
  /** 资源类（Video） */
  resourceClass: any
  /** 是否 Electron 环境 */
  isElectronEnvironment: Ref<boolean>
  /** 落库回调（页面自己的 saveData） */
  save: () => Promise<any>
}

/** 路径比较用的归一化键（Windows 大小写不敏感 + 反斜杠统一 + 去掉尾部分隔符） */
function pathKey(input: string): string {
  return String(input || '')
    .replace(/\//g, '\\')
    .replace(/\\+$/, '')
    .toLowerCase()
}

/** 相对路径拼接 */
function joinRel(base: string, name: string): string {
  return base ? `${base}/${name}` : name
}

/** 取 ResourceField / 普通值 */
function fieldValue(field: any): any {
  if (field && typeof field === 'object' && 'value' in field) return field.value
  return field
}

/** 写 ResourceField / 普通值 */
function setField(item: any, key: string, value: any): void {
  const current = item?.[key]
  if (current && typeof current === 'object' && 'value' in current) {
    current.value = value
  } else if (item) {
    item[key] = value
  }
}

export function useVideoLibrary(options: UseVideoLibraryOptions) {
  const { enabled, items, resourceClass: ResourceClass, isElectronEnvironment, save } = options

  const api = () => (typeof window !== 'undefined' ? (window as any).electronAPI : null)

  /* ------------------------------ 状态 ------------------------------ */

  const roots = ref<string[]>([])
  const extensions = ref<string[]>([...DEFAULT_VIDEO_EXTENSIONS])
  const rootInfos = ref<VideoRootInfo[]>([])
  const isScanning = ref(false)
  const lastScanAt = ref<string | null>(null)
  /** 监听是否健康；不健康时前端提示「实时更新不可用，请手动刷新」 */
  const watcherHealthy = ref(true)
  const watcherErrors = ref<Array<{ root: string, error: string }>>([])
  const ffmpegInfo = ref<{ available: boolean, path: string | null, source: string } | null>(null)

  /** 当前浏览的根目录；null = 全部 */
  const currentRoot = ref<string | null>(null)
  /** 当前浏览的相对子目录（'' = 根目录层） */
  const currentRel = ref<string>('')

  let removeLibraryChangedListener: null | (() => void) = null
  let atimeTimer: ReturnType<typeof setInterval> | null = null
  let initialized = false

  /* ------------------------------ 计算属性 ------------------------------ */

  /** 当前已绑定的根目录键集合（用于过滤掉解绑后残留的记录） */
  const rootKeySet = computed(() => new Set(roots.value.map(pathKey)))

  /** 绑定根目录内、且属于当前层级的视频 */
  const scopedItems = computed<any[]>(() => {
    if (!enabled) return items.value
    const all = items.value || []
    const keys = rootKeySet.value
    if (keys.size === 0) return []

    const root = currentRoot.value
    const rel = currentRel.value

    return all.filter(item => {
      const itemRoot = String(fieldValue(item.rootPath) || '')
      if (!keys.has(pathKey(itemRoot))) return false
      if (root === null) return true
      if (pathKey(itemRoot) !== pathKey(root)) return false
      // 只在「当前这一层」显示：不含子目录里的文件
      const folder = String(fieldValue(item.relPath) || '').split('/').slice(0, -1).join('/')
      return folder === rel
    })
  })

  /** 面包屑：全部 → 根目录 → 子目录… */
  const breadcrumb = computed<BreadcrumbItem[]>(() => {
    const trail: BreadcrumbItem[] = [{ label: '全部', root: null, rel: '' }]
    if (currentRoot.value === null) return trail

    const rootLabel = roots.value.find(r => pathKey(r) === pathKey(currentRoot.value!)) || currentRoot.value
    trail.push({ label: rootLabel, root: currentRoot.value, rel: '' })

    const rel = currentRel.value
    if (rel) {
      const segments = rel.split('/').filter(Boolean)
      let acc = ''
      for (const segment of segments) {
        acc = joinRel(acc, segment)
        trail.push({ label: segment, root: currentRoot.value, rel: acc })
      }
    }
    return trail
  })

  /**
   * 当前层下的子文件夹卡片。
   *  - 处于「全部」层：每个绑定根目录一张卡
   *  - 处于某个目录层：其下每个直接子目录一张卡（数量按递归统计，标签按**直接**视频取并集）
   */
  const folderCards = computed<FolderCard[]>(() => {
    if (!enabled) return []
    const keys = rootKeySet.value
    if (keys.size === 0) return []

    const tagsOf = (item: any): string[] => {
      const raw = fieldValue(item.tags)
      return Array.isArray(raw) ? raw.filter((tag: unknown): tag is string => typeof tag === 'string' && tag !== '') : []
    }
    const folderPathOf = (item: any): string => {
      const rel = String(fieldValue(item.relPath) || '')
      const index = rel.lastIndexOf('/')
      return index > 0 ? rel.slice(0, index) : ''
    }
    const rootOf = (item: any): string => String(fieldValue(item.rootPath) || '')

    if (currentRoot.value === null) {
      return roots.value.map(root => {
        const info = rootInfos.value.find(entry => pathKey(entry.root) === pathKey(root))
        const mine = (items.value || []).filter(item => pathKey(rootOf(item)) === pathKey(root))
        const card: FolderCard = {
          key: `root:${pathKey(root)}`,
          name: root,
          kind: 'root',
          root,
          rel: '',
          count: info && !info.available ? mine.length : (info?.fileCount ?? mine.length),
          fullPath: root,
          tags: []
        }
        // 根卡片：只取「直接散在根目录下」的视频标签（不含子文件夹）
        card.tags = collectFolderTags(mine, card, folderPathOf, rootOf, tagsOf)
        return card
      })
    }

    const root = currentRoot.value
    const rel = currentRel.value
    const prefix = rel ? `${rel}/` : ''
    const bucket = new Map<string, number>()

    for (const item of items.value || []) {
      if (pathKey(rootOf(item)) !== pathKey(root)) continue
      const itemRel = String(fieldValue(item.relPath) || '')
      if (!itemRel) continue
      const folder = folderPathOf(item)
      if (folder === rel) continue // 当前层的文件，不是子目录
      if (prefix && !folder.startsWith(prefix)) continue
      const remainder = prefix ? folder.slice(prefix.length) : folder
      const next = remainder.split('/')[0]
      if (!next) continue
      const childRel = joinRel(rel, next)
      bucket.set(childRel, (bucket.get(childRel) || 0) + 1)
    }

    const mineInRoot = (items.value || []).filter(item => pathKey(rootOf(item)) === pathKey(root))

    return Array.from(bucket.entries())
      .sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'))
      .map(([childRel, count]) => {
        const card: FolderCard = {
          key: `folder:${pathKey(root)}:${childRel}`,
          name: childRel.split('/').pop() as string,
          kind: 'folder' as const,
          root,
          rel: childRel,
          count,
          fullPath: `${root}\\${childRel.replace(/\//g, '\\')}`,
          tags: []
        }
        // 只统计**直接**属于这个子目录的视频（不含更深一层）
        card.tags = collectFolderTags(mineInRoot, card, folderPathOf, rootOf, tagsOf)
        return card
      })
  })

  /** 是否有任何绑定目录 */
  const hasRoots = computed(() => roots.value.length > 0)

  /** 当前层是否为空（用于空状态文案） */
  const isScopeEmpty = computed(() => scopedItems.value.length === 0 && folderCards.value.length === 0)

  /* ------------------------------ 设置读写 ------------------------------ */

  async function loadSettings(): Promise<void> {
    try {
      const settings = await saveManager.loadSettings()
      const savedRoots = Array.isArray(settings?.videoRoots) ? settings.videoRoots : []
      roots.value = savedRoots.filter((r: unknown): r is string => typeof r === 'string' && r.trim() !== '')
      const savedExts = Array.isArray(settings?.videoExtensions) ? settings.videoExtensions : []
      extensions.value = savedExts.length > 0 ? savedExts : [...DEFAULT_VIDEO_EXTENSIONS]
    } catch (error) {
      console.warn('[视频库] 读取设置失败，使用默认值:', error)
      roots.value = []
      extensions.value = [...DEFAULT_VIDEO_EXTENSIONS]
    }
  }

  /** 保存设置（必须基于 loadSettings 的返回对象改键，不能构造新对象覆盖，否则会丢设置） */
  async function persistSettings(patch: { videoRoots?: string[], videoExtensions?: string[] }): Promise<void> {
    try {
      const settings = await saveManager.loadSettings()
      if (patch.videoRoots) settings.videoRoots = [...patch.videoRoots]
      if (patch.videoExtensions) settings.videoExtensions = [...patch.videoExtensions]
      await saveManager.saveSettings(settings)
    } catch (error) {
      console.error('[视频库] 保存设置失败:', error)
      notify.toast('error', '保存失败', '绑定目录信息保存失败')
    }
  }

  /* ------------------------------ 扫描与同步 ------------------------------ */

  /**
   * 扫描绑定目录并把结果同步进 items
   * @param {{silent?: boolean}} [opts] silent=true 时不弹「扫描完成」提示
   */
  async function scanAndSync(opts: { silent?: boolean } = {}): Promise<void> {
    if (!enabled) return
    const client = api()
    if (!isElectronEnvironment.value || !client?.videoScan) return
    if (roots.value.length === 0) {
      rootInfos.value = []
      lastScanAt.value = new Date().toISOString()
      return
    }

    isScanning.value = true
    try {
      // ⚠️ 必须传「普通数组」：Vue 的 reactive 数组是 Proxy，
      // 直接丢给 ipcRenderer.invoke 会抛 "An object could not be cloned"
      const response = await client.videoScan({
        roots: [...roots.value],
        extensions: [...extensions.value]
      })
      if (!response?.ok) {
        notify.toast('error', '扫描失败', response?.message || '未知错误')
        return
      }

      const rootResults: any[] = response.data?.roots || []
      rootInfos.value = rootResults.map(entry => ({
        root: entry.root,
        available: !!entry.exists && !!entry.ok,
        error: entry.error,
        fileCount: Array.isArray(entry.files) ? entry.files.length : 0
      }))

      // 建立「扫描到的文件」索引
      const scannedByKey = new Map<string, any>()
      const availableRootKeys = new Set<string>()
      for (const entry of rootResults) {
        if (!entry.exists || !entry.ok) continue
        availableRootKeys.add(pathKey(entry.root))
        for (const file of entry.files || []) {
          scannedByKey.set(pathKey(file.fullPath), file)
        }
      }

      const existingByKey = new Map<string, any>()
      for (const item of items.value || []) {
        const path = String(fieldValue(item.resourcePath) || '')
        if (path) existingByKey.set(pathKey(path), item)
      }

      let created = 0
      let updated = 0
      let markedMissing = 0
      let relinked = 0
      const nowIso = new Date().toISOString()

      // 0) 先挑出「扫描到、但库里没有对应记录」的文件 —— 它们可能是新视频，也可能是某个改名后的老视频
      const unmatchedFiles: any[] = []
      for (const [key, file] of scannedByKey.entries()) {
        if (!existingByKey.has(key)) unmatchedFiles.push(file)
      }

      // 1) 扫描结果 → 更新已有记录
      for (const [key, file] of scannedByKey.entries()) {
        const existing = existingByKey.get(key)
        if (!existing) continue
        {
          const prevSize = Number(fieldValue(existing.fileSize) || 0)
          const prevRoot = String(fieldValue(existing.rootPath) || '')
          let touched = false
          if (prevSize !== file.size) {
            setField(existing, 'fileSize', file.size)
            touched = true
          }
          if (pathKey(prevRoot) !== pathKey(file.rootPath || '')) {
            setField(existing, 'rootPath', file.rootPath || '')
            touched = true
          }
          if (fieldValue(existing.fileExists) === false) {
            setField(existing, 'fileExists', true)
            touched = true
          }
          // relPath / fileName 是**扫描器拥有**的字段：每次都跟着实际文件刷新，
          // 否则「重新关联」换了路径之后，卡片上的相对路径与层级位置会一直留在旧值。
          if (file.relPath && fieldValue(existing.relPath) !== file.relPath) {
            setField(existing, 'relPath', file.relPath)
            touched = true
          }
          if (file.fileName && fieldValue(existing.fileName) !== file.fileName) {
            setField(existing, 'fileName', file.fileName)
            touched = true
          }
          // name 是用户可编辑的显示名：只在为空时兜一个
          if (!fieldValue(existing.name) && file.name) {
            setField(existing, 'name', file.name)
            touched = true
          }
          if (touched) updated++
        }
      }

      // 2) 重新关联：文件名与所属根目录都对得上的「丢失」记录，认领改名后的新路径。
      //    这样改名不会丢掉标签与打开次数（ID 保持不变）。
      //    只有**唯一候选**才敢认领，同名文件多个时宁可各留一条，也不猜。
      const missingByRootAndName = new Map<string, any[]>()
      for (const item of items.value || []) {
        if (fieldValue(item.fileExists) !== false) continue
        const fileName = String(fieldValue(item.fileName) || '').toLowerCase()
        if (!fileName) continue
        const key = `${pathKey(String(fieldValue(item.rootPath) || ''))}|${fileName}`
        const bucket = missingByRootAndName.get(key) || []
        bucket.push(item)
        missingByRootAndName.set(key, bucket)
      }

      const stillUnmatched: any[] = []
      for (const file of unmatchedFiles) {
        const key = `${pathKey(file.rootPath || '')}|${String(file.fileName || '').toLowerCase()}`
        const bucket = missingByRootAndName.get(key)
        if (!bucket || bucket.length !== 1) {
          stillUnmatched.push(file)
          continue
        }
        const target = bucket.pop()
        setField(target, 'resourcePath', file.fullPath)
        setField(target, 'relPath', file.relPath || '')
        setField(target, 'fileName', file.fileName || '')
        setField(target, 'fileSize', file.size || 0)
        setField(target, 'fileExists', true)
        if (!fieldValue(target.name) && file.name) setField(target, 'name', file.name)
        // 认领后把这条记录纳入索引，避免后面重复建记录
        existingByKey.set(pathKey(file.fullPath), target)
        relinked++
      }

      // 3) 剩下真正的新文件 → 建记录
      for (const file of stillUnmatched) {
        const instance = new ResourceClass()
        setField(instance, 'id', file.id)
        setField(instance, 'resourceType', 'video')
        setField(instance, 'name', file.name || '')
        setField(instance, 'fileName', file.fileName || '')
        setField(instance, 'resourcePath', file.fullPath)
        setField(instance, 'relPath', file.relPath || '')
        setField(instance, 'rootPath', file.rootPath || '')
        setField(instance, 'fileSize', file.size || 0)
        setField(instance, 'durationSec', 0)
        setField(instance, 'watchCount', 0)
        setField(instance, 'visitedSessions', [])
        setField(instance, 'lastAccessSeenMs', file.atimeMs || 0)
        setField(instance, 'coverPath', '')
        setField(instance, 'lastFrameTime', 0)
        setField(instance, 'tags', [])
        setField(instance, 'author', [])
        setField(instance, 'description', '')
        setField(instance, 'addedDate', nowIso)
        setField(instance, 'fileExists', true)
        items.value.push(instance)
        created++
      }

      // 4) 库里有、但这轮没扫到 → 只有在「根目录本身可用」时才敢判定为丢失
      for (const item of items.value || []) {
        const path = String(fieldValue(item.resourcePath) || '')
        if (!path) continue
        const key = pathKey(path)
        if (scannedByKey.has(key)) continue

        const itemRootKey = pathKey(String(fieldValue(item.rootPath) || ''))
        if (!availableRootKeys.has(itemRootKey)) continue // 根目录掉线：不动
        if (fieldValue(item.fileExists) === false) continue

        setField(item, 'fileExists', false)
        markedMissing++
      }

      lastScanAt.value = response.data?.scannedAt || new Date().toISOString()

      // 用拼接字符串而不是对象：dev 环境的渲染层日志转发只带得动字符串，对象会变成 [object Object]
      console.info(
        `[视频库] 扫描同步完成: 扫到 ${scannedByKey.size} 个｜新增 ${created}｜更新 ${updated}｜` +
        `改名重连 ${relinked}｜标记丢失 ${markedMissing}` +
        (rootInfos.value.some(info => !info.available) ? '｜有根目录不可用（已跳过丢失判定）' : '')
      )

      if (created > 0 || updated > 0 || markedMissing > 0 || relinked > 0) {
        await save()
      }

      // 自动接上是「罕见但重要」的事（整个文件夹改名时能救回一批标签），
      // 所以即使是静默扫描也要说出来，不让它在背后悄悄发生。
      if (relinked > 0) {
        notify.toast(
          'success',
          '已自动重新关联',
          `${relinked} 个文件改名/换目录后被认了出来（同名同根目录），标签与打开次数已保留`
        )
      }

      if (!opts.silent) {
        notify.toast(
          'success',
          '扫描完成',
          `共 ${scannedByKey.size} 个视频：新增 ${created}，更新 ${updated}，重新关联 ${relinked}，标记丢失 ${markedMissing}`
        )
      }
    } catch (error: any) {
      console.error('[视频库] 扫描异常:', error)
      notify.toast('error', '扫描失败', error?.message || '未知错误')
    } finally {
      isScanning.value = false
    }
  }

  /* ------------------------------ 实时监听 ------------------------------ */

  async function startWatch(): Promise<void> {
    if (!enabled) return
    const client = api()
    if (!isElectronEnvironment.value || !client?.videoWatchStart) return
    try {
      // 同上：reactive 数组必须先摊平成普通数组再走 IPC
      const response = await client.videoWatchStart([...roots.value])
      const errors = response?.data?.errors || []
      watcherErrors.value = errors
      watcherHealthy.value = errors.length === 0
      if (errors.length > 0) {
        console.warn('[视频库] 部分目录无法监听，已降级为手动刷新:', errors)
      }

      if (!removeLibraryChangedListener && client.onVideoLibraryChanged) {
        removeLibraryChangedListener = client.onVideoLibraryChanged(async (payload: any) => {
          if (!enabled) return
          if (payload?.type === 'error') {
            watcherHealthy.value = false
            return
          }
          await scanAndSync({ silent: true })
        })
      }
    } catch (error) {
      watcherHealthy.value = false
      console.warn('[视频库] 启动目录监听失败:', error)
    }
  }

  async function stopWatch(): Promise<void> {
    const client = api()
    try {
      if (removeLibraryChangedListener) {
        removeLibraryChangedListener()
        removeLibraryChangedListener = null
      }
      if (client?.videoWatchStop) await client.videoWatchStop()
    } catch (error) {
      console.warn('[视频库] 停止目录监听失败:', error)
    }
  }

  /* ------------------------------ 绑定目录管理 ------------------------------ */

  /** 弹出系统文件夹选择框并绑定（自动递归扫描其中视频） */
  async function bindFolder(): Promise<boolean> {
    const client = api()
    if (!isElectronEnvironment.value || !client?.selectFolder) {
      notify.toast('error', '当前环境不支持', '请在应用内操作')
      return false
    }

    const picked = await client.selectFolder()
    if (!picked?.success || !picked.path) return false

    const target = picked.path as string
    if (roots.value.some(root => pathKey(root) === pathKey(target))) {
      notify.toast('warning', '已经绑定过了', target)
      return false
    }

    roots.value = [...roots.value, target]
    await persistSettings({ videoRoots: roots.value })
    currentRoot.value = target
    currentRel.value = ''
    await scanAndSync({ silent: true })
    await startWatch()
    notify.toast('success', '已绑定文件夹', `正在自动收录：${target}`)
    return true
  }

  /** 解绑（只解除绑定，不删记录、更不碰文件） */
  async function unbindFolder(root: string): Promise<boolean> {
    const confirmed = await (await import('../../utils/ConfirmService')).default.confirm(
      `解除绑定后，该目录下的视频将不再显示（记录与标签会保留，重新绑定即可恢复）。\n\n${root}`,
      '解除绑定'
    )
    if (!confirmed) return false

    roots.value = roots.value.filter(item => pathKey(item) !== pathKey(root))
    await persistSettings({ videoRoots: roots.value })
    if (currentRoot.value && pathKey(currentRoot.value) === pathKey(root)) {
      currentRoot.value = null
      currentRel.value = ''
    }
    await startWatch()
    notify.toast('success', '已解除绑定', root)
    return true
  }

  /* ------------------------------ 层级浏览 ------------------------------ */

  function enterFolder(card: FolderCard): void {
    if (card.kind === 'root') {
      currentRoot.value = card.root
      currentRel.value = ''
    } else {
      currentRoot.value = card.root
      currentRel.value = card.rel
    }
  }

  function goToBreadcrumb(crumb: BreadcrumbItem): void {
    currentRoot.value = crumb.root
    currentRel.value = crumb.rel
  }

  function goUp(): void {
    if (!currentRel.value) {
      currentRoot.value = null
      return
    }
    const segments = currentRel.value.split('/')
    segments.pop()
    currentRel.value = segments.join('/')
  }

  /**
   * 把当前层级切到某条记录所在的位置。
   * 主页点卡片跳进来时用：详情面板关掉之后就能看到它所在的这一层，而不是「全部」。
   */
  function focusItem(item: any): void {
    const itemRoot = String(fieldValue(item.rootPath) || '')
    if (!itemRoot) return
    // 解绑的目录不进层级（记录还在，但不该出现在浏览里）
    if (!roots.value.some(root => pathKey(root) === pathKey(itemRoot))) return

    currentRoot.value = itemRoot
    const rel = String(fieldValue(item.relPath) || '')
    const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
    currentRel.value = folder
  }

  /* ------------------------------ 打开与计数 ------------------------------ */

  /**
   * 递增打开次数。
   * App 内点开时调用；同时把 lastAccessSeenMs 顶到「现在」，
   * 这样 atime 轮询不会把同一次打开再算一遍。
   */
  async function bumpOpenCount(item: any, at: number = Date.now()): Promise<void> {
    const count = Number(fieldValue(item.watchCount) || 0) + 1
    setField(item, 'watchCount', count)

    const sessions = Array.isArray(fieldValue(item.visitedSessions)) ? [...fieldValue(item.visitedSessions)] : []
    sessions.push(new Date(at).toISOString())
    setField(item, 'visitedSessions', sessions)
    setField(item, 'lastAccessSeenMs', Math.max(Number(fieldValue(item.lastAccessSeenMs) || 0), at))
  }

  /** 用系统默认播放器打开，并记一次打开 */
  async function openVideo(item: any): Promise<boolean> {
    const client = api()
    const filePath = String(fieldValue(item.resourcePath) || '')
    if (!filePath) return false

    if (!isElectronEnvironment.value || !client?.videoOpen) {
      notify.toast('error', '当前环境不支持', '请在应用内播放')
      return false
    }

    const result = await client.videoOpen({ filePath })
    if (!result?.ok) {
      if (result?.missing) setField(item, 'fileExists', false)
      notify.toast('error', '打开失败', result?.message || '无法用系统默认播放器打开该视频')
      return false
    }

    await bumpOpenCount(item)
    await save()
    return true
  }

  /**
   * atime 兜底轮询：外部播放器（PotPlayer 等）看过之后，文件的访问时间会变化。
   * 只查**当前层**的文件，且只有 atime 明显新于已知值才算一次新打开。
   */
  async function pollAtimeOnce(): Promise<void> {
    const client = api()
    if (!isElectronEnvironment.value || !client?.videoStat) return

    const candidates = scopedItems.value
      .filter(item => fieldValue(item.fileExists) !== false)
      .slice(0, ATIME_POLL_BATCH_LIMIT)
    if (candidates.length === 0) return

    const paths = candidates.map(item => String(fieldValue(item.resourcePath) || ''))
    const response = await client.videoStat(paths)
    if (!response?.ok) return

    const byPath = new Map<string, any>()
    for (const entry of response.data || []) byPath.set(pathKey(entry.path), entry)

    let changed = 0
    for (const item of candidates) {
      const filePath = String(fieldValue(item.resourcePath) || '')
      const stat = byPath.get(pathKey(filePath))
      if (!stat) continue

      if (!stat.exists) {
        if (fieldValue(item.fileExists) !== false) {
          setField(item, 'fileExists', false)
          changed++
        }
        continue
      }

      const seen = Number(fieldValue(item.lastAccessSeenMs) || 0)
      const atime = Number(stat.atimeMs || 0)
      if (atime > seen + ATIME_NEW_OPEN_THRESHOLD) {
        await bumpOpenCount(item, atime)
        changed++
      }
    }

    if (changed > 0) await save()
  }

  function startAtimePolling(): void {
    if (!enabled || atimeTimer) return
    atimeTimer = setInterval(() => {
      pollAtimeOnce().catch(error => console.warn('[视频库] atime 轮询失败:', error))
    }, ATIME_POLL_INTERVAL)
  }

  function stopAtimePolling(): void {
    if (atimeTimer) {
      clearInterval(atimeTimer)
      atimeTimer = null
    }
  }

  /* ------------------------------ 抽帧封面 ------------------------------ */

  /** 用 <video>+<canvas> 抽帧（没有 ffmpeg 时的回退方案；生产环境页面以 file:// 加载才能直接读本地视频） */
  async function grabCoverViaCanvas(
    item: any,
    reason: string,
    options: { silent?: boolean, skipSave?: boolean } = {}
  ): Promise<boolean> {
    const client = api()
    const filePath = String(fieldValue(item.resourcePath) || '')
    const videoId = String(fieldValue(item.id) || '')
    if (!client?.videoSaveCoverDataUrl) return false

    const urlResult = client.getFileUrl ? await client.getFileUrl(filePath) : null
    const sourceUrl = urlResult?.success ? urlResult.url : filePath

    return new Promise<boolean>(resolve => {
      let settled = false
      const video = document.createElement('video')
      const finish = async (ok: boolean, message?: string) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        try {
          video.removeAttribute('src')
          video.load()
        } catch (_) {
          // 忽略
        }
        if (!ok && message) {
          if (!options.silent) {
            notify.toast(
              'error',
              '抽帧失败',
              `${message}\n可安装 FFmpeg 后重试（https://www.ffmpeg.org/），支持格式会完整得多`
            )
          }
          console.warn('[视频库] 抽帧回退失败:', reason, message)
        }
        resolve(ok)
      }

      const timeout = setTimeout(() => finish(false, '读取视频超时'), 25000)

      video.preload = 'auto'
      video.muted = true
      video.crossOrigin = 'anonymous'
      video.src = sourceUrl

      video.addEventListener('loadedmetadata', () => {
        const duration = Number(video.duration)
        const ratio = 0.05 + Math.random() * 0.8
        const target = Number.isFinite(duration) && duration > 1 ? duration * ratio : 1
        try {
          video.currentTime = target
        } catch (_) {
          finish(false, '无法定位视频帧')
        }
      })

      video.addEventListener('seeked', async () => {
        try {
          const width = video.videoWidth
          const height = video.videoHeight
          if (!width || !height) {
            await finish(false, '无法解码视频画面（编码可能不被浏览器支持）')
            return
          }
          const scale = Math.min(1, COVER_MAX_WIDTH / width)
          const canvas = document.createElement('canvas')
          canvas.width = Math.round(width * scale)
          canvas.height = Math.round(height * scale)
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            await finish(false, '画布不可用')
            return
          }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
          const saveResult = await client.videoSaveCoverDataUrl({
            dataUrl,
            saveDataDir: saveManager.dataDirectory,
            videoId
          })
          if (!saveResult?.ok) {
            await finish(false, saveResult?.error || '封面写入失败')
            return
          }
          setField(item, 'coverPath', saveResult.coverPath)
          setField(item, 'lastFrameTime', Number(video.currentTime) || 0)
          setField(item, 'coverUpdatedAt', Date.now())
          // 同 ffmpeg 路径：解码读过文件，atime 会变，别让它被算成一次「观看」
          setField(item, 'lastAccessSeenMs', Date.now())
          if (!options.skipSave) await save()
          if (!options.silent) {
            notify.toast('success', '封面已更新', '已用视频画面（canvas 回退）覆盖封面')
          }
          await finish(true)
        } catch (error: any) {
          await finish(false, error?.message || '抽帧异常')
        }
      })

      video.addEventListener('error', () => {
        void finish(false, '浏览器无法解码该视频文件')
      })
    })
  }

  /**
   * 随机抽 1 帧设为封面（覆盖式，固定文件名，永不膨胀）
   * 优先 ffmpeg；不可用/失败时回退 canvas。
   *
   * @param item 目标视频记录
   * @param options.silent 批量调用时关掉逐个 toast
   * @param options.skipSave 批量调用时由外层统一落库，避免 N 次写库
   */
  async function grabCover(item: any, options: { silent?: boolean, skipSave?: boolean } = {}): Promise<boolean> {
    const client = api()
    const filePath = String(fieldValue(item.resourcePath) || '')
    const videoId = String(fieldValue(item.id) || '')
    if (!filePath || !videoId) return false

    if (!isElectronEnvironment.value || !client?.videoGrabCover) {
      if (!options.silent) notify.toast('error', '当前环境不支持', '请在应用内抽帧')
      return false
    }

    if (fieldValue(item.fileExists) === false) {
      if (!options.silent) notify.toast('error', '文件不存在', '视频文件已丢失，无法抽帧')
      return false
    }

    const result = await client.videoGrabCover({
      videoPath: filePath,
      saveDataDir: saveManager.dataDirectory,
      videoId,
      maxWidth: COVER_MAX_WIDTH
    })

    if (result?.ok) {
      setField(item, 'coverPath', result.coverPath)
      setField(item, 'lastFrameTime', Number(result.time) || 0)
      // 封面是固定文件名覆盖写的：必须换一个「版本号」，
      // 否则渲染层的图片缓存会一直显示上一张（重刷看起来没反应）
      setField(item, 'coverUpdatedAt', Date.now())
      // ⚠️ 抽帧会真的去**读**视频文件（ffmpeg 读一遍 / canvas 解码一遍），
      // 这会更新文件的 atime；若不把「已知访问时间」顶到现在，
      // 下一轮 atime 轮询就会把「抽了张封面」误记成「观看了一次」。
      setField(item, 'lastAccessSeenMs', Date.now())
      if (!options.skipSave) await save()
      if (!options.silent) {
        notify.toast('success', '封面已更新', '已随机抽取 1 帧并覆盖原封面（不会产生冗余文件）')
      }
      return true
    }

    // 没有 ffmpeg（或 ffmpeg 抽不出）→ 回退 canvas
    if (['no-ffmpeg', 'ffmpeg-failed', 'empty-frame', 'exception'].includes(result?.reason)) {
      return await grabCoverViaCanvas(item, result?.message || result?.reason || 'ffmpeg 不可用', options)
    }

    if (result?.reason === 'source-missing') {
      setField(item, 'fileExists', false)
      if (!options.skipSave) await save()
    }
    if (!options.silent) notify.toast('error', '抽帧失败', result?.message || '未知错误')
    return false
  }

  /**
   * 批量抽帧（多选模式用）。
   * 逐个串行执行（ffmpeg 是外部进程，并行会打满 CPU/磁盘），最后统一落库 + 只弹一条汇总提示。
   */
  async function grabCoverBatch(targets: any[]): Promise<{ ok: number, fail: number }> {
    const list = Array.isArray(targets) ? targets.filter(Boolean) : []
    if (list.length === 0) return { ok: 0, fail: 0 }

    let ok = 0
    let fail = 0
    for (const item of list) {
      // eslint-disable-next-line no-await-in-loop
      const success = await grabCover(item, { silent: true, skipSave: true })
      if (success) ok++
      else fail++
    }

    if (ok > 0) await save()
    notify.toast(
      ok > 0 ? 'success' : 'error',
      '批量抽帧完成',
      `成功 ${ok} 个${fail > 0 ? `，失败 ${fail} 个（MKV/HEVC 等格式需要 FFmpeg：https://www.ffmpeg.org/）` : ''}`
    )
    return { ok, fail }
  }

  /** 删除封面（同时清理历史孤儿文件） */
  async function deleteCover(item: any): Promise<boolean> {
    const client = api()
    const videoId = String(fieldValue(item.id) || '')
    if (!videoId) return false

    if (client?.videoDeleteCover) {
      await client.videoDeleteCover({ saveDataDir: saveManager.dataDirectory, videoId })
    }
    setField(item, 'coverPath', '')
    setField(item, 'lastFrameTime', 0)
    // 版本号也要动：否则渲染层缓存里那张旧图会继续显示（删了封面却还看得到）
    setField(item, 'coverUpdatedAt', Date.now())
    await save()
    notify.toast('success', '封面已删除', '该视频会显示默认图标')
    return true
  }

  /** 在资源管理器里选中文件 */
  async function revealInExplorer(item: any): Promise<void> {
    const client = api()
    const filePath = String(fieldValue(item.resourcePath) || '')
    if (!filePath) return
    if (client?.videoReveal) {
      const result = await client.videoReveal(filePath)
      if (!result?.ok && result?.message) notify.toast('error', '打开失败', result.message)
      return
    }
    if (client?.openFileFolder) await client.openFileFolder(filePath)
  }

  /**
   * 「重新关联到…」：文件被改名/挪走后，由用户手动指认它现在是哪个文件。
   *
   * 刻意**不做任何猜测**（不按大小、不按修改时间去猜），把判断权交给用户 ——
   * 主人 2026-10-04 的选择：宁可按几下，也不要自动认错人。
   * 记录 ID / 标签 / 打开次数 / 封面全都保留，只换路径相关字段。
   */
  async function relinkVideo(item: any): Promise<boolean> {
    const client = api()
    if (!isElectronEnvironment.value || !client?.selectVideoFile) {
      notify.toast('error', '当前环境不支持', '请在应用内操作')
      return false
    }

    const oldPath = String(fieldValue(item.resourcePath) || '')
    const oldName = String(fieldValue(item.name) || '')
    const oldFileName = String(fieldValue(item.fileName) || '')

    // 对话框默认定位到老文件所在目录，方便就地挑改名后的那个
    const defaultDir = oldPath.includes('\\') ? oldPath.slice(0, oldPath.lastIndexOf('\\')) : ''
    const picked = await client.selectVideoFile(defaultDir || undefined)
    if (!picked) return false // 用户取消

    const newPath = typeof picked === 'string' ? picked : (picked.path || '')
    if (!newPath) return false

    const check = client.videoRelink
      ? await client.videoRelink({ roots: [...roots.value], filePath: newPath })
      : null

    if (!check?.ok) {
      notify.toast('error', '无法重新关联', check?.error || '该文件无法关联到当前视频库')
      return false
    }

    setField(item, 'resourcePath', newPath)
    setField(item, 'rootPath', check.rootPath || '')
    setField(item, 'relPath', check.relPath || '')
    setField(item, 'fileName', check.fileName || '')
    setField(item, 'fileSize', Number(check.size) || 0)
    setField(item, 'fileExists', true)
    // 别让 atime 轮询把这次操作算成一次「观看」
    setField(item, 'lastAccessSeenMs', Date.now())

    // 显示名若本来就是「文件名去掉扩展名」（即用户没自己改过），跟着新文件名一起更新
    const oldBase = oldFileName ? oldFileName.replace(/\.[^.]+$/, '') : ''
    if (!oldName || oldName === oldBase) {
      setField(item, 'name', check.name || oldName)
    }

    await save()
    notify.toast('success', '已重新关联', `标签与打开次数已保留：${check.relPath || check.fileName}`)
    return true
  }

  /* ------------------------------ 生命周期 ------------------------------ */

  /** 查询 ffmpeg 可用性（只在首次做，结果缓存到主进程） */
  async function loadFfmpegInfo(): Promise<void> {
    const client = api()
    if (!client?.videoFfmpegInfo) return
    try {
      const result = await client.videoFfmpegInfo()
      if (result?.ok) ffmpegInfo.value = result.data
    } catch (error) {
      console.warn('[视频库] 查询 ffmpeg 失败:', error)
    }
  }

  /**
   * 进入视频页时调用：读设置 → 后台扫描 → 起监听 → 起 atime 轮询
   * @param {{silent?: boolean}} [opts]
   */
  async function initialize(opts: { silent?: boolean } = {}): Promise<void> {
    if (!enabled) return
    if (!initialized) {
      await loadSettings()
      initialized = true
    }
    await loadFfmpegInfo()
    await scanAndSync({ silent: opts.silent ?? true })
    await startWatch()
    startAtimePolling()
  }

  /** 手动刷新（实时监听不可用时的兜底） */
  async function rescan(): Promise<void> {
    await scanAndSync({ silent: false })
    lastScanAt.value = new Date().toISOString()
  }

  /** 离开页面时释放资源 */
  async function dispose(): Promise<void> {
    stopAtimePolling()
    await stopWatch()
  }

  return {
    // 状态
    roots,
    extensions,
    rootInfos,
    isScanning,
    lastScanAt,
    watcherHealthy,
    watcherErrors,
    ffmpegInfo,
    currentRoot,
    currentRel,
    // 计算属性
    scopedItems,
    folderCards,
    breadcrumb,
    hasRoots,
    isScopeEmpty,
    // 生命周期
    initialize,
    rescan,
    dispose,
    pollAtimeOnce,
    // 绑定目录
    bindFolder,
    unbindFolder,
    // 层级
    enterFolder,
    goToBreadcrumb,
    goUp,
    focusItem,
    // 打开与统计
    openVideo,
    bumpOpenCount,
    // 封面
    grabCover,
    grabCoverBatch,
    deleteCover,
    revealInExplorer,
    // 手动重新关联（文件改名/挪走后由用户指认）
    relinkVideo
  }
}
