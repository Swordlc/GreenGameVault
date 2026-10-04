/**
 * 文件管理器式模糊搜索
 *
 * 为什么单独抽一个模块：
 *   - 原来各处的搜索都是「一个词 + 字段子串匹配」，用户输入文件名（带扩展名）、
 *     或者分开打两个词就搜不到东西；视频页尤其明显（文件名/路径才是人们记得的东西）。
 *   - 这里统一成一套规则，游戏页、视频页、搜索页都可以接，行为可测。
 *
 * 规则（对齐资源管理器的习惯）：
 *   1. **空格分词，每个词都必须命中**（AND）——「第二 改名」能命中「第二部_改名了.mkv」；
 *   2. 单个词命中，三种方式任一即可：
 *        a. 原文子串（忽略大小写）
 *        b. **去掉分隔符后**的子串 —— 分隔符指空格、下划线、连字符、点、括号、顿号等，
 *           于是「第二部改名」能命中「第二部_改名了.mkv」；
 *        c. **子序列**（按顺序出现即可，不要求连续）——「第改」能命中「第二部_改名了」；
 *   3. 空查询 = 全都要（不过滤）。
 */

/** 分隔符：匹配时一律忽略，避免「下划线/空格/点」把人挡在外面 */
const SEPARATORS = /[\s_\-.,;:!?'"`~@#$%^&*+=|\\/()[\]{}<>（）【】《》〈〉「」『』·、，。！？：；…—－]+/g

/**
 * 归一化：小写 + 去掉所有分隔符
 * @param {unknown} input
 * @returns {string}
 */
export function normalizeForSearch(input: unknown): string {
  return String(input ?? '')
    .toLowerCase()
    .replace(SEPARATORS, '')
}

/**
 * 子序列匹配：needle 的字符按顺序出现在 haystack 中（不要求连续）
 * @param {string} haystack 已归一化的文本
 * @param {string} needle 已归一化的查询词
 */
export function isSubsequence(haystack: string, needle: string): boolean {
  if (!needle) return true
  if (needle.length > haystack.length) return false
  let index = 0
  for (const ch of haystack) {
    if (ch === needle[index]) {
      index++
      if (index === needle.length) return true
    }
  }
  return false
}

/**
 * 把一个字段值摊平成若干可搜索字符串
 * 支持：ResourceField（取 .value）、数组（逐项）、普通值
 * @param {unknown} value
 * @returns {string[]}
 */
export function collectSearchTexts(value: unknown, depth = 0): string[] {
  if (value === null || value === undefined || depth > 3) return []
  if (Array.isArray(value)) {
    return value.flatMap(entry => collectSearchTexts(entry, depth + 1))
  }
  if (typeof value === 'object') {
    const inner = (value as any).value
    if (inner !== undefined) return collectSearchTexts(inner, depth + 1)
    return []
  }
  const text = String(value)
  return text ? [text] : []
}

/**
 * 文件管理器式模糊匹配
 * @param {string[]} texts 参与匹配的文本（会先过滤空值）
 * @param {string} query 查询串（可含空格 = 多个词）
 * @returns {boolean}
 */
export function matchesFuzzy(texts: string[], query: string): boolean {
  const rawQuery = String(query ?? '').trim()
  if (!rawQuery) return true

  const haystackRaw = (Array.isArray(texts) ? texts : [])
    .filter(text => text !== null && text !== undefined && text !== '')
    .map(text => String(text).toLowerCase())
  if (haystackRaw.length === 0) return false

  const haystackNorm = haystackRaw.map(normalizeForSearch)
  const terms = rawQuery.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true

  return terms.every(term => {
    const termNorm = normalizeForSearch(term)
    return haystackRaw.some((raw, index) => {
      if (raw.includes(term)) return true
      if (!termNorm) return false
      const norm = haystackNorm[index]
      return norm.includes(termNorm) || isSubsequence(norm, termNorm)
    })
  })
}

/**
 * 给「命中原因」用：返回第一个命中的词与对应的文本（没有命中返回 null）
 * @param {string[]} texts
 * @param {string} query
 */
export function firstFuzzyHit(texts: string[], query: string): { term: string, text: string } | null {
  const rawQuery = String(query ?? '').trim()
  if (!rawQuery) return null
  const terms = rawQuery.toLowerCase().split(/\s+/).filter(Boolean)
  const list = (Array.isArray(texts) ? texts : []).map(text => String(text))
  for (const term of terms) {
    const termNorm = normalizeForSearch(term)
    for (const text of list) {
      const raw = text.toLowerCase()
      if (raw.includes(term) || (termNorm && normalizeForSearch(text).includes(termNorm))) {
        return { term, text }
      }
    }
  }
  return null
}
