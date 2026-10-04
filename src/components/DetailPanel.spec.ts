/**
 * DetailPanel「开发商折叠」逻辑测试
 *
 * 直接调用组件真实的 computed / methods（不挂载），
 * 用真实的 Game 类实例和真实的 game.ts 配置，避免测试里复制一份逻辑自己骗自己。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { nextTick, reactive, watch } from 'vue'
import DetailPanel from './DetailPanel.vue'
import { Game } from '@resources/game.ts'
import { Video } from '@resources/video.ts'

const methods: Record<string, Function> = (DetailPanel as any).methods
const computed: Record<string, Function> = (DetailPanel as any).computed

/** 造一个「this」，把组件真实方法绑上去；computed 用 getter 接到真实实现 */
function makeCtx(item: any) {
  const ctx: any = {
    item,
    expandedInfoFields: {},
    // data() 里的两个缓存字段：详情页封面解析要用
    imageCache: {},
    resolvingImages: {}
  }
  for (const [key, fn] of Object.entries(methods)) {
    ctx[key] = (fn as Function).bind(ctx)
  }
  for (const key of ['detailPanelConfig', 'coverRevision']) {
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

/* -------------------------------------------------------------------------- */
/* 详情页左侧封面（2026-10-04 修：之前对「相对 SaveData 的封面」会拼出           */
/* file://games/covers/x.png 这种非法 URL，导致左侧永远空白 —— 游戏页也中招）     */
/* -------------------------------------------------------------------------- */

const originalElectronAPI = (window as any).electronAPI

afterEach(() => {
  ;(window as any).electronAPI = originalElectronAPI
})

function makeVideo(coverPath = '') {
  const video = new Video()
  video.id.value = 'v1'
  video.name.value = '测试视频'
  video.coverPath.value = coverPath
  return video
}

describe('DetailPanel 左侧封面解析', () => {
  it('没有封面时回退到资源类自己的默认图标（不再是一块空白）', () => {
    expect(makeCtx(makeGame([])).resolveImage('')).toBe('./default-game.png')
    expect(makeCtx(makeVideo('')).resolveImage('')).toBe('./default-video.png')
  })

  it('相对 SaveData 的封面绝不能拼成 file://games/... 这种非法 URL', () => {
    const ctx = makeCtx(makeVideo('videos/covers/abc.jpg'))
    const result = ctx.resolveImage('videos/covers/abc.jpg')

    expect(result).not.toContain('file://videos')
    // 先给默认图占位，真正的图异步解析
    expect(result).toBe('./default-video.png')
  })

  it('相对路径会被解析成 data:URL 并缓存（走主进程 getCoverFullPath + readFileAsDataUrl）', async () => {
    const readCalls: string[] = []
    ;(window as any).electronAPI = {
      getCoverFullPath: async () => ({ success: true, fullPath: 'D:\\SaveData\\videos\\covers\\abc.jpg' }),
      readFileAsDataUrl: async (p: string) => {
        readCalls.push(p)
        return 'data:image/jpeg;base64,AAAA'
      }
    }

    const ctx = makeCtx(makeVideo('videos/covers/abc.jpg'))
    ctx.resolveImage('videos/covers/abc.jpg')
    // 等异步解析落地
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(readCalls[0]).toBe('D:\\SaveData\\videos\\covers\\abc.jpg')
    expect(ctx.imageCache['videos/covers/abc.jpg']).toBe('data:image/jpeg;base64,AAAA')
    // 第二次直接命中缓存，不再请求
    expect(ctx.resolveImage('videos/covers/abc.jpg')).toBe('data:image/jpeg;base64,AAAA')
  })

  it('绝对磁盘路径转成 file:/// URL，中文分段会被编码', () => {
    const ctx = makeCtx(makeGame([]))
    expect(ctx.resolveImage('D:\\SaveData\\games\\covers\\封面.png'))
      .toBe('file:///D:/SaveData/games/covers/%E5%B0%81%E9%9D%A2.png')
  })

  it('已经是 data:/http(s)/file:/archive: 的原样返回', () => {
    const ctx = makeCtx(makeGame([]))
    for (const url of ['data:image/png;base64,AA', 'https://a/b.png', 'file:///D:/a.png', 'archive:///D:/a.cbz#1.png']) {
      expect(ctx.resolveImage(url)).toBe(url)
    }
  })

  it('默认图也加载失败时只回退一次（避免死循环）', () => {
    const ctx = makeCtx(makeVideo(''))
    const target: any = { dataset: {} }
    ctx.handleImageError({ target })
    expect(target.src).toBe('./default-video.png')
    const again: any = { dataset: { fallbackApplied: '1' } }
    ctx.handleImageError({ target: again })
    expect(again.src).toBeUndefined()
  })

  it('重刷封面（coverUpdatedAt 变了）会丢掉缓存，左侧不再显示旧图', () => {
    const video = makeVideo('videos/covers/v1.jpg')
    const ctx = makeCtx(video)
    ctx.imageCache['videos/covers/v1.jpg'] = 'data:image/jpeg;base64,OLD'

    // watch coverRevision 的 handler 应该就是失效逻辑
    const handler = (DetailPanel as any).watch.coverRevision.handler
    expect(typeof handler).toBe('function')
    handler.call(ctx)

    expect(ctx.imageCache['videos/covers/v1.jpg']).toBeUndefined()
  })

  it('响应式链路真的通：改 coverUpdatedAt.value 能让缓存失效（不是只测 handler）', async () => {
    const video = reactive(makeVideo('videos/covers/v1.jpg'))
    const ctx = makeCtx(video)
    ctx.imageCache['videos/covers/v1.jpg'] = 'data:image/jpeg;base64,OLD'

    // 复刻组件里的那条 watch：监听 computed coverRevision
    const stop = watch(
      () => computed.coverRevision.call(ctx),
      () => (DetailPanel as any).watch.coverRevision.handler.call(ctx)
    )

    // 组件里 setField(item,'coverUpdatedAt', Date.now()) 干的就是这件事
    video.coverUpdatedAt.value = Date.now()
    await nextTick()

    expect(ctx.imageCache['videos/covers/v1.jpg']).toBeUndefined()
    stop()
  })

  it('删除封面后整份缓存清空（此时封面为空，找不到具体键）', () => {
    const ctx = makeCtx(makeVideo(''))
    ctx.imageCache['videos/covers/v1.jpg'] = 'old'

    ctx.invalidateCoverCache()

    expect(ctx.imageCache).toEqual({})
  })
})
