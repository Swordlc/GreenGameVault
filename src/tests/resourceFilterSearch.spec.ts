/**
 * useResourceFilter 的搜索接线测试（视频页 vs 游戏页）
 *
 * 为什么要有：搜索「看着接了、其实没接」是最难查的一类问题（主人 2026-10-04 就遇到了）。
 * 这里绕开 PageConfigLoader（它要读 configs/ 的 JSON、依赖 electronAPI），
 * 直接把页面配置 mock 掉，专门验证：
 *   - 传了 searchFields → 走文件管理器式模糊搜索（文件名/路径/标签都能搜、多词 AND）
 *   - 没传 searchFields → 保持旧的 name 子串语义（游戏页行为不变）
 */
import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'

vi.mock('../configs/pages/PageConfigLoader', () => ({
  pageConfigLoader: {
    getPageConfig: (id: string) => ({
      id,
      name: '视频',
      filterConfig: [
        {
          key: 'tags',
          title: '标签筛选',
          filterType: 'resourceField',
          params: { resource: 'video', field: 'tags' },
          isArray: true
        }
      ],
      sortOptions: [{ id: 'name-asc', label: '按名称', field: 'name', order: 'asc' }]
    })
  }
}))

import { useResourceFilter } from '../composables/useResourceFilter'

function makeItem(name: string, fileName: string, relPath: string, tags: string[] = []) {
  return {
    name: { value: name },
    fileName: { value: fileName },
    relPath: { value: relPath },
    tags: { value: tags },
    author: { value: [] },
    description: { value: '' },
    fileExists: { value: true }
  }
}

const items = [
  makeItem('第二部', '第二部_改名了.mkv', '子目录A/第二部_改名了.mkv', ['教学']),
  makeItem('第三个', '第三个.webm', '子目录A/深层B/第三个.webm', ['收藏']),
  makeItem('测试视频A', '测试视频A.mp4', '测试视频A.mp4', [])
]

function makeFilter(query: string, searchFields: string[]) {
  const itemsRef = ref<any[]>(items)
  const searchQuery = ref(query)
  const sortBy = ref('name-asc')
  return useResourceFilter(itemsRef as any, searchQuery, sortBy, 'videos', { searchFields })
}

const namesOf = (filter: any) => filter.filteredGames.value.map((item: any) => item.name.value)

describe('视频页：文件管理器式模糊搜索（传 searchFields）', () => {
  const fields = ['name', 'fileName', 'relPath', 'author', 'tags', 'description']

  it('空查询不过滤', () => {
    expect(namesOf(makeFilter('', fields))).toHaveLength(3)
  })

  it('按显示名搜', () => {
    expect(namesOf(makeFilter('第三', fields))).toEqual(['第三个'])
  })

  it('按**文件名**搜（旧实现搜不到，因为 name 不含扩展名）', () => {
    expect(namesOf(makeFilter('第二部_改名了.mkv', fields))).toEqual(['第二部'])
    expect(namesOf(makeFilter('.webm', fields))).toEqual(['第三个'])
  })

  it('按相对路径搜（含目录名）', () => {
    expect(namesOf(makeFilter('深层B', fields))).toEqual(['第三个'])
  })

  it('按标签搜', () => {
    expect(namesOf(makeFilter('收藏', fields))).toEqual(['第三个'])
  })

  it('空格分词：每个词都要命中（AND）', () => {
    expect(namesOf(makeFilter('第二 改名', fields))).toEqual(['第二部'])
    expect(namesOf(makeFilter('第二 收藏', fields))).toEqual([])
  })

  it('忽略下划线等分隔符：「第二部改名」也能中', () => {
    expect(namesOf(makeFilter('第二部改名', fields))).toEqual(['第二部'])
  })

  it('子序列模糊：「第改」也能中', () => {
    expect(namesOf(makeFilter('第改', fields))).toEqual(['第二部'])
  })
})

describe('游戏页：不传 searchFields，保持旧的 name 子串语义', () => {
  it('按显示名搜仍然可用', () => {
    expect(namesOf(makeFilter('第三', []))).toEqual(['第三个'])
  })

  it('文件名/路径不参与匹配（这是旧行为，故意保持）', () => {
    expect(namesOf(makeFilter('深层B', []))).toEqual([])
    expect(namesOf(makeFilter('.webm', []))).toEqual([])
  })

  it('标签仍然能被搜到（走筛选字段的兜底匹配）', () => {
    expect(namesOf(makeFilter('收藏', []))).toEqual(['第三个'])
  })
})
