/**
 * 主页三条抓阄链路的装配测试
 *
 * 这里挂载真实的 HomeView（含真实 i18n / 真实推荐引擎），只把 Electron 的
 * sqliteGetPageData 换成假数据，验证：
 *  1. 三条链路各渲染一行 8 张卡，前 3 张是固定席位（带 #1~#3 徽章）；
 *  2. 「重新推荐」只重刷本行、且固定席位不变；
 *  3. 全局标签筛选（包含 / 排除 / 清空）能实时作用于三条链路；
 *  4. 文案走真实的 i18n key（防止 key 写错悄悄显示成 key 本身）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import HomeView from './HomeView.vue'
import i18n from '../locales'

const DAY_MS = 24 * 60 * 60 * 1000
const TAG_INCLUDE_SAMPLE = '3D'

/** 40 款游戏：序号越小 = 时长越长 / 启动越多 / 最后游玩越近；偶数序号带 3D 标签 */
function makeRawLibrary(size = 40) {
  const now = Date.now()
  return Array.from({ length: size }, (_, i) => ({
    id: `g${String(i).padStart(2, '0')}`,
    name: `游戏${String(i).padStart(2, '0')}`,
    developers: ['某社'],
    tags: i % 2 === 0 ? [TAG_INCLUDE_SAMPLE] : ['像素'],
    playTime: (size - i) * 3600,
    playCount: size - i,
    visitedSessions: [new Date(now - (i + 1) * DAY_MS).toISOString()],
    addedDate: new Date(now - 400 * DAY_MS).toISOString()
  }))
}

function mountHome(library: any[] = makeRawLibrary()): VueWrapper<any> {
  ;(window as any).electronAPI = {
    sqliteGetPageData: vi.fn(async () => ({ ok: true, data: library }))
  }
  return mount(HomeView, {
    global: {
      plugins: [i18n],
      mocks: {
        $router: { push: vi.fn(() => Promise.resolve()) }
      }
    }
  })
}

async function mountLoaded(library?: any[]) {
  const wrapper = mountHome(library)
  await flushPromises()
  return wrapper
}

function rowsOf(wrapper: VueWrapper<any>) {
  return wrapper.findAll('.chain-section')
}

function cardNames(section: VueWrapper<any>): string[] {
  return section.findAll('.chain-card .resource-title').map(node => node.text())
}

function allCardNames(wrapper: VueWrapper<any>): string[] {
  return wrapper.findAll('.chain-card .resource-title').map(node => node.text())
}

/** 游戏NN → NN，用来判断是不是带 3D 标签的偶数序号游戏 */
function indexOfName(name: string): number {
  return Number(name.replace(/\D/g, ''))
}

beforeEach(() => {
  localStorage.clear()
})

describe('主页三条抓阄链路', () => {
  it('渲染三条链路，每行 8 张卡，前 3 张是固定席位', async () => {
    const wrapper = await mountLoaded()
    const rows = rowsOf(wrapper)

    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.findAll('.chain-card')).toHaveLength(8)
    }

    // 链路 1 的固定席位 = 时长/次数最强的 g00~g02
    const firstRowCards = rows[0].findAll('.chain-card')
    expect(cardNames(rows[0]).slice(0, 3)).toEqual(['游戏00', '游戏01', '游戏02'])
    expect(firstRowCards[0].classes()).toContain('is-pinned')
    expect(firstRowCards[1].classes()).toContain('is-pinned')
    expect(firstRowCards[2].classes()).toContain('is-pinned')
    expect(firstRowCards[3].classes()).not.toContain('is-pinned')
    expect(firstRowCards[0].text()).toContain('#1')
    expect(firstRowCards[2].text()).toContain('#3')
  })

  it('每行标题与推荐理由走真实 i18n 文案', async () => {
    const wrapper = await mountLoaded()
    const rows = rowsOf(wrapper)

    expect(rows[0].find('.section-title').text()).toContain('最常游玩')
    expect(rows[1].find('.section-title').text()).toContain('最近游玩')
    expect(rows[2].find('.section-title').text()).toContain('接下来游玩')

    expect(rows[0].find('.chain-card .resource-status').text()).toMatch(/小时 · \d+ 次/)
    expect(rows[1].find('.chain-card .resource-status').text()).toContain('天前玩过')
    expect(rows[2].find('.chain-card .resource-status').text()).toContain('天没碰了')

    // 三条链路的固定席位口径不同：本库里最久没碰的恰恰是序号最大的那一款
    expect(cardNames(rows[0])[0]).toBe('游戏00') // 时长 / 次数最强
    expect(cardNames(rows[1])[0]).toBe('游戏00') // 最后游玩最近
    expect(cardNames(rows[2])[0]).toBe('游戏39') // 空置 40 天，最久没碰
    expect(cardNames(rows[2])).not.toEqual(cardNames(rows[0]))
  })

  it('「重新推荐」只重刷本行，且固定席位原文不动', async () => {
    const wrapper = await mountLoaded()
    const before0 = cardNames(rowsOf(wrapper)[0])
    const before1 = cardNames(rowsOf(wrapper)[1])
    const before2 = cardNames(rowsOf(wrapper)[2])

    await rowsOf(wrapper)[0].find('.refresh-btn').trigger('click')
    await flushPromises()

    const after0 = cardNames(rowsOf(wrapper)[0])
    expect(after0.slice(0, 3)).toEqual(before0.slice(0, 3))
    expect(after0).not.toEqual(before0)
    expect(after0).toHaveLength(8)
    expect(cardNames(rowsOf(wrapper)[1])).toEqual(before1)
    expect(cardNames(rowsOf(wrapper)[2])).toEqual(before2)
  })

  it('点卡片时带上 gameId 跳到游戏页，让那一页直接弹详情面板', async () => {
    const wrapper = await mountLoaded()
    const push = (wrapper.vm as any).$router.push

    await rowsOf(wrapper)[0].findAll('.chain-card')[0].trigger('click')
    await flushPromises()

    expect(push).toHaveBeenCalledWith({ name: 'games', query: { gameId: 'g00' } })
  })
})

