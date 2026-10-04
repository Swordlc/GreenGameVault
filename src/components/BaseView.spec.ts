/**
 * BaseView 空状态契约测试
 *
 * 背景（主人 2026-10-04 反馈）：视频页某一层**只有文件夹、没有视频**时，
 * BaseView 的内置判断会弹出「没有找到匹配的视频 / 尝试使用不同的搜索词」，
 * 把文件夹卡片盖住 —— 所以给 BaseView 加了 `emptyStateOverride`：
 *   undefined → 用内置判断（默认行为，游戏页不变）
 *   null      → 明确不显示
 *   对象      → 直接用它
 */
import { describe, it, expect } from 'vitest'
import BaseView from './BaseView.vue'

const computed = (BaseView as any).computed

const defaultEmptyStateConfig = {
  emptyIcon: '🎬',
  emptyTitle: '还没有绑定视频文件夹',
  emptyDescription: '点「绑定文件夹」',
  emptyButtonText: '绑定文件夹',
  emptyButtonAction: 'bindVideoFolder',
  noResultsIcon: '🔍',
  noResultsTitle: '没有找到匹配的视频',
  noResultsDescription: '换个词试试',
  noPageDataIcon: '📄',
  noPageDataTitle: '当前页没有内容',
  noPageDataDescription: ''
}

function makeCtx(overrides: Record<string, any> = {}) {
  return {
    items: [],
    filteredItems: [],
    emptyStateConfig: defaultEmptyStateConfig,
    emptyStateOverride: undefined,
    ...overrides
  }
}

const currentEmptyState = (ctx: any) => computed.currentEmptyState.call(ctx)

describe('BaseView 空状态', () => {
  it('没有覆盖时：库为空 → 用页面配置的空库文案（带按钮）', () => {
    const state = currentEmptyState(makeCtx())
    expect(state.title).toBe('还没有绑定视频文件夹')
    expect(state.showButton).toBe(true)
    expect(state.onAction).toBe('bindVideoFolder')
  })

  it('没有覆盖时：有数据但被筛光 → 用「没找到匹配」文案', () => {
    const state = currentEmptyState(makeCtx({ items: [1, 2], filteredItems: [] }))
    expect(state.title).toBe('没有找到匹配的视频')
    expect(state.showButton).toBe(false)
  })

  it('覆盖为 null → 什么都不显示（文件夹层不再被盖住）', () => {
    expect(currentEmptyState(makeCtx({ items: [1, 2], filteredItems: [], emptyStateOverride: null }))).toBeNull()
  })

  it('覆盖为对象 → 原样使用（哪怕 items 为空）', () => {
    const custom = { icon: '📂', title: '这一层没有视频', description: '往上一层看看', showButton: false }
    const state = currentEmptyState(makeCtx({ emptyStateOverride: custom }))
    expect(state).toBe(custom)
  })

  it('覆盖为 undefined 才走内置逻辑（null 与 undefined 必须区分开）', () => {
    expect(currentEmptyState(makeCtx({ emptyStateOverride: null }))).toBeNull()
    expect(currentEmptyState(makeCtx({ emptyStateOverride: undefined })).title).toBe('还没有绑定视频文件夹')
  })
})
