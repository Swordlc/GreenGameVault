/**
 * 「主视图到底显示哪些视频」的唯一判定（纯函数，可单测）
 *
 * 主人 2026-10-05 的需求原话：
 *   「主视图与文件目录强绑定，不要有 deleted 的文件或文件夹还显示在主视图里面，
 *     而是全塞到丢失的文件里面，类似一个回收站的功能」
 *
 * 背景：左栏筛选池刻意用**子树**（否则"只有子文件夹"的目录层左栏是空的），
 * 所以筛选/排序出来的列表比"这一层该显示的"要宽 —— 这里再收窄一次：
 *   - 普通模式：只要磁盘上真实存在、且正好落在当前这一层的；
 *   - 回收站模式：只要"原目录"正好是回收站当前钻进的那一层的丢失记录。
 */

/** 判定用的上下文（依赖注入，方便单测） */
export interface VideoVisibilityContext {
  /** 当前是不是在回收站（左栏「丢失的文件」被选中） */
  recycleMode: boolean
  /** 回收站当前钻到的层级（相对当前浏览层，'' = 顶层） */
  recycleRel: string
  /** 这条记录的文件是不是已经找不到了 */
  isMissing: (item: any) => boolean
  /** 这条记录是不是正好在"当前浏览层" */
  isAtCurrentLevel: (item: any) => boolean
  /** 取这条记录「相对当前浏览层」的原目录（'' = 正好在当前层） */
  relativeFolderOf: (item: any) => string
}

/**
 * 把筛选/排序后的列表收窄成"这一刻真正该显示的"
 */
export function filterVisibleVideoItems(list: any[], context: VideoVisibilityContext): any[] {
  const items = Array.isArray(list) ? list : []
  if (!context) return items

  if (context.recycleMode) {
    const rel = context.recycleRel || ''
    return items.filter(item => context.relativeFolderOf(item) === rel)
  }

  return items.filter(item => !context.isMissing(item) && context.isAtCurrentLevel(item))
}
