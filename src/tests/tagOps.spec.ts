/**
 * 标签批量操作（重命名 / 合并 / 移除）的单元测试
 *
 * 覆盖两块：
 *   1. 后端纯逻辑 `electron/services/tag-ops.js` —— 真正决定"库里会被改成什么"，
 *      尤其是**数组去重**（一条记录同时挂了 A、B 时合并后只能留一个 C）与**改名撞名拦截**；
 *   2. 渲染层 `src/utils/tagOps.ts` —— 决定界面内存数据与筛选态跟着怎么变。
 *
 * 数据库写入本身（better-sqlite3 是 Electron ABI）不在这里跑，改由装机版的端到端测试验证。
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  applyToValue,
  planTagOperation,
  validateTagOperation,
  buildBackupPayload,
  buildBackupFileName,
  writeBackupFile,
  listLatestBackup,
  pruneBackups,
  resolveBackupDir,
  readFieldValue,
  MAX_BACKUPS
} from '../../electron/services/tag-ops.js'
import {
  resolveTagFieldMeta,
  readItemFieldValue,
  writeItemFieldValue,
  readItemId,
  changesToValueMap,
  applyTagValuesToItems,
  applyTagChangesToItems,
  rewriteFilterSelection,
  estimateMergeAffected,
  describeTagOpResult,
  describeTagOpError,
  describeUndoResult,
  formatUndoLabel
} from '../utils/tagOps'

const tempDirs: string[] = []
function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ggv-tagops-'))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()!
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
})

describe('applyToValue（一条记录的一个字段会变成什么）', () => {
  it('数组字段：重命名只换掉命中的那个', () => {
    expect(applyToValue(['3D', '萝莉'], { action: 'rename', from: ['3D'], to: '3D动画' }))
      .toEqual({ changed: true, value: ['3D动画', '萝莉'] })
  })

  it('数组字段：同一条记录同时挂了 A 和 B，合并后只留一个 C（去重）', () => {
    expect(applyToValue(['2.5D', '3D', '萝莉'], { action: 'merge', from: ['3D', '2.5D'], to: '立体' }))
      .toEqual({ changed: true, value: ['立体', '萝莉'] })
  })

  it('数组字段：移除会删掉命中项，其它顺序不变', () => {
    expect(applyToValue(['3D', '萝莉', '步兵'], { action: 'remove', from: ['萝莉'], to: null }))
      .toEqual({ changed: true, value: ['3D', '步兵'] })
  })

  it('数组字段：移除后可能变空数组（保留字段本身，不删字段）', () => {
    expect(applyToValue(['3D'], { action: 'remove', from: ['3D'], to: null }))
      .toEqual({ changed: true, value: [] })
  })

  it('单值字段：重命名命中就替换', () => {
    expect(applyToValue('某社', { action: 'rename', from: ['某社'], to: '新社' }))
      .toEqual({ changed: true, value: '新社' })
  })

  it('单值字段：移除 = 清空成空字符串', () => {
    expect(applyToValue('某社', { action: 'remove', from: ['某社'], to: null }))
      .toEqual({ changed: true, value: '' })
  })

  it('没命中的记录一律不动（changed=false）', () => {
    expect(applyToValue(['萝莉'], { action: 'rename', from: ['3D'], to: '3D动画' }).changed).toBe(false)
    expect(applyToValue('别的社', { action: 'remove', from: ['某社'], to: null }).changed).toBe(false)
    expect(applyToValue(undefined, { action: 'remove', from: ['某社'], to: null }).changed).toBe(false)
  })
})

describe('planTagOperation（全库要改哪些行）', () => {
  const records = [
    { id: 'v1', tags: ['3D', '萝莉'] },
    { id: 'v2', tags: ['2.5D'] },
    { id: 'v3', tags: [] },
    { id: 'v4', tags: ['步兵'] }
  ]

  it('合并两个标签：命中 2 条、库存里能列出该字段出现过的全部取值', () => {
    const plan = planTagOperation(records, { field: 'tags', action: 'merge', from: ['3D', '2.5D'], to: '立体' })
    expect(plan.affected).toBe(2)
    expect(plan.scanned).toBe(4)
    expect(plan.changes).toEqual([
      { id: 'v1', before: ['3D', '萝莉'], after: ['立体', '萝莉'] },
      { id: 'v2', before: ['2.5D'], after: ['立体'] }
    ])
    expect(plan.inventory).toEqual(['2.5D', '3D', '步兵', '萝莉'])
  })

  it('兼容 ResourceField 包装（{ value } 形态）', () => {
    const wrapped = [{ id: 'v9', tags: { value: ['3D'] } }]
    const plan = planTagOperation(wrapped, { field: 'tags', action: 'remove', from: ['3D'], to: null })
    expect(plan.affected).toBe(1)
    expect(plan.changes[0].after).toEqual([])
  })

  it('没有任何记录命中时 affected = 0（调用方据此提示"没人用这个标签"）', () => {
    const plan = planTagOperation(records, { field: 'tags', action: 'remove', from: ['不存在'], to: null })
    expect(plan.affected).toBe(0)
    expect(plan.changes).toEqual([])
  })
})

describe('validateTagOperation（动手前的拦截）', () => {
  const inventory = ['3D', '萝莉', '步兵']

  it('改名撞名 → 停下并引导去用合并', () => {
    const result = validateTagOperation({ action: 'rename', from: ['3D'], to: '萝莉', inventory })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('duplicate')
    expect(result.message).toContain('合并')
  })

  it('改名成全新名字 → 放行', () => {
    expect(validateTagOperation({ action: 'rename', from: ['3D'], to: '3D动画', inventory }).ok).toBe(true)
  })

  it('合并允许目标名已存在（那就是"并入已有标签"）', () => {
    expect(validateTagOperation({ action: 'merge', from: ['3D', '萝莉'], to: '萝莉', inventory }).ok).toBe(true)
  })

  it('空名字 / 名字没变 / 未知动作 都会被拦下', () => {
    expect(validateTagOperation({ action: 'rename', from: ['3D'], to: '   ', inventory }).code).toBe('empty-name')
    expect(validateTagOperation({ action: 'rename', from: ['3D'], to: '3D', inventory }).code).toBe('unchanged')
    expect(validateTagOperation({ action: 'nope', from: ['3D'], to: 'x', inventory }).code).toBe('invalid-action')
    expect(validateTagOperation({ action: 'remove', from: [], inventory }).code).toBe('no-source')
  })

  it('移除动作不需要目标名', () => {
    expect(validateTagOperation({ action: 'remove', from: ['3D'], to: null, inventory }).ok).toBe(true)
  })
})

describe('备份文件（撤销的底气）', () => {
  it('备份内容记录了表名/字段/动作/改前改后', () => {
    const payload = buildBackupPayload({
      tableName: 'video',
      field: 'tags',
      action: 'remove',
      from: ['3D'],
      to: null,
      changes: [{ id: 'v1', before: ['3D'], after: [] }],
      createdAt: new Date('2026-10-13T22:15:30Z')
    })
    expect(payload.version).toBe(1)
    expect(payload.affected).toBe(1)
    expect(payload.changes[0]).toEqual({ id: 'v1', before: ['3D'], after: [] })
  })

  it('文件名带时间戳、动作与字段（便于肉眼翻备份目录）', () => {
    const name = buildBackupFileName(new Date(2026, 9, 13, 22, 15, 30), 'merge', 'tags')
    expect(name).toBe('20261013-221530-merge-tags.json')
  })

  it('写入后能查到最近一次（按表过滤），并按上限裁剪旧备份', () => {
    const dir = makeTempDir()
    const payload = buildBackupPayload({
      tableName: 'video', field: 'tags', action: 'rename', from: ['A'], to: 'B',
      changes: [{ id: 'v1', before: ['A'], after: ['B'] }]
    })
    writeBackupFile(dir, payload, new Date(2026, 9, 13, 10, 0, 0))
    const otherTable = buildBackupPayload({
      tableName: 'games', field: 'tags', action: 'remove', from: ['X'], to: null,
      changes: [{ id: 'g1', before: ['X'], after: [] }]
    })
    writeBackupFile(dir, otherTable, new Date(2026, 9, 13, 11, 0, 0))

    const latestAny = listLatestBackup(dir)
    expect(latestAny?.tableName).toBe('games')
    const latestVideo = listLatestBackup(dir, 'video')
    expect(latestVideo?.action).toBe('rename')
    expect(latestVideo?.affected).toBe(1)

    // 裁剪：造够 25 份，只留 MAX_BACKUPS 份
    for (let i = 0; i < 25; i++) {
      const p = buildBackupPayload({
        tableName: 'video', field: 'tags', action: 'rename', from: ['A'], to: `B${i}`,
        changes: [{ id: 'v1', before: ['A'], after: [`B${i}`] }]
      })
      writeBackupFile(dir, p, new Date(2026, 9, 13, 12, 0, i))
    }
    const before = fs.readdirSync(dir).filter(name => name.endsWith('.json')).length
    pruneBackups(dir)
    const after = fs.readdirSync(dir).filter(name => name.endsWith('.json')).length
    expect(before).toBeGreaterThan(MAX_BACKUPS)
    expect(after).toBe(MAX_BACKUPS)
  })

  it('备份目录固定在存档目录下的 TagOpsBackup', () => {
    expect(resolveBackupDir('D:/SaveData')).toBe(path.join('D:/SaveData', 'TagOpsBackup'))
    expect(resolveBackupDir('')).toBeNull()
  })

  it('readFieldValue 兼容纯值 / { value } 包装', () => {
    expect(readFieldValue({ tags: ['A'] }, 'tags')).toEqual(['A'])
    expect(readFieldValue({ tags: { value: ['A'] } }, 'tags')).toEqual(['A'])
    expect(readFieldValue({}, 'tags')).toBeUndefined()
  })
})

describe('resolveTagFieldMeta（哪些筛选分区可以编辑）', () => {
  it('resourceField + 真实字段 → 可编辑，并带出字段与资源类型', () => {
    const meta = resolveTagFieldMeta({
      key: 'author', filterType: 'resourceField', params: { resource: 'video', field: 'author' }, isArray: true
    })
    expect(meta).toEqual({ editable: true, field: 'author', resourceType: 'video', isArray: true })
  })

  it('算出来的字段（格式筛选 ext）不给编辑入口', () => {
    expect(resolveTagFieldMeta({
      key: 'extensions', filterType: 'resourceField', params: { resource: 'video', field: 'ext' }
    }).editable).toBe(false)
  })

  it('「丢失的资源」「正在游玩」这类运行时筛选项不给编辑入口', () => {
    expect(resolveTagFieldMeta({ key: 'missing-resources', filterType: 'missingResources', params: {} }).editable).toBe(false)
    expect(resolveTagFieldMeta({ key: 'others', filterType: 'runningStatus', params: {} }).editable).toBe(false)
  })
})

describe('内存数据同步（界面不能继续显示旧标签）', () => {
  const items = () => ([
    { id: { value: 'v1' }, tags: { value: ['3D', '萝莉'] } },
    { id: { value: 'v2' }, tags: { value: ['步兵'] } },
    { id: 'v3', tags: ['3D'] }
  ])

  it('按 id 命中才改，而且保留 ResourceField 包装（只动 .value）', () => {
    const list = items()
    const touched = applyTagChangesToItems(list, 'tags', [
      { id: 'v1', before: ['3D', '萝莉'], after: ['3D动画', '萝莉'] },
      { id: '不存在的id', before: [], after: ['x'] }
    ])
    expect(touched).toBe(1)
    expect((list[0].tags as any).value).toEqual(['3D动画', '萝莉'])
    expect((list[1].tags as any).value).toEqual(['步兵'])
  })

  it('纯值字段同样能改', () => {
    const list = items()
    applyTagValuesToItems(list, 'tags', new Map([['v3', ['3D动画']]]))
    expect(list[2].tags).toEqual(['3D动画'])
  })

  it('changesToValueMap 取 before 就是撤销用的映射', () => {
    const map = changesToValueMap([{ id: 'v1', before: ['3D'], after: ['3D动画'] }], 'before')
    expect(map.get('v1')).toEqual(['3D'])
  })

  it('readItemId / readItemFieldValue / writeItemFieldValue 兼容包装形态', () => {
    const list = items()
    expect(readItemId(list[0])).toBe('v1')
    expect(readItemFieldValue(list[0], 'tags')).toEqual(['3D', '萝莉'])
    expect(writeItemFieldValue(list[0], 'tags', ['x'])).toBe(true)
    expect((list[0].tags as any).value).toEqual(['x'])
  })
})

describe('rewriteFilterSelection（筛选态要跟着改名，否则列表莫名变空）', () => {
  it('重命名：选中项一起改名', () => {
    expect(rewriteFilterSelection(['3D'], [], { action: 'rename', from: ['3D'], to: '3D动画' }))
      .toEqual({ selected: ['3D动画'], excluded: [] })
  })

  it('合并：两个名字并成一个，且不会重复', () => {
    expect(rewriteFilterSelection(['3D', '2.5D'], ['萝莉'], { action: 'merge', from: ['3D', '2.5D'], to: '立体' }))
      .toEqual({ selected: ['立体'], excluded: ['萝莉'] })
  })

  it('移除：把该标签从选中/排除里清掉', () => {
    expect(rewriteFilterSelection(['3D', '萝莉'], ['3D'], { action: 'remove', from: ['3D'], to: null }))
      .toEqual({ selected: ['萝莉'], excluded: [] })
  })
})

describe('estimateMergeAffected（弹窗里的当前页预估）', () => {
  it('同一条记录挂多个待合并标签只算一次', () => {
    const list = [
      { id: 'a', tags: ['3D', '2.5D'] },
      { id: 'b', tags: ['3D'] },
      { id: 'c', tags: ['步兵'] }
    ]
    expect(estimateMergeAffected(list, 'tags', ['3D', '2.5D'])).toBe(2)
    expect(estimateMergeAffected(list, 'tags', ['步兵'])).toBe(1)
    expect(estimateMergeAffected(list, 'tags', [])).toBe(0)
  })

  it('单值字段也能预估', () => {
    expect(estimateMergeAffected([{ publisher: 'A' }, { publisher: 'B' }], 'publisher', ['A'])).toBe(1)
  })
})

describe('文案', () => {
  it('结果文案会说明影响条数、当前页条数与备份', () => {
    const text = describeTagOpResult('rename', ['3D'], '3D动画', { ok: true, affected: 913 }, { pageTouched: 900, hasBackup: true })
    expect(text).toContain('「3D」')
    expect(text).toContain('「3D动画」')
    expect(text).toContain('913')
    expect(text).toContain('当前页显示 900 条')
    expect(text).toContain('撤销')
  })

  it('错误码翻成人话', () => {
    expect(describeTagOpError({ ok: false, code: 'duplicate', message: '已经存在名为「萝莉」的标签，请改用「合并标签」把两者并到一起' }))
      .toContain('合并标签')
    expect(describeTagOpError({ ok: false, code: 'no-match' })).toContain('没有记录')
  })

  it('撤销结果文案包含还原条数与异常计数', () => {
    expect(describeUndoResult({ ok: true, restored: 5, mismatched: 1 })).toContain('还原 5 条')
    expect(describeUndoResult({ ok: true, restored: 5, mismatched: 1 })).toContain('手动改过')
    expect(describeUndoResult({ ok: false, code: 'backup-missing' })).toContain('没有可撤销')
  })

  it('左栏撤销按钮文案', () => {
    const label = formatUndoLabel({
      path: 'x', action: 'merge', field: 'tags', from: ['3D', '2.5D'], to: '立体', affected: 1494
    })
    expect(label).toBe('撤销：合并「3D」、「2.5D」→「立体」（1494 条）')
    expect(formatUndoLabel(null)).toBeNull()
  })
})
