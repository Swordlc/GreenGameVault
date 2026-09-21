/**
 * @module AppRoot
 * @description 统一「数据根目录」与「资源根目录」，解决便携版 SaveData 会被清掉的问题。
 *
 * ## 背景（2026-09-22 实测）
 *
 * 单文件便携版（electron-builder 的 `portable` target）会把整个 App **自解压到
 * `%TEMP%\<随机名>\` 再运行**，于是 `process.cwd()` 指向那个临时解包目录：
 *
 * ```
 * C:\Users\<用户>\AppData\Local\Temp\3JdjlRNpbOcKB8YMQBZlp7c6K6f\SaveData\database.db
 * ```
 *
 * 便携版退出时这个目录会被清理 ⇒ **整个游戏库随临时目录一起消失**。
 * 而 `SaveData` 的位置完全由 `process.cwd()` 决定（`database/sqlite.js`、渲染层传来的
 * 相对路径也都按 cwd 解析），散落着十几处，逐处改既脆弱又容易漏。
 *
 * ## 做法
 *
 * electron-builder 给便携版注入了两个环境变量：
 * - `PORTABLE_EXECUTABLE_DIR`  = 便携 exe **所在目录**（用户放 .exe 的地方）
 * - `PORTABLE_EXECUTABLE_FILE` = 便携 exe 的完整路径
 *
 * 于是：
 * - **数据根** = `PORTABLE_EXECUTABLE_DIR`（有就用），否则 `process.cwd()`
 *   → 便携版的 SaveData 落在 .exe 旁边，持久；开发版 / 安装版与原来完全一致。
 * - **资源根** = 启动时的原始 `process.cwd()`
 *   → `configs/`、`disguise/` 这些**随包分发**的资源仍在解包目录里，不能被切走。
 *
 * 启动时把进程 cwd 切到数据根（`applyDataRootAsCwd()`），这样**所有**依赖
 * `process.cwd()` 的数据路径（含渲染层传过来的相对路径）一次性统一，无需逐处修改。
 */

const path = require('path')
const fs = require('fs')

// 必须在任何 chdir 之前捕获
const launchCwd = process.cwd()
const portableDir = (process.env.PORTABLE_EXECUTABLE_DIR || '').trim()

const dataRoot = portableDir || launchCwd
const resourcesRoot = launchCwd

/**
 * 数据根目录：SaveData、数据库、截图、封面等**用户数据**都落在这里。
 * @returns {string}
 */
function getDataRoot() {
  return dataRoot
}

/**
 * 资源根目录：`configs/`、`disguise/` 等**随包分发**的只读资源所在目录。
 * @returns {string}
 */
function getResourcesRoot() {
  return resourcesRoot
}

/**
 * 是否为便携版（单文件）模式
 * @returns {boolean}
 */
function isPortable() {
  return dataRoot !== resourcesRoot
}

/**
 * 把进程 cwd 切到数据根。开发版 / 安装版下二者相同，此函数是空操作。
 */
function applyDataRootAsCwd() {
  if (dataRoot === launchCwd) return
  try {
    fs.mkdirSync(dataRoot, { recursive: true })
    process.chdir(dataRoot)
    console.log(`[AppRoot] 便携版模式：数据根 ${dataRoot}（资源根仍为 ${resourcesRoot}）`)
  } catch (error) {
    console.error('[AppRoot] 切换数据根目录失败，回退到原 cwd:', error)
  }
}

/**
 * 把「随包资源」的相对路径解析到资源根。
 *
 * 只处理 `configs/` 与 `disguise/` 这两个随包目录 —— 其余相对路径（如
 * `SaveData/...`、`games/covers/...`）一律交给调用方按当前 cwd（= 数据根）解析。
 *
 * @param {string} p - 原始路径
 * @returns {string} 解析后的路径
 */
function resolveResourcePath(p) {
  if (!p || typeof p !== 'string') return p
  if (path.isAbsolute(p)) return p
  const normalized = p.replace(/\\/g, '/')
  if (normalized.startsWith('configs/') || normalized.startsWith('disguise/')) {
    return path.join(resourcesRoot, p)
  }
  return p
}

module.exports = {
  getDataRoot,
  getResourcesRoot,
  isPortable,
  applyDataRootAsCwd,
  resolveResourcePath
}
