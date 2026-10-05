/**
 * 「整夹重新关联」纯逻辑测试（src/utils/videoRelink.ts）
 *
 * 覆盖主人 2026-10-05 反馈的那个场景：
 *   子文件夹改名后库里出现两份记录 —— 老的（有标签、打开次数，但"文件不存在"）
 *   和扫描按新路径新建的空壳。整夹重连时必须把老记录接回来、把空壳合并掉，
 *   而不是留下两条指向同一个文件的记录。
 */
import { describe, it, expect } from 'vitest'
import {
  fieldValue,
  setField,
  isMissingItem,
  parentFolderOf,
  innerRelativeOf,
  planFolderRelink,
  mergeVideoRecords,
  applyRelinkResult
} from '../utils/videoRelink'

function field<T>(value: T) {
  return { value }
}

describe('字段读写与目录计算', () => {
  it('fieldValue / setField 两种字段形态都认', () => {
    const wrapped = { tags: field(['a']) }
    const plain = { tags: ['b'] }
    expect(fieldValue(wrapped.tags)).toEqual(['a'])
    setField(wrapped, 'tags', ['c'])
    expect(wrapped.tags.value).toEqual(['c'])
    setField(plain, 'tags', ['d'])
    expect(plain.tags).toEqual(['d'])
  })

  it('isMissingItem 只认 fileExists === false', () => {
    expect(isMissingItem({ fileExists: field(false) })).toBe(true)
    expect(isMissingItem({ fileExists: false })).toBe(true)
    expect(isMissingItem({ fileExists: field(true) })).toBe(false)
    expect(isMissingItem({})).toBe(false)
  })

  it('parentFolderOf / innerRelativeOf（反斜杠也认，越界返回空）', () => {
    expect(parentFolderOf('A/b/x.mp4')).toBe('A/b')
    expect(parentFolderOf('x.mp4')).toBe('')
    expect(parentFolderOf('A\\b\\x.mp4')).toBe('A/b')

    expect(innerRelativeOf('A', 'A/b/x.mp4')).toBe('b/x.mp4')
    expect(innerRelativeOf('A', 'A/x.mp4')).toBe('x.mp4')
    expect(innerRelativeOf('', 'A/b/x.mp4')).toBe('A/b/x.mp4')
    expect(innerRelativeOf('A', 'AB/x.mp4')).toBe('')
    expect(innerRelativeOf('A', 'C/x.mp4')).toBe('')
    expect(innerRelativeOf('A', 'A')).toBe('')
  })
})

describe('planFolderRelink', () => {
  const items = [
    { id: field('v1'), relPath: field('合集A/01.mkv'), fileName: field('01.mkv') },
    { id: field('v2'), relPath: field('合集A/子/x.mkv'), fileName: field('x.mkv') },
    { id: field('v3'), relPath: field('合集B/02.mkv'), fileName: field('02.mkv') }
  ]

  it('只挑这棵子树里的记录，并把路径削成"内层相对路径"', () => {
    const plan = planFolderRelink(items, '合集A')
    expect(plan.map(entry => entry.id)).toEqual(['v1', 'v2'])
    expect(plan.map(entry => entry.innerRel)).toEqual(['01.mkv', '子/x.mkv'])
    expect(plan[0].item).toBe(items[0])
    expect(plan[0].fileName).toBe('01.mkv')
  })

  it('没有 relPath 或 id 的记录跳过（宁可留给用户单独处理）', () => {
    const plan = planFolderRelink([
      { id: field('v1'), relPath: field('') },
      { id: field(''), relPath: field('合集A/x.mp4') }
    ], '合集A')
    expect(plan).toEqual([])
  })

  it('空输入安全', () => {
    expect(planFolderRelink([], 'A')).toEqual([])
    expect(planFolderRelink(items as any, '')).toHaveLength(3) // folderRel 为空 = 整个根目录
  })
})

