/**
 * ScreenshotCover —— 「使用最新截图作为封面」的共用规则
 *
 * 两处调用方必须走同一套判定，否则两边会慢慢分叉：
 *  1. 编辑对话框里单个游戏的「使用最新截图作为封面」按钮；
 *  2. 游戏管理页工具栏上的全局批量按钮。
 *
 * ⚠️ 铁律（详见 COMPATIBILITY.md 第四节）：写进 `coverPath` 的值绝不能自带
 * `SaveData` 前缀，必须是**相对 SaveData 目录**的路径。`listImageFiles()` 返回的是
 * `SaveData\Game\Screenshots\<文件夹>\<文件>.png`，所以必须先过一遍
 * `toSaveDataRelativePath()`，否则显示时会被再拼一次 SaveData 目录 → 一片空白。
 */
import saveManager from './SaveManager.ts'

/** 批量扫描时命中「有截图可当封面」的一条候选 */
export interface ScreenshotCoverTarget {
  id: string
  name: string
  /** 截图文件夹路径（原样，通常是相对 SaveData 的路径） */
  folderPath: string
  /** 该文件夹里最新的一张截图 */
  newestFile: string
}

/** 批量扫描时被跳过的游戏及原因 */
export interface ScreenshotCoverSkip {
  id: string
  name: string
  /** no-folder: 没有对应的截图文件夹；no-image: 文件夹里没有图片 */
  reason: 'no-folder' | 'no-image'
}

export interface ScreenshotCoverScanResult {
  targets: ScreenshotCoverTarget[]
  skipped: ScreenshotCoverSkip[]
}

/**
 * 从截图文件列表中挑出「最新」的一张
 *
 * 截图文件名内嵌时间戳（如 `游戏名_2026-09-21_20-04-52.png`），按它排序比按文件名
 * 字典序可靠得多 —— 字典序会把 1 月的老图排在 9 月的新图前面。
 * 名字里没有时间戳的文件视为最旧，排到最后。
 */
export function pickNewestScreenshot(files: string[]): string {
  const stampOf = (f: string): number => {
    const base = String(f).replace(/\\/g, '/').split('/').pop() || ''
    const m = base.match(/(\d{4})-(\d{2})-(\d{2})[_\s-](\d{2})-(\d{2})-(\d{2})/)
    return m ? Number(`${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}${m[6]}`) : -1
  }
  return files.reduce((best, f) => (stampOf(f) > stampOf(best) ? f : best), files[0])
}

/**
 * 把路径归一化成「相对 SaveData 目录」的形式。
 *
 * 绝对路径（带盘符）保持原样不动。
 */
export function toSaveDataRelativePath(p: string): string {
  const s = String(p).replace(/\\/g, '/')
  if (/^[A-Za-z]:/.test(s) || s.startsWith('//')) return s
  return s.replace(/^\.?\/?SaveData\//i, '').replace(/\/{2,}/g, '/').replace(/^\/+/, '')
}

/**
 * 解析当前设置下「截图根目录」的路径
 * （与 useGameScreenshot / 编辑对话框里的算法保持一致）
 */
export async function resolveScreenshotBasePath(): Promise<string> {
  const settings: any = await saveManager.loadSettings()
  let base = ''
  if (settings?.screenshotLocation === 'default') {
    base = `${saveManager.dataDirectory}/Game/Screenshots`
  } else if (settings?.screenshotLocation === 'custom') {
    base = settings?.screenshotsPath || ''
  } else {
    base = settings?.screenshotsPath || `${saveManager.dataDirectory}/Game/Screenshots`
  }
  if (!base || !String(base).trim()) {
    base = `${saveManager.dataDirectory}/Game/Screenshots`
  }
  return String(base).replace(/\\/g, '/')
}

/**
 * 批量扫描：为「当前没有封面」的游戏找出可用的最新截图
 *
 * 只读，不写库、不复制文件。调用方拿到结果后应先让用户确认，再落库。
 * 根目录只列举一次，再按 `gameId_` 前缀把文件夹分配给游戏 —— 避免每个游戏都 readdir 一遍。
 *
 * @param games 需要扫描的游戏（只应传入封面为空的）
 * @param onProgress 进度回调（已处理数, 总数）
 */
export async function scanGamesMissingCover(
  games: Array<{ id: string; name: string }>,
  onProgress?: (done: number, total: number) => void
): Promise<ScreenshotCoverScanResult> {
  const api: any = typeof window !== 'undefined' ? (window as any).electronAPI : null
  if (!api?.listFiles || !api?.listImageFiles) {
    throw new Error('当前环境不支持文件列表接口')
  }

  const base = await resolveScreenshotBasePath()
  const listing = await api.listFiles(base)
  const folders: string[] = listing?.success && Array.isArray(listing.files) ? listing.files : []

  // 文件夹名形如 `<gameId>_<游戏名>`，gameId 自身可能带下划线，
  // 所以按「最长前缀 id」归属，避免 `game_1` 抢走 `game_1_2` 的文件夹。
  const idsByLength = games
    .map(g => g.id)
    .filter(id => !!id)
    .sort((a, b) => b.length - a.length)

  const folderByGameId = new Map<string, string>()
  for (const folder of folders) {
    const owner = idsByLength.find(id => folder.startsWith(`${id}_`))
    if (owner && !folderByGameId.has(owner)) {
      folderByGameId.set(owner, folder)
    }
  }

  const targets: ScreenshotCoverTarget[] = []
  const skipped: ScreenshotCoverSkip[] = []

  let done = 0
  for (const game of games) {
    done++
    const folder = folderByGameId.get(game.id)
    if (!folder) {
      skipped.push({ id: game.id, name: game.name, reason: 'no-folder' })
      onProgress?.(done, games.length)
      continue
    }

    const folderPath = `${base}/${folder}`
    try {
      const resp = await api.listImageFiles(folderPath)
      const files: string[] = resp?.success && Array.isArray(resp.files) ? resp.files : []
      if (files.length === 0) {
        skipped.push({ id: game.id, name: game.name, reason: 'no-image' })
      } else {
        targets.push({
          id: game.id,
          name: game.name,
          folderPath,
          newestFile: pickNewestScreenshot(files)
        })
      }
    } catch (e) {
      console.warn('[ScreenshotCover] 列举截图失败:', folderPath, e)
      skipped.push({ id: game.id, name: game.name, reason: 'no-image' })
    }
    onProgress?.(done, games.length)
  }

  return { targets, skipped }
}

export default {
  pickNewestScreenshot,
  toSaveDataRelativePath,
  resolveScreenshotBasePath,
  scanGamesMissingCover
}
