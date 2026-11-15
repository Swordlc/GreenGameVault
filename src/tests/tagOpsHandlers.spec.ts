/**
 * 标签操作 IPC 处理器的"透传"测试
 *
 * 背景（2026-10-13 被界面 E2E 抓到）：处理器漏了 `dryRun`，于是弹窗里那次
 * "预览影响面"实际上是在**真改数据库** —— 移除标签的预览会直接把标签删掉。
 * 这里用假 ipcMain 把处理器拿出来，直接断言它把哪些参数交给了服务层。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const tagOps = require('../../electron/services/tag-ops.js')
const handlers = require('../../electron/ipc/tag-ops-handlers.js')

/** 收集 registerIpcHandlers 注册的处理器 */
function collectHandlers() {
  const registry = {}
  handlers.registerIpcHandlers({
    handle: (channel, fn) => { registry[channel] = fn }
  })
  return registry
}

describe('tag-op IPC 处理器', () => {
  let captured
  const original = tagOps.applyTagOperation

  beforeEach(() => {
    captured = null
    tagOps.applyTagOperation = vi.fn(async options => {
      captured = options
      return { ok: true, affected: 0, changes: [] }
    })
    return () => { tagOps.applyTagOperation = original }
  })

  it('把 dryRun 透传给服务（否则"预览"会真的改库）', async () => {
    const registry = collectHandlers()
    await registry['tag-op-apply'](null, {
      resourceType: 'Game',
      field: 'tags',
      action: 'remove',
      from: ['测试'],
      dryRun: true
    })
    expect(captured).toBeTruthy()
    expect(captured.dryRun).toBe(true)
    expect(captured.action).toBe('remove')
    expect(captured.tableName).toBe('games')
  })

  it('dryRun 缺省时按"真执行"处理', async () => {
    const registry = collectHandlers()
    await registry['tag-op-apply'](null, {
      resourceType: 'video', field: 'tags', action: 'rename', from: ['A'], to: 'B'
    })
    expect(captured.dryRun).toBe(false)
    expect(captured.tableName).toBe('video')
  })

  it('资源类型大小写都能解析到正确的表（Game → games）', async () => {
    const registry = collectHandlers()
    await registry['tag-op-apply'](null, { resourceType: 'Game', field: 'tags', action: 'remove', from: ['A'] })
    expect(captured.tableName).toBe('games')
    await registry['tag-op-apply'](null, { resourceType: 'Videos', field: 'tags', action: 'remove', from: ['A'] })
    expect(captured.tableName).toBe('video')
  })

  it('合并会带上 allowExisting（允许并入已有的标签名）', async () => {
    const registry = collectHandlers()
    await registry['tag-op-apply'](null, {
      resourceType: 'game', field: 'tags', action: 'merge', from: ['A', 'B'], to: 'B', allowExisting: true
    })
    expect(captured.allowExisting).toBe(true)
  })

  it('参数不合法时直接拒绝，不碰服务层', async () => {
    const registry = collectHandlers()
    const noResource = await registry['tag-op-apply'](null, { field: 'tags', action: 'remove', from: ['A'] })
    expect(noResource.ok).toBe(false)
    expect(noResource.code).toBe('bad-resource')

    const noField = await registry['tag-op-apply'](null, { resourceType: 'game', action: 'remove', from: ['A'] })
    expect(noField.code).toBe('bad-args')

    const badFrom = await registry['tag-op-apply'](null, { resourceType: 'game', field: 'tags', action: 'remove', from: [1, 2] })
    expect(badFrom.code).toBe('bad-args')

    const tooMany = await registry['tag-op-apply'](null, {
      resourceType: 'game', field: 'tags', action: 'merge',
      from: Array.from({ length: 201 }, (_, index) => `tag${index}`), to: 'x'
    })
    expect(tooMany.code).toBe('bad-args')

    expect(tagOps.applyTagOperation).not.toHaveBeenCalled()
  })
})
