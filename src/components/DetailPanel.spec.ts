/**
 * DetailPanel「开发商折叠」逻辑测试
 *
 * 直接调用组件真实的 computed / methods（不挂载），
 * 用真实的 Game 类实例和真实的 game.ts 配置，避免测试里复制一份逻辑自己骗自己。
 */
import { describe, it, expect } from 'vitest'
import DetailPanel from './DetailPanel.vue'
import { Game } from '@resources/game.ts'

const methods: Record<string, Function> = (DetailPanel as any).methods
const computed: Record<string, Function> = (DetailPanel as any).computed

/** 造一个「this」，把组件真实方法绑上去；computed 用 getter 接到真实实现 */
function makeCtx(item: any) {
  const ctx: any = { item, expandedInfoFields: {} }
  for (const [key, fn] of Object.entries(methods)) {
    ctx[key] = (fn as Function).bind(ctx)
  }
  for (const key of ['detailPanelConfig']) {
    Object.defineProperty(ctx, key, { get: () => computed[key].call(ctx) })
  }
  return ctx
}

/** 取真实的 computedObjectiveInfo 结果 */
function objectiveInfoOf(ctx: any) {
  return computed.computedObjectiveInfo.call(ctx)
}

function makeGame(developers: string[], tags: string[] = []) {
  const game = new Game()
  game.id.value = 'g1'
  game.name.value = '测试游戏'
  game.developers.value = developers
  game.tags.value = tags
  return game
}

describe('DetailPanel 开发商折叠', () => {
  it('game.ts 里开发商配置为默认折叠、只显示前 3 个', () => {
    const devConfig = Game.detailPanelConfig.objectiveInfo.find((i: any) => i.field === 'developers')
    expect(devConfig?.collapsible).toBe(true)
    expect(devConfig?.collapsedLimit).toBe(3)
  })

  it('开发商超过阈值时，默认只显示前 3 个 + 省略号', () => {
    const ctx = makeCtx(makeGame(['A社', 'B社', 'C社', 'D社', 'E社']))
    const info = objectiveInfoOf(ctx).find((i: any) => i.field === 'developers')

    expect(info.items).toHaveLength(5)
    expect(ctx.isInfoTruncatable(info)).toBe(true)
    expect(ctx.isInfoExpanded('developers')).toBeFalsy()
    expect(ctx.infoDisplayValue(info)).toBe('A社、B社、C社 …')
  })

  it('展开后显示全部，收起后恢复截断', () => {
    const ctx = makeCtx(makeGame(['A社', 'B社', 'C社', 'D社', 'E社']))
    const info = objectiveInfoOf(ctx).find((i: any) => i.field === 'developers')

    ctx.toggleInfoExpanded('developers')
    expect(ctx.isInfoExpanded('developers')).toBe(true)
    expect(ctx.infoDisplayValue(info)).toBe('A社、B社、C社、D社、E社')

    ctx.toggleInfoExpanded('developers')
    expect(ctx.infoDisplayValue(info)).toBe('A社、B社、C社 …')
  })

  it('开发商不多于阈值时不出现「展开全部」按钮', () => {
    const ctx = makeCtx(makeGame(['A社', 'B社', 'C社']))
    const info = objectiveInfoOf(ctx).find((i: any) => i.field === 'developers')

    expect(ctx.isInfoTruncatable(info)).toBe(false)
    expect(ctx.infoDisplayValue(info)).toBe('A社、B社、C社')
  })

  it('缺省阈值是 3，且空数组会被过滤掉不渲染', () => {
    const ctx = makeCtx(makeGame([]))
    const info = objectiveInfoOf(ctx).find((i: any) => i.field === 'developers')
    // items 为空 -> value 为空字符串 -> 被 filter 掉，详情页不会出现空的「开发商：」
    expect(info).toBeUndefined()
  })

  it('开发商里的空字符串条目会被剔除后再计数', () => {
    const ctx = makeCtx(makeGame(['A社', '', 'B社', 'C社', 'D社']))
    const info = objectiveInfoOf(ctx).find((i: any) => i.field === 'developers')
    expect(info.items).toEqual(['A社', 'B社', 'C社', 'D社'])
    expect(ctx.infoDisplayValue(info)).toBe('A社、B社、C社 …')
  })

  it('其它字段（如发行商）不受折叠影响', () => {
    const game = makeGame(['A社', 'B社', 'C社', 'D社'])
    game.publisher.value = '某发行商'
    const ctx = makeCtx(game)
    const publisher = objectiveInfoOf(ctx).find((i: any) => i.field === 'publisher')

    expect(ctx.isInfoTruncatable(publisher)).toBe(false)
    expect(ctx.infoDisplayValue(publisher)).toBe('某发行商')
  })

  it('切换资源时展开状态会被清空（watch item）', () => {
    const ctx = makeCtx(makeGame(['A社', 'B社', 'C社', 'D社']))
    ctx.toggleInfoExpanded('developers')
    expect(ctx.isInfoExpanded('developers')).toBe(true)

    const watcher = (DetailPanel as any).watch.item
    watcher.call(ctx)
    expect(ctx.isInfoExpanded('developers')).toBe(false)
  })
})