describe('主页全局标签筛选', () => {
  it('点击标签设为「包含」，三条链路同时收敛到该标签', async () => {
    const wrapper = await mountLoaded()

    await wrapper.find('.tf-trigger').trigger('click')
    const target = wrapper.findAll('.tf-item').find(item => item.text().includes(TAG_INCLUDE_SAMPLE))
    expect(target).toBeTruthy()
    await target!.trigger('click')
    await flushPromises()

    expect(rowsOf(wrapper)).toHaveLength(3)
    for (const name of allCardNames(wrapper)) {
      expect(indexOfName(name) % 2).toBe(0) // 只可能是带 3D 的偶数序号游戏
    }

    const saved = JSON.parse(localStorage.getItem('ggv-home-tag-filter') as string)
    expect(saved.include).toEqual([TAG_INCLUDE_SAMPLE])
    expect(saved.exclude).toEqual([])
  })

  it('再点一次变成「排除」，被排除的标签彻底消失', async () => {
    const wrapper = await mountLoaded()

    await wrapper.find('.tf-trigger').trigger('click')
    await wrapper.findAll('.tf-item').find(item => item.text().includes(TAG_INCLUDE_SAMPLE))!.trigger('click')
    await flushPromises()
    await wrapper.findAll('.tf-item').find(item => item.text().includes(TAG_INCLUDE_SAMPLE))!.trigger('click')
    await flushPromises()

    for (const name of allCardNames(wrapper)) {
      expect(indexOfName(name) % 2).toBe(1) // 只剩「像素」那一半
    }

    const saved = JSON.parse(localStorage.getItem('ggv-home-tag-filter') as string)
    expect(saved.include).toEqual([])
    expect(saved.exclude).toEqual([TAG_INCLUDE_SAMPLE])
  })

  it('包含多个标签是 AND 逻辑，筛空时给出空状态与清空按钮', async () => {
    const wrapper = await mountLoaded()

    // 同一个标签先包含再排除 → 直接筛空
    await wrapper.find('.tf-trigger').trigger('click')
    await wrapper.findAll('.tf-item').find(item => item.text().includes(TAG_INCLUDE_SAMPLE))!.trigger('click')
    await flushPromises()
    await wrapper.findAll('.tf-item').find(item => item.text().includes(TAG_INCLUDE_SAMPLE))!.trigger('click')
    await flushPromises()

    // 换一种筛空方式：同时包含 3D 与 像素（AND ⇒ 没有游戏同时满足）
    await wrapper.vm.onTagFilterUpdate({ selected: [TAG_INCLUDE_SAMPLE, '像素'], excluded: [] })
    await flushPromises()

    expect(rowsOf(wrapper)).toHaveLength(0)
    expect(wrapper.find('.filter-empty').exists()).toBe(true)

    // 清空筛选后三条链路回来
    await wrapper.vm.clearTagFilter()
    await flushPromises()
    expect(rowsOf(wrapper)).toHaveLength(3)
    expect(allCardNames(wrapper)).toHaveLength(24)
  })

  it('筛选条件会写进 localStorage，重新挂载后仍然生效', async () => {
    const wrapper = await mountLoaded()
    await wrapper.vm.onTagFilterUpdate({ selected: [TAG_INCLUDE_SAMPLE], excluded: [] })
    await flushPromises()
    wrapper.unmount()

    const remounted = await mountLoaded()
    expect(remounted.find('.tf-trigger').classes()).toContain('is-active')
    for (const name of allCardNames(remounted)) {
      expect(indexOfName(name) % 2).toBe(0)
    }
  })
})
