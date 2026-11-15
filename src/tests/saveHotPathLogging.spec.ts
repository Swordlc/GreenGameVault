/**
 * 守卫：**保存热路径里不许打日志**，且生产构建必须继续剔掉 console.log。
 *
 * 背景（2026-10-05 实锤）：
 *   `GenericResourceView.saveData()` 里曾经有一段「按记录逐条打印 + 把整个数组 dump 进 console」
 *   的调试日志，而 `vite.config.js` 当时没有剔 console —— 于是它跟着进了发行版。
 *   按主人真库的视频页规模（6476 条）算，**一次保存 = 12954 次 console.log
 *   + 一次 ~3MB 对象图 dump**，每条还要额外 `Object.keys()` 分配一个数组。
 *   连续改几十个标签/封面时渲染层主线程被日志占满、Chromium 的 console 存储一路膨胀，
 *   现象是「整个电脑卡顿、其他游戏掉帧，彻底关掉本应用才恢复」。
 *
 * 为什么要有这个测试：memory/lessons.md 里"不要在热路径按条打日志"这句话
 * 之前只是**散文**，所以它复发了。这里把它变成会红的断言。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const COMPONENT_PATH = resolve(process.cwd(), 'src/components/GenericResourceView.vue')
const VITE_CONFIG_PATH = resolve(process.cwd(), 'vite.config.js')

/**
 * 从源码里按大括号配对抠出一个 `const xxx = ... () => { ... }` 的函数体。
 * 抠不到（或抠错）时下面的 sanity 断言会直接炸，不会静默通过。
 */
function extractFunctionBody(source: string, declaration: string): string {
  const start = source.indexOf(declaration)
  expect(start, `源码里找不到 ${declaration}`).toBeGreaterThan(-1)

  const openBrace = source.indexOf('{', start)
  expect(openBrace, `${declaration} 后面没有函数体`).toBeGreaterThan(-1)

  let depth = 0
  for (let i = openBrace; i < source.length; i++) {
    const char = source[i]
    if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) return source.slice(openBrace + 1, i)
    }
  }
  throw new Error(`${declaration} 的大括号没有配平`)
}

describe('saveData：保存热路径不许有逐条日志', () => {
  const source = readFileSync(COMPONENT_PATH, 'utf8')
  const body = extractFunctionBody(source, 'const saveData = async () =>')

  it('抠出来的确实是 saveData（不是抠歪了）', () => {
    expect(body.length).toBeGreaterThan(200)
    expect(body).toContain('sqliteSavePageResources')
    expect(body).toContain('getSaveData')
  })

  it('函数体里没有 console.log / console.debug / console.info', () => {
    const hits = body.match(/console\.(log|debug|info)\s*\(/g) || []
    expect(
      hits,
      `saveData 里出现了 ${hits.length} 处日志调用。` +
        '保存是全页全量写库（视频页 6476 条），按记录打日志会把渲染层拖垮 —— ' +
        '要调试请用临时断点，别把日志留在热路径里。'
    ).toEqual([])
  })

  it('没有按记录遍历打日志的循环（曾经的真凶）', () => {
    expect(body).not.toMatch(/forEach\([^)]*=>\s*\{[^}]*console\./)
  })
})

describe('vite 生产构建：console.log 必须被剔掉', () => {
  const config = readFileSync(VITE_CONFIG_PATH, 'utf8')

  it('配置了 esbuild.pure 剔除 console.log / info / debug', () => {
    // Vite 会把顶层 esbuild 选项展开进最终的 minify 阶段（见 vite/dist/node/chunks 里的
    // resolveEsbuildTranspileOptions），所以在生产包里这些调用会被真的删掉。
    expect(config).toMatch(/pure\s*:\s*\[/)
    expect(config).toMatch(/['"]console\.log['"]/)
    expect(config).toMatch(/['"]console\.info['"]/)
    expect(config).toMatch(/['"]console\.debug['"]/)
  })

  it('刻意不剔 console.warn / console.error（真出问题时还要靠它们）', () => {
    expect(config).not.toMatch(/['"]console\.warn['"]/)
    expect(config).not.toMatch(/['"]console\.error['"]/)
  })

  it('顺手剔掉 debugger 语句', () => {
    expect(config).toMatch(/drop\s*:\s*\[[^\]]*['"]debugger['"]/)
  })
})
