/**
 * 视频页多选批量的纯逻辑（`src/utils/videoBatchTools.ts`）
 *
 * 三个要点：
 *   - **全选口径**：当前筛选/搜索命中的全部（跨分页），但**排除磁盘上已丢失的记录** ——
 *     否则主人会"全选 300 个、实际只有 280 个能播"，而且看不出为什么。
 *   - **命名依据**：默认取左栏选中的标签名（`GGV-拔作.dpl`），没有标签时用搜索词/兜底词。
 *   - **提示文案**：必须明确告诉主人"下一步去哪按 Ctrl+V"，这是复制功能存在的意义；
 *     失败时也要如实说失败，不许把"没找到 PotPlayer"说成成功。
 */
import { describe, it, expect } from 'vitest'
import {
  extractVideoFilePaths,
  pickSelectableEntries,
  resolvePlaylistNaming,
  describePotPlayerNamedResult,
  describeClipboardResult
} from '../utils/videoBatchTools'

/** 视频页记录的两种形态都要认：ResourceField（有 .value）与裸值 */
const field = (value: any) => ({ value })

describe('extractVideoFilePaths', () => {
  it('ResourceField 与裸值都能取出来', () => {
    const entries = [
      { resourcePath: field('E:\\a\\1.mp4') },
      { resourcePath: 'E:\\a\\2.mp4' }
    ]
    expect(extractVideoFilePaths(entries)).toEqual(['E:\\a\\1.mp4', 'E:\\a\\2.mp4'])
  })

  it('没有 resourcePath 的记录被跳过（解绑目录、扫描异常的记录）', () => {
    const entries = [
      { resourcePath: field('E:\\a\\1.mp4') },
      { resourcePath: field('') },
      { name: '没有路径' },
      { resourcePath: field(null) }
    ]
    expect(extractVideoFilePaths(entries)).toEqual(['E:\\a\\1.mp4'])
  })

  it('重复路径只留一份（同一文件被两条记录指向）', () => {
    const entries = [
      { resourcePath: field('E:\\a\\1.mp4') },
      { resourcePath: field('E:\\a\\1.mp4') }
    ]
    expect(extractVideoFilePaths(entries)).toEqual(['E:\\a\\1.mp4'])
  })

  it('非数组 / 空输入不炸', () => {
    expect(extractVideoFilePaths([] as any)).toEqual([])
    expect(extractVideoFilePaths(undefined as any)).toEqual([])
  })
})

describe('pickSelectableEntries：全选范围', () => {
  const alive = { id: 'a' }
  const ghost = { id: 'g' }
  const isMissing = (item: any) => item?.id === 'g'

  it('排除丢失的记录', () => {
    expect(pickSelectableEntries([alive, ghost], isMissing)).toEqual([alive])
  })

  it('判定函数自己抛异常时，宁可多选也不要少选', () => {
    const boom = () => { throw new Error('boom') }
    expect(pickSelectableEntries([alive], boom)).toEqual([alive])
  })

  it('传空 / 不传判定函数时全都要', () => {
    expect(pickSelectableEntries([alive, ghost])).toEqual([alive, ghost])
  })
})

describe('resolvePlaylistNaming：播放列表命名依据', () => {
  it('有标签 → 用标签名（主人定的默认）', () => {
    expect(resolvePlaylistNaming({ include: ['拔作'] }, '')).toEqual({
      tagNames: ['拔作'],
      fallbackName: '全部视频'
    })
  })

  it('多个标签 → 全部带上去（主进程收成"等N个"）', () => {
    const naming = resolvePlaylistNaming({ include: ['拔作', '3D'] }, '')
    expect(naming.tagNames).toEqual(['拔作', '3D'])
  })

  it('没有标签但有搜索词 → 兜底名带上搜索词', () => {
    expect(resolvePlaylistNaming({ include: [] }, '口交')).toEqual({
      tagNames: [],
      fallbackName: '搜索-口交'
    })
  })

  it('什么都没有 → 全部视频', () => {
    expect(resolvePlaylistNaming(null, '')).toEqual({ tagNames: [], fallbackName: '全部视频' })
  })

  it('空白标签被剔掉（避免生成 "GGV- .dpl"）', () => {
    expect(resolvePlaylistNaming({ include: ['  ', ''] } as any, '').tagNames).toEqual([])
  })
})

describe('describePotPlayerNamedResult：播放列表的提示', () => {
  it('已交给 PotPlayer → 说清数量、文件名，并点明是"追加"', () => {
    const toast = describePotPlayerNamedResult({ ok: true, count: 300, fileName: 'GGV-拔作.dpl', opened: true })
    expect(toast.type).toBe('success')
    expect(toast.message).toContain('300')
    expect(toast.message).toContain('GGV-拔作.dpl')
    expect(toast.message).toContain('交给 PotPlayer')
    expect(toast.message).toContain('追加')
  })

  it('只生成文件 → 告诉主人文件在哪、怎么用', () => {
    const toast = describePotPlayerNamedResult({
      ok: true,
      count: 5,
      fileName: 'GGV-a.dpl',
      path: 'D:\\PotPlayer64\\Playlist\\GGV-a.dpl',
      opened: false
    })
    expect(toast.message).toContain('D:\\PotPlayer64\\Playlist\\GGV-a.dpl')
    expect(toast.message).toContain('在 PotPlayer 的播放列表里打开')
    // 没交给它就不能说交给它了
    expect(toast.message).not.toContain('已交给')
  })

  it('跳过丢失文件时说清跳了几个', () => {
    const toast = describePotPlayerNamedResult({ ok: true, count: 10, fileName: 'GGV-a.dpl', missingCount: 2 })
    expect(toast.message).toContain('跳过 2 个')
  })

  it('失败 → 如实报错，不粉饰', () => {
    const toast = describePotPlayerNamedResult({ ok: false, message: '没有找到 PotPlayer：请在设置里指定' })
    expect(toast.type).toBe('error')
    expect(toast.message).toContain('没有找到 PotPlayer')
  })

  it('连结果都没有（IPC 挂了）也不炸', () => {
    expect(describePotPlayerNamedResult(null).type).toBe('error')
  })
})

describe('describeClipboardResult：复制文件的提示', () => {
  it('成功 → 必须告诉主人"去目标文件夹按 Ctrl+V"，并声明没动文件', () => {
    const toast = describeClipboardResult({ ok: true, count: 12, missing: [] })
    expect(toast.type).toBe('success')
    expect(toast.message).toContain('12')
    expect(toast.message).toContain('Ctrl+V')
    expect(toast.message).toContain('没有改动任何文件')
  })

  it('成功但有跳过 → 附上跳过数量', () => {
    const toast = describeClipboardResult({ ok: true, count: 3, missing: ['E:\\ghost.mp4'] })
    expect(toast.message).toContain('跳过 1 个')
  })

  it('失败 → 报错（例如剪贴板校验不通过）', () => {
    const toast = describeClipboardResult({ ok: false, message: '剪贴板校验不通过：期望 5 个，回读到 0 个' })
    expect(toast.type).toBe('error')
    expect(toast.message).toContain('校验不通过')
  })
})