describe('mergeVideoRecords（把扫描空壳并进老记录）', () => {
  it('用户数据只增不减：标签/作者取并集，打开次数求和，访问记录去重排序', () => {
    const target: any = {
      name: field('我自己起的名字'),
      tags: field(['教学', '收藏']),
      author: field(['社团A']),
      watchCount: field(5),
      visitedSessions: field(['2026-01-02T00:00:00.000Z']),
      lastAccessSeenMs: field(200),
      coverPath: field('videos/covers/v1.jpg'),
      coverUpdatedAt: field(200),
      description: field('老简介'),
      durationSec: field(120),
      lastFrameTime: field(30),
      addedDate: field('2026-01-01T00:00:00.000Z'),
      // 路径字段刻意给上，验证合并**不会**动它们
      resourcePath: field('D:\\V\\合集A\\01.mkv'),
      relPath: field('合集A/01.mkv')
    }
    const source: any = {
      name: field('01'),
      tags: field(['收藏', '新标签']),
      author: field(['社团B']),
      watchCount: field(2),
      visitedSessions: field(['2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z']),
      lastAccessSeenMs: field(500),
      coverPath: field(''),
      coverUpdatedAt: field(100),
      description: field('空壳简介'),
      durationSec: field(0),
      lastFrameTime: field(0),
      addedDate: field('2026-02-01T00:00:00.000Z'),
      resourcePath: field('D:\\V\\合集A2\\01.mkv'),
      relPath: field('合集A2/01.mkv')
    }

    mergeVideoRecords(target, source)

    expect(target.tags.value).toEqual(['教学', '收藏', '新标签'])
    expect(target.author.value).toEqual(['社团A', '社团B'])
    expect(target.watchCount.value).toBe(7)
    expect(target.visitedSessions.value).toEqual(['2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'])
    expect(target.lastAccessSeenMs.value).toBe(500)
    // 老记录已有的东西不被覆盖
    expect(target.name.value).toBe('我自己起的名字')
    expect(target.coverPath.value).toBe('videos/covers/v1.jpg')
    expect(target.description.value).toBe('老简介')
    expect(target.durationSec.value).toBe(120)
    expect(target.coverUpdatedAt.value).toBe(200)
    // 入库时间取更早的那个
    expect(target.addedDate.value).toBe('2026-01-01T00:00:00.000Z')
    // 路径不归合并管
    expect(target.resourcePath.value).toBe('D:\\V\\合集A\\01.mkv')
    expect(target.relPath.value).toBe('合集A/01.mkv')
  })

  it('老记录为空时用空壳的值补上', () => {
    const target: any = { name: field(''), coverPath: field(''), description: field(''), durationSec: field(0), addedDate: field('') }
    const source: any = {
      name: field('01'), coverPath: field('videos/covers/v9.jpg'),
      description: field('简介'), durationSec: field(60), addedDate: field('2026-01-01T00:00:00.000Z')
    }
    mergeVideoRecords(target, source)
    expect(target.name.value).toBe('01')
    expect(target.coverPath.value).toBe('videos/covers/v9.jpg')
    expect(target.description.value).toBe('简介')
    expect(target.durationSec.value).toBe(60)
    expect(target.addedDate.value).toBe('2026-01-01T00:00:00.000Z')
  })

  it('同一条记录或空值时不炸', () => {
    const target: any = { tags: field(['a']) }
    mergeVideoRecords(target, target)
    expect(target.tags.value).toEqual(['a'])
    mergeVideoRecords(target, null)
    expect(target.tags.value).toEqual(['a'])
  })
})

describe('applyRelinkResult', () => {
  it('写入新路径相关字段，并把 lastAccessSeenMs 基线顶到现在', () => {
    const before = Date.now()
    const item: any = {
      resourcePath: field('D:\\V\\合集A\\01.mkv'),
      relPath: field('合集A/01.mkv'),
      fileName: field('01.mkv'),
      fileSize: field(10),
      fileExists: field(false),
      lastAccessSeenMs: field(0)
    }

    applyRelinkResult(item, {
      ok: true,
      path: 'D:\\V\\合集A2\\01.mkv',
      rootPath: 'D:\\V',
      relPath: '合集A2/01.mkv',
      fileName: '01.mkv',
      size: 999
    })

    expect(item.resourcePath.value).toBe('D:\\V\\合集A2\\01.mkv')
    expect(item.relPath.value).toBe('合集A2/01.mkv')
    expect(item.fileSize.value).toBe(999)
    expect(item.fileExists.value).toBe(true)
    expect(item.lastAccessSeenMs.value).toBeGreaterThanOrEqual(before)
  })

  it('失败结果不写任何东西', () => {
    const item: any = { fileExists: field(false), resourcePath: field('old') }
    applyRelinkResult(item, { ok: false, reason: 'not-found' })
    expect(item.fileExists.value).toBe(false)
    expect(item.resourcePath.value).toBe('old')
  })
})
