import { describe, it, expect } from 'vitest'
import { reactive } from 'vue'
import { Video } from '../configs/resources/video'

/**
 * 回归：视频页「任何修改都保存失败」。
 *
 * 现象（主人 2026-10-05 报）：视频页改标签/编辑信息 → 弹
 * `An object could not be cloned.`；游戏页正常。
 *
 * 根因：页面里的 `items` 是被 `reactive()` 深度代理过的，于是
 * `video.potPlayerStats.value` 取到的是 **Proxy**；`ipcRenderer.invoke`
 * 走 V8 结构化克隆，不支持 Proxy。视频页只有这一个对象字段，所以只有它炸。
 *
 * 断言方式直接用 `structuredClone` —— 它与 Electron IPC 的序列化器同一套规则。
 */
const STATS = {
  source: 'ini',
  playCount: 3,
  totalSeconds: 1234,
  firstOpenMs: 1700000000000,
  lastOpenMs: 1700000009999,
  lastPositionMs: 60000,
  durationMs: 1440000,
  updatedAt: 1700000010000
}

function makeVideo(withStats: boolean): Video {
  const video = new Video()
  video.name.value = '第01话.mp4'
  video.tags.value = ['合集A', '无修']
  video.author.value = ['某社团']
  video.resourcePath.value = 'E:\\ACG\\合集A\\第01话.mp4'
  if (withStats) (video as any).potPlayerStats.value = { ...STATS }
  return video
}

describe('Video.getSaveData 的 IPC 安全性', () => {
  it('reactive 代理下的 getSaveData 能被结构化克隆（回归：An object could not be cloned）', () => {
    const proxy = reactive(makeVideo(true) as any)
    const saveData = proxy.getSaveData()

    expect(() => structuredClone(saveData)).not.toThrow()
  })

  it('potPlayerStats 被拆成纯对象（值相同、但不再是同一个引用/Proxy）', () => {
    const video = reactive(makeVideo(true) as any)
    const saveData = video.getSaveData()

    expect(saveData.potPlayerStats).toEqual(STATS)
    expect(saveData.potPlayerStats).not.toBe(STATS)
    // 纯对象：可枚举自身键，能直接 JSON 往返
    expect(JSON.parse(JSON.stringify(saveData.potPlayerStats))).toEqual(STATS)
  })

  it('没有统计时为 null（等于「从未观看」的存储形态）', () => {
    const saveData = reactive(makeVideo(false) as any).getSaveData()
    expect(saveData.potPlayerStats).toBeNull()
    expect(() => structuredClone(saveData)).not.toThrow()
  })

  it('非代理实例同样安全（--once / 批量落库等路径不过 reactive）', () => {
    const saveData = makeVideo(true).getSaveData()
    expect(() => structuredClone(saveData)).not.toThrow()
    expect(saveData.potPlayerStats).toEqual(STATS)
  })

  it('字符串数组字段（tags / author / visitedSessions）展开后是纯数组', () => {
    const saveData = reactive(makeVideo(true) as any).getSaveData()
    for (const key of ['tags', 'author', 'visitedSessions']) {
      expect(Array.isArray(saveData[key])).toBe(true)
      expect(saveData[key].constructor.name).toBe('Array')
    }
    expect(saveData.tags).toEqual(['合集A', '无修'])
  })
})
