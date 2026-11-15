/**
 * 视频页「标签格式刷」的纯逻辑
 *
 * 重点覆盖三件**算错就会毁数据**的事：
 *   1. 合并（merge）是并集，**绝不能**丢掉目标原有的标签；
 *   2. 覆盖（overwrite）必须真的清掉目标原有的标签/作者（这是危险操作，语义不能含糊）；
 *   3. 字段既可能是 `ResourceField` 包装（`.value`）也可能是裸属性 ——
 *      写错位置会"改了但界面不刷新 / 存库还是旧值"，两个入口都要钉死。
 *
 * 真实页面里的 items 是 `reactive(new Video())`，所以这里直接用真 Video 类做一次端到端验证，
 * 只用假对象测等于没测（见 memory/lessons.md：守卫要靠测试，不靠注释）。
 */
import { describe, it, expect } from 'vitest'
import { reactive } from 'vue'
import { Video } from '../configs/resources/video'
import {
  normalizeFormatList,
  readTagFormat,
  readFormatField,
  writeFormatField,
  computeTagFormatPaste,
  isSameList
} from '../utils/videoTagFormat'

function makeVideo(tags: string[] = [], author: string[] = []): Video {
  const video = new Video()
  video.name.value = '第01话.mp4'
  video.tags.value = [...tags]
  video.author.value = [...author]
  return video
}

describe('normalizeFormatList：清洗成可直接比较的字符串数组', () => {
  it('去空白、丢掉空串、按原顺序去重', () => {
    expect(normalizeFormatList([' 无修 ', '', '合集A', '无修', '   '])).toEqual(['无修', '合集A'])
  })

  it('标量会被当成单元素数组（编辑框里只填了一个标签的情况）', () => {
    expect(normalizeFormatList('单体')).toEqual(['单体'])
    expect(normalizeFormatList(123)).toEqual(['123'])
  })

  it('空值得到空数组而不是 [null] / ["undefined"]', () => {
    expect(normalizeFormatList(null)).toEqual([])
    expect(normalizeFormatList(undefined)).toEqual([])
    expect(normalizeFormatList('')).toEqual([])
    expect(normalizeFormatList([])).toEqual([])
  })

  it('会解开 ResourceField 的 .value', () => {
    expect(normalizeFormatList({ value: ['A', 'B'] })).toEqual(['A', 'B'])
  })
})

describe('readTagFormat：从一条记录里取色', () => {
  it('真 Video 实例（ResourceField 形态）能读到标签与作者', () => {
    const snapshot = readTagFormat(makeVideo(['无修', '合集A'], ['某社团']))
    expect(snapshot).toEqual({ tags: ['无修', '合集A'], author: ['某社团'] })
  })

  it('裸属性对象也能读到（从 DB / JSON 复原出来的记录）', () => {
    const snapshot = readTagFormat({ tags: ['无修'], author: ['某社团'] })
    expect(snapshot).toEqual({ tags: ['无修'], author: ['某社团'] })
  })

  it('两者都空 → null（表示这张卡当不了格式刷）', () => {
    expect(readTagFormat(makeVideo([], []))).toBeNull()
    expect(readTagFormat({ tags: [], author: ['  '] })).toBeNull()
    expect(readTagFormat(null)).toBeNull()
  })

  it('返回的是普通数组（不是 Proxy、不是原字段的同一个引用）', () => {
    const proxy = reactive(makeVideo(['无修'], ['某社团']) as any)
    const snapshot = readTagFormat(proxy)!
    expect(() => structuredClone(snapshot)).not.toThrow()
    // 改动源记录不该影响已经取下来的快照
    proxy.tags.value = ['改过了']
    expect(snapshot.tags).toEqual(['无修'])
  })
})

