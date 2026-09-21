/**
 * @module AppRoot
 * @description 统一「资源根目录」与「数据根目录」，让数据稳定地待在程序旁边。
 *
 * ## 背景（2026-09-22 实测）
 *
 * 上游沿用「数据目录 = `process.cwd()`」的约定，这在**双击启动**时恰好等于程序目录，
 * 所以一直没暴露问题。但实测证明它很脆：
 *
 * | 启动方式 | cwd | 上游行为 |
 * | --- | --- | --- |
 * | 双击程序目录里的 exe | 程序目录 | ✅ 数据在程序旁 |
 * | 快捷方式（起始位置为空） | 程序目录 | ✅ |
 * | 从别的目录拉起（脚本 / 某些启动器） | **那个目录** | ❌ **数据跑到别处，看起来「库空了」** |
 * | 旧版单文件 portable | `%TEMP%\<随机名>` | ❌ **退出时连同目录被清空** |
 *
 * 本项目 v1.0.0 尚未发布、没有任何已安装用户，因此这里把约定改成
 * **「打包后 = exe 所在目录」**，四种情况一次性都正确，且没有迁移成本。
 *
 * ## 规则
 *
 * ```
 * packagedRoot = 打包后 → path.dirname(app.getPath('exe'))；开发版 → null
 * 资源根 = packagedRoot ?? 启动时 cwd     // configs/、disguise/ 等随包资源
 * 数据根 = PORTABLE_EXECUTABLE_DIR ?? packagedRoot ?? 启动时 cwd   // SaveData 等用户数据
 * ```
 *
 * - **开发版**：两者都等于 cwd（仓库根），行为与改动前完全一致
 * - **安装版 / 绿色包**：两者都等于 exe 所在目录 ⇒ 从哪拉起都不影响
 * - **单文件 portable**（现已不再作为发行目标，逻辑保留作防御）：
 *   资源根 = `%TEMP%` 解包目录，数据根 = 便携 exe 所在目录
 *
 * 启动时把进程 cwd 切到数据根（`applyDataRootAsCwd()`），这样**所有**依赖
 * `process.cwd()` 的数据路径（含渲染层传来的相对路径）一次性统一，无需逐处修改。
 *
 * 用户的 `settings.saveDataLocation === 'custom'` + `saveDataPath` 仍然优先，
 * 不受本模块影响（见 `database/sqlite.js`）。
 */

const path = require('path')
const fs = require('fs')

// 必须在任何 chdir 之前捕获
const launchCwd = process.cwd()
const portableDir = (process.env.PORTABLE_EXECUTABLE_DIR || '').trim()

/**
 * 打包后应用所在目录（exe 旁边）。
 * 开发版返回 null —— 让开发时的行为保持「仓库根」不变。
 * @returns {string|null}
 */
function resolvePackagedRoot() {
  try {
    // 注意：非 Electron 环境（单测 / 探针脚本）下 require('electron') 返回的是
    // 二进制路径字符串，没有 app，靠下面的判断自然落空。
    const electron = require('electron')
    const app = electron && electron.app
    if (app && app.isPackaged) {
      return path.dirname(app.getPath('exe'))
    }
  } catch (e) {
    // 忽略：非 Electron 运行时
  }
  return null
}

const packagedRoot = resolvePackagedRoot()
const resourcesRoot = packagedRoot || launchCwd
const dataRoot = portableDir || packagedRoot || launchCwd

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
 * 数据根是否与启动 cwd 不同（即是否需要 chdir）
 * @returns {boolean}
 */
function needsChdir() {
  return path.resolve(dataRoot) !== path.resolve(launchCwd)
}

/**
 * 把进程 cwd 切到数据根。
 * 开发版（未打包、且非便携版）下是空操作。
 */
function applyDataRootAsCwd() {
  if (!needsChdir()) return
  try {
    fs.mkdirSync(dataRoot, { recursive: true })
    process.chdir(dataRoot)
    console.log(
      `[AppRoot] 数据根 = ${dataRoot}` +
        (resourcesRoot === dataRoot ? '' : `（资源根仍为 ${resourcesRoot}）`)
    )
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
  needsChdir,
  applyDataRootAsCwd,
  resolveResourcePath
}
