/**
 * MediaCard 封面缓存失效测试
 *
 * 背景（主人 2026-10-04 报的 bug）：抽帧封面是**固定文件名覆盖写**的
 * （`videos/covers/<id>.jpg`），重刷之后路径一模一样，卡片上却还是第一张图 ——
 * 因为 `imageCache` 按路径缓存，路径没变就永远不会重新读文件。
 *
 * 修法：视频记录多一个 `coverUpdatedAt` 版本号，抽帧/删封面时 +1；
 * 卡片监听它、一变就丢掉那张图的缓存。
 */
import { describe, it, expect } from 'vitest'
import { nextTick, reactive, watch } from 'vue'
import MediaCard from './MediaCard.vue'
import { Video } from '@resources/video.ts'

const methods: Record<string, Function> = (MediaCard as any).methods
const computed: Record<string, Function> = (MediaCard as any).computed

/** 用真实的 Video 实例（MediaCard 的 getFieldValue 只认真正的 ResourceField） */
function makeVideoItem(coverPath = '', coverUpdatedAt = 0) {
  const video = new Video()
  video.id.value = 'v1'
  video.name.value = '测试视频'
  video.coverPath.value = coverPath
  video.coverUpdatedAt.value = coverUpdatedAt
  return video
}

function makeCtx(item: any) {
  const ctx: any = {
    item,
    imageCache: {},
    screenshotCoverPath: 'some/screenshot.png'
  }
  for (const [key, fn] of Object.entries(methods)) {
    ctx[key] = (fn as Function).bind(ctx)
  }
  for (const key of ['coverRevision', 'currentCoverKey', 'coverImagePath']) {
    const getter = computed[key]
    if (getter) Object.defineProperty(ctx, key, { get: () => getter.call(ctx) })
  }
  return ctx
}

const COVER = 'videos/covers/v1.jpg'

describe('MediaCard 封面缓存失效', () => {
  it('coverRevision 读的是 item.coverUpdatedAt', () => {
    expect(makeCtx(makeVideoItem(COVER, 123)).coverRevision).toBe(123)
    expect(makeCtx(makeVideoItem(COVER)).coverRevision).toBe(0)
  })

  it('重刷封面后丢掉缓存 → 卡片会重新读文件（不再永远显示第一张）', () => {
    const ctx = makeCtx(makeVideoItem(COVER, 1))
    ctx.imageCache[COVER] = 'data:image/jpeg;base64,FIRST'

    ctx.invalidateCoverCache()

    expect(ctx.imageCache[COVER]).toBeUndefined()
  })

  it('watch coverRevision 确实接的是失效逻辑（防止有人把 watch 删了）', () => {
    const ctx = makeCtx(makeVideoItem(COVER, 1))
    ctx.imageCache[COVER] = 'data:image/jpeg;base64,FIRST'

    const handler = (MediaCard as any).watch.coverRevision.handler
    expect(typeof handler).toBe('function')
    handler.call(ctx)

    expect(ctx.imageCache[COVER]).toBeUndefined()
  })

  it('删除封面（coverPath 为空）时不炸，并清掉截图回退缓存', () => {
    const ctx = makeCtx(makeVideoItem('', 2))

    expect(() => ctx.invalidateCoverCache()).not.toThrow()
    expect(ctx.imageCache).toEqual({})
    expect(ctx.screenshotCoverPath).toBeNull()
  })

  it('只有当前这条封面的缓存被清掉，别的图不受影响', () => {
    const ctx = makeCtx(makeVideoItem(COVER, 3))
    ctx.imageCache[COVER] = 'old'
    ctx.imageCache['games/covers/other.png'] = 'keep'

    ctx.invalidateCoverCache()

    expect(ctx.imageCache[COVER]).toBeUndefined()
    expect(ctx.imageCache['games/covers/other.png']).toBe('keep')
  })

  it('响应式链路真的通：改 coverUpdatedAt.value 能让缓存失效（不是只测 handler）', async () => {
    const item = reactive(makeVideoItem(COVER, 1))
    const ctx = makeCtx(item)
    ctx.imageCache[COVER] = 'data:image/jpeg;base64,OLD'

    // 复刻组件里的那条 watch：监听 computed coverRevision
    const stop = watch(
      () => computed.coverRevision.call(ctx),
      () => (MediaCard as any).watch.coverRevision.handler.call(ctx)
    )

    item.coverUpdatedAt.value = Date.now()
    await nextTick()

    expect(ctx.imageCache[COVER]).toBeUndefined()
    stop()
  })
})
