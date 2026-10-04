/**
 * 文件管理器式模糊搜索测试
 *
 * 主人 2026-10-04 的反馈：「文件名搜索无效（应该是类似于文件管理器的模糊搜索）」。
 * 这里把期望的行为钉死：多词 AND、忽略分隔符、子序列、大小写不敏感。
 */
import { describe, it, expect } from 'vitest'
import {
  collectSearchTexts,
  firstFuzzyHit,
  isSubsequence,
  matchesFuzzy,
  normalizeForSearch
} from '../utils/fuzzySearch'
import { Video } from '@resources/video.ts'

function makeVideo(name: string, fileName: string, relPath: string, extra: Record<string, any> = {}) {
  const video = new Video()
  video.name.value = name
  video.fileName.value = fileName
  video.relPath.value = relPath
  Object.entries(extra).forEach(([key, value]) => {
    ;(video as any)[key].value = value
  })
  return video
}

/** 模拟 useResourceFilter 在视频页里的取字段方式 */
function searchableTexts(video: any) {
  return ['name', 'fileName', 'relPath', 'author', 'tags', 'description']
    .flatMap(field => collectSearchTexts(video[field]))
}

describe('normalizeForSearch / isSubsequence', () => {
  it('去掉空格、下划线、连字符、点、括号、顿号等分隔符并转小写', () => {
    expect(normalizeForSearch('第二部_改名了.MKV')).toBe('第二部改名了mkv')
    expect(normalizeForSearch('[Group] Title - 01 (1080p)')).toBe('grouptitle011080p')
    expect(normalizeForSearch('a、b，c')).toBe('abc')
  })

  it('子序列：按顺序出现即可，不要求连续', () => {
    expect(isSubsequence('第二部改名了', '第改')).toBe(true)
    expect(isSubsequence('abcdef', 'ace')).toBe(true)
    expect(isSubsequence('abcdef', 'aec')).toBe(false)
    expect(isSubsequence('abc', '')).toBe(true)
  })
})

describe('matchesFuzzy', () => {
  const texts = ['第二部_改名了', '第二部_改名了.mkv', '子目录A/第二部_改名了.mkv']

  it('空查询 = 全都要（不过滤）', () => {
    expect(matchesFuzzy(texts, '')).toBe(true)
    expect(matchesFuzzy(texts, '   ')).toBe(true)
  })

  it('原文子串（忽略大小写）', () => {
    expect(matchesFuzzy(['Hello World.mkv'], 'hello')).toBe(true)
    expect(matchesFuzzy(['Hello World.mkv'], 'WORLD')).toBe(true)
  })

  it('带扩展名搜也能命中（fileName 参与匹配）', () => {
    expect(matchesFuzzy(texts, '第二部_改名了.mkv')).toBe(true)
    expect(matchesFuzzy(texts, '.mkv')).toBe(true)
  })

  it('忽略分隔符：「第二部改名」能命中「第二部_改名了.mkv」', () => {
    expect(matchesFuzzy(texts, '第二部改名')).toBe(true)
  })

  it('空格分词：每个词都要命中（AND）', () => {
    expect(matchesFuzzy(texts, '第二 改名')).toBe(true)
    expect(matchesFuzzy(texts, '第二 不存在')).toBe(false)
  })

  it('子序列模糊：「第改」也能命中', () => {
    expect(matchesFuzzy(texts, '第改')).toBe(true)
  })

  it('路径分隔符不挡路：「子目录A 改名」能命中相对路径', () => {
    expect(matchesFuzzy(texts, '子目录A 改名')).toBe(true)
    expect(matchesFuzzy(texts, '子目录A/第二部')).toBe(true)
  })

  it('完全不沾边就是不命中', () => {
    expect(matchesFuzzy(texts, 'zzz')).toBe(false)
    expect(matchesFuzzy(['abc'], 'abcd')).toBe(false)
  })

  it('没有任何可搜文本时只有空查询才算命中', () => {
    expect(matchesFuzzy([], 'x')).toBe(false)
    expect(matchesFuzzy([], '')).toBe(true)
  })

  it('长查询不会被子序列放宽到乱命中', () => {
    expect(matchesFuzzy(['abc'], 'abcdefgh')).toBe(false)
  })
})

describe('collectSearchTexts', () => {
  it('支持 ResourceField / 数组 / 原始值，并剔除空值', () => {
    expect(collectSearchTexts({ value: 'x' })).toEqual(['x'])
    expect(collectSearchTexts(['a', '', null, 'b'])).toEqual(['a', 'b'])
    expect(collectSearchTexts(123)).toEqual(['123'])
    expect(collectSearchTexts(null)).toEqual([])
    expect(collectSearchTexts({ value: ['a', 'b'] })).toEqual(['a', 'b'])
  })

  it('真实的 Video 实例：文件名、相对路径、作者、标签都能被搜到', () => {
    const video = makeVideo('第二部', '第二部_改名了.mkv', '子目录A/第二部_改名了.mkv', {
      author: ['某社团'],
      tags: ['教学', '收藏']
    })
    const texts = searchableTexts(video)

    expect(matchesFuzzy(texts, '第二部_改名了.mkv')).toBe(true)
    expect(matchesFuzzy(texts, '子目录A')).toBe(true)
    expect(matchesFuzzy(texts, '某社团')).toBe(true)
    expect(matchesFuzzy(texts, '收藏 教学')).toBe(true)
    expect(matchesFuzzy(texts, '不存在的词')).toBe(false)
  })
})

describe('firstFuzzyHit（命中原因）', () => {
  it('返回命中的词与所在文本', () => {
    const hit = firstFuzzyHit(['子目录A/第二部_改名了.mkv'], '改名')
    expect(hit?.term).toBe('改名')
    expect(hit?.text).toContain('改名')
  })

  it('没命中返回 null', () => {
    expect(firstFuzzyHit(['abc'], 'zzz')).toBeNull()
    expect(firstFuzzyHit(['abc'], '')).toBeNull()
  })
})