describe('computeTagFormatPaste：合并', () => {
  const clip = { tags: ['无修', '合集A'], author: ['新社团'] }

  it('并集：目标原有的标签一个都不能丢', () => {
    const result = computeTagFormatPaste(
      { tags: ['旧标签'], author: ['旧社团'] },
      clip,
      'merge'
    )
    expect(result.tags).toEqual(['旧标签', '无修', '合集A'])
    expect(result.author).toEqual(['旧社团', '新社团'])
    expect(result.changed).toBe(true)
  })

  it('重复的不会叠加成两份', () => {
    const result = computeTagFormatPaste(
      { tags: ['无修'], author: [] },
      clip,
      'merge'
    )
    expect(result.tags).toEqual(['无修', '合集A'])
  })

  it('刷子内容是目标子集 → changed=false（调用方应跳过，不做无谓落库）', () => {
    const result = computeTagFormatPaste(
      { tags: ['合集A', '无修'], author: ['新社团'] },
      clip,
      'merge'
    )
    expect(result.changed).toBe(false)
  })
})

describe('computeTagFormatPaste：覆盖', () => {
  const clip = { tags: ['无修', '合集A'], author: ['新社团'] }

  it('目标原有的标签与作者会被真的清掉（这是"格式刷"的本意，但必须由确认框兜着）', () => {
    const result = computeTagFormatPaste(
      { tags: ['旧标签', '另一个'], author: ['旧社团'] },
      clip,
      'overwrite'
    )
    expect(result.tags).toEqual(['无修', '合集A'])
    expect(result.author).toEqual(['新社团'])
    expect(result.changed).toBe(true)
  })

  it('刷子上没有作者时，覆盖会把目标的作者清空（不是保留）', () => {
    const result = computeTagFormatPaste(
      { tags: [], author: ['旧社团'] },
      { tags: ['只有标签'], author: [] },
      'overwrite'
    )
    expect(result.tags).toEqual(['只有标签'])
    expect(result.author).toEqual([])
  })

  it('已经一模一样 → changed=false', () => {
    const result = computeTagFormatPaste({ ...clip }, clip, 'overwrite')
    expect(result.changed).toBe(false)
  })

  it('内容相同但顺序不同算"有改动"（顺序是用户看得见的信息）', () => {
    const result = computeTagFormatPaste(
      { tags: ['合集A', '无修'], author: ['新社团'] },
      clip,
      'overwrite'
    )
    expect(result.changed).toBe(true)
    expect(result.tags).toEqual(['无修', '合集A'])
  })

  it('结果里永远是普通数组（能过 IPC 结构化克隆）', () => {
    const result = computeTagFormatPaste({ tags: [], author: [] }, clip, 'overwrite')
    expect(result.tags.constructor.name).toBe('Array')
    expect(() => structuredClone(result)).not.toThrow()
  })
})

describe('readFormatField / writeFormatField：两种字段形态都要写对地方', () => {
  it('ResourceField 形态：写进 .value，且不换掉包装对象（换掉会断响应式）', () => {
    const video = reactive(makeVideo() as any)
    const wrapper = video.tags
    writeFormatField(video, 'tags', ['A', 'B'])
    expect(video.tags.value).toEqual(['A', 'B'])
    expect(video.tags).toBe(wrapper)
    expect(readFormatField(video, 'tags')).toEqual(['A', 'B'])
  })

  it('裸属性形态：直接赋值', () => {
    const plain: any = { tags: ['旧'], author: [] }
    writeFormatField(plain, 'tags', ['新'])
    expect(plain.tags).toEqual(['新'])
    expect(readFormatField(plain, 'tags')).toEqual(['新'])
  })

  it('响应式链路真的通：写完 .value 后 getSaveData 拿到的是新值', () => {
    const video = reactive(makeVideo() as any)
    writeFormatField(video, 'tags', ['刷上去的'])
    writeFormatField(video, 'author', ['刷上去的作者'])
    const saveData = video.getSaveData()
    expect(saveData.tags).toEqual(['刷上去的'])
    expect(saveData.author).toEqual(['刷上去的作者'])
  })

  it('null / undefined 记录不会抛异常（批量里混进空项时兜住）', () => {
    expect(() => writeFormatField(null, 'tags', ['A'])).not.toThrow()
    expect(readFormatField(undefined, 'tags')).toEqual([])
  })
})

describe('isSameList', () => {
  it('同长同序才算一样', () => {
    expect(isSameList(['A', 'B'], ['A', 'B'])).toBe(true)
    expect(isSameList(['A', 'B'], ['B', 'A'])).toBe(false)
    expect(isSameList(['A'], ['A', 'B'])).toBe(false)
    expect(isSameList([], [])).toBe(true)
  })
})
