/**
 * 「主视图到底显示哪些视频」的收窄规则测试（src/utils/videoVisibility.ts）
 *
 * 对应主人 2026-10-05 的第 2 个问题：
 *   「主视图与文件目录强绑定，不要有 deleted 的文件还显示在主视图里面，
 *     而是全塞到丢失的文件里面，类似一个回收站的功能」
 */
import { describe, it, expect } from 'vitest'
import { filterVisibleVideoItems, type VideoVisibilityContext } from '../utils/videoVisibility'

/** 造一条记录：{ id, relPath, missing } */
function video(id: string, relPath: string, missing = false) {
  return {
    id,
    relPath,
    missing,
    folder: relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : ''
  }
}

/** 模拟「当前浏览层 = 合集A」时的三个判定（与 useVideoLibrary 里的实现同口径） */
function makeContext(recycleMode = false, recycleRel = '', level = '合集A'): VideoVisibilityContext {
  return {
    recycleMode,
    recycleRel,
    isMissing: (item: any) => item.missing === true,
    isAtCurrentLevel: (item: any) => item.folder === level,
    relativeFolderOf: (item: any) => {
      const folder = item.folder
      if (!level) return folder
      if (folder === level) return ''
      return folder.startsWith(level + '/') ? folder.slice(level.length + 1) : ''
    }
  }
}

describe('filterVisibleVideoItems', () => {
  const list = [
    video('kept', '合集A/还活着.mp4'),
    video('deeper', '合集A/子目录/深一层.mp4'),
    video('gone', '合集A/没了.mp4', true),
    video('goneDeep', '合集A/子目录/也没了.mp4', true),
    video('otherLevel', '别的目录/x.mp4')
  ]

  it('普通模式：只要真实存在 + 正好在当前这一层（丢失的、更深一层的、别层的都挡掉）', () => {
    expect(filterVisibleVideoItems(list, makeContext()).map(i => i.id)).toEqual(['kept'])
  })

  it('普通模式：当前层没有文件时结果为空（不会拿更深一层的来充数）', () => {
    const onlyDeep = [video('deeper', '合集A/子目录/深一层.mp4')]
    expect(filterVisibleVideoItems(onlyDeep, makeContext())).toEqual([])
  })

  it('回收站模式（顶层）：显示"原目录正好是当前层"的丢失文件', () => {
    // 注意：回收站模式下筛选池本身就是 missingItems（只剩丢失记录），
    // 所以这里传进去的列表也先按池子的口径筛过 —— 闸门只负责"层级"这一件事。
    const recyclePool = list.filter(item => item.missing)
    expect(filterVisibleVideoItems(recyclePool, makeContext(true, '')).map(i => i.id)).toEqual(['gone'])
  })

  it('回收站模式（钻进"子目录"）：只显示那一层里的丢失文件', () => {
    const recyclePool = list.filter(item => item.missing)
    expect(filterVisibleVideoItems(recyclePool, makeContext(true, '子目录')).map(i => i.id)).toEqual(['goneDeep'])
  })

  it('回收站模式下非丢失记录不会被放行（池子的兜底口径）', () => {
    // 就算调用方误传了混着"活着"的记录，普通记录也会因为层级前缀不同被挡掉；
    // 这里显式记录这个前提，免得以后有人把池子改了还以为是闸门在管。
    const mixed = [video('gone', '合集A/没了.mp4', true)]
    expect(filterVisibleVideoItems(mixed, makeContext(true, '')).map(i => i.id)).toEqual(['gone'])
  })

  it('空列表 / 列表不是数组时安全', () => {
    expect(filterVisibleVideoItems([], makeContext())).toEqual([])
    expect(filterVisibleVideoItems(null as any, makeContext())).toEqual([])
  })

  it('「全部」层（没有具体层级）时平铺显示所有存在的东西', () => {
    const ctx: VideoVisibilityContext = {
      recycleMode: false,
      recycleRel: '',
      isMissing: (item: any) => item.missing === true,
      isAtCurrentLevel: () => true, // 「全部」层是平铺视图
      relativeFolderOf: () => ''
    }
    expect(filterVisibleVideoItems(list, ctx).map(i => i.id)).toEqual(['kept', 'deeper', 'otherLevel'])
  })
})
