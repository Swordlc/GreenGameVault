/**
 * 游戏入库时「游戏名 / 开发商」的自动识别（主人 2026-11-07 需求）。
 *
 * 口径（按主人原话）：
 *   - 取游戏文件的**上层目录名**；
 *   - 目录名里 `[]` `{}` `()` `【】` `（）` `「」` 这些括号**内部**的内容 → 开发商（可以有多个）；
 *   - 目录名去掉这些括号及其内部内容后剩下的部分 → 游戏名。
 *
 * 边界（不猜、不编）：
 *   - 文件直接躺在 `Games` / `Downloads` / `bin` 这类"容器目录"里时，继续往上找一层；
 *     实在找不到有效目录名，就回退到文件名本身。
 *   - 目录名整段都被括号包住（例如 `[Dev]`）时，游戏名回退到文件名，开发商照常收下。
 *   - 只做纯字符串处理，不碰 fs / path 模块，方便单测。
 */

/** 括号对 —— 主人点名的 6 种，顺序不影响结果 */
const BRACKET_SOURCE =
  '\\[([^\\]]*)\\]' + // []
  '|\\{([^}]*)\\}' + // {}
  '|\\(([^)]*)\\)' + // ()
  '|【([^】]*)】' + // 【】
  '|（([^）]*)）' + // （）
  '|「([^」]*)」' // 「」

/**
 * 这些目录名只说明"东西放在哪"，不是游戏名本身。
 * 命中时继续往上找一层（例如 `...\Foo\bin\game.exe` 要拿到 `Foo`）。
 */
const GENERIC_DIR_NAMES = new Set([
  'games',
  'game',
  '游戏',
  'downloads',
  'download',
  '下载',
  'desktop',
  '桌面',
  'bin',
  'binaries',
  'win32',
  'win64',
  'x64',
  'x86',
  'release',
  'debug',
  'steam',
  'steamapps',
  'common',
  'gog games',
  'program files',
  'program files (x86)'
])

function createBracketRegex(): RegExp {
  return new RegExp(BRACKET_SOURCE, 'g')
}

/** 折叠空白并去掉首尾的分隔符（去掉括号后常留下 `- _ .` 这类残缺符号） */
function tidyName(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-_·.,，、]+/, '')
    .replace(/[\s\-_·.,，、]+$/, '')
    .trim()
}

/** 取路径最后一段（文件名 / 目录名） */
function lastSegment(filePath: string): string {
  const normalized = String(filePath || '').replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : ''
}

/**
 * 取游戏文件的"有效上层目录名"。
 *
 * 会跳过盘符（`D:`）和 `Games` / `bin` 这类容器目录；
 * 找不到有效目录时返回 ''（调用方回退文件名）。
 */
export function resolveParentFolderName(filePath: string): string {
  const normalized = String(filePath || '').replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length < 2) return ''

  // 最后一段是文件本身，从它上面一层开始找
  let index = parts.length - 2
  while (index >= 0) {
    const segment = parts[index]
    if (/^[A-Za-z]:$/.test(segment)) {
      index--
      continue
    }
    if (GENERIC_DIR_NAMES.has(segment.trim().toLowerCase())) {
      index--
      continue
    }
    return segment
  }
  return ''
}

/**
 * 取出字符串里所有括号包住的内容（去空白、去空串、去重，保持出现顺序）。
 * 例如 `[A] 游戏名 【B】` → `['A', 'B']`。
 */
export function extractBracketContents(value: string): string[] {
  const text = String(value || '')
  const result: string[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(createBracketRegex())) {
    const content = match.slice(1).find(part => part !== undefined)
    const trimmed = String(content || '').replace(/\s+/g, ' ').trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

/**
 * 去掉字符串里所有括号及其内部内容，并把因此留下的多余空格 / 分隔符收拾干净。
 * 例如 `[A] 游戏名 【B】` → `游戏名`。
 */
export function stripBracketContents(value: string): string {
  return tidyName(String(value || '').replace(createBracketRegex(), ' '))
}

/** 从文件名取一个兜底名称（去掉扩展名，保持旧的 `game-` 前缀清理习惯） */
export function gameNameFromFileName(fileName: string): string {
  const base = String(fileName || '').trim()
  const withoutExt = base.replace(/\.[^/.]+$/, '')
  const cleaned = tidyName(
    withoutExt
      .replace(/^game[-_\s]*/i, '')
      .replace(/[-_\s]+/g, ' ')
  )
  const fallback = cleaned || tidyName(withoutExt)
  return fallback ? fallback.charAt(0).toUpperCase() + fallback.slice(1) : ''
}

export interface GameInfoAutoDetectResult {
  /** 识别出的游戏名；没有可用信息时为空串 */
  name: string
  /** 括号里的开发商候选（可能多个，可能为空） */
  developers: string[]
  /** 本次实际使用的上层目录名（诊断 / 测试用） */
  folderName: string
}

/**
 * 根据游戏文件路径自动识别「游戏名 + 开发商」。
 *
 * 优先级：
 *   1. 上层目录名（跳过 Games / bin 等容器目录）→ 去括号得游戏名、括号内容得开发商；
 *   2. 目录名去括号后为空 → 文件名兜底；
 *   3. 没有有效上层目录 → 文件名兜底，开发商为空。
 */
export function detectGameInfoFromPath(filePath: string): GameInfoAutoDetectResult {
  const fileName = lastSegment(filePath)
  const folderName = resolveParentFolderName(filePath)

  if (!folderName) {
    return { name: gameNameFromFileName(fileName), developers: [], folderName: '' }
  }

  const developers = extractBracketContents(folderName)
  const stripped = stripBracketContents(folderName)
  const name = stripped || gameNameFromFileName(fileName)

  return { name, developers, folderName }
}
