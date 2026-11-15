/**
 * @module LoginItemUtils
 * @description 开机自启项的读写（Windows 注册表 `HKCU\...\Run`，Electron 负责写）。
 *
 * 为什么单独抽一个模块：
 *   「静默启动（只进托盘）」是靠**自启项里带的参数** `--silent` 实现的 ——
 *   也就是说「开机自启」和「开机时静默启动」两个开关**共用同一个注册表项**，
 *   改动任意一个都必须把参数整个重写一遍，否则界面改了、实际不生效。
 *   这里集中处理这个耦合，顺便让它能用假 app 对象单测（真注册表测不了）。
 *
 * ⚠️ Electron 在 Windows 上查询自启项时会**连参数一起比**：
 *   用 `--silent` 注册、却用不带参数的方式去查，会得到 `openAtLogin: false`，
 *   表现就是「明明开着，重启后开关自己关了」。所以读取时两种形式都要查一遍。
 */

/** 开机自启时传给自己的参数：只建窗口、不弹出来 */
const SILENT_START_FLAG = '--silent'

/**
 * 写入开机自启项
 * @param {import('electron').App} app
 * @param {boolean} enabled 是否开机自启
 * @param {boolean} [silent] 开机时是否静默启动（只有 enabled 为真时才有意义）
 */
function setAutoStart(app, enabled, silent = false) {
  if (!enabled) {
    // 关闭时不带参数：与历史行为保持一致，避免留下带参数的孤儿注册表项
    app.setLoginItemSettings({ openAtLogin: false })
    return
  }
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: false,
    args: silent ? [SILENT_START_FLAG] : []
  })
}

/**
 * 读取开机自启的真实状态（含是否静默）
 * @param {import('electron').App} app
 * @returns {{enabled: boolean, silent: boolean}}
 */
function readAutoStartState(app) {
  // 先按「带 --silent」查：这是我们现在会写的形式
  try {
    if (app.getLoginItemSettings({ args: [SILENT_START_FLAG] }).openAtLogin) {
      return { enabled: true, silent: true }
    }
  } catch (_) {
    // 老版本 Electron 不支持 args 查询：忽略，走下面的无参查询
  }
  if (app.getLoginItemSettings().openAtLogin) {
    return { enabled: true, silent: false }
  }
  return { enabled: false, silent: false }
}

/**
 * 判断一次启动（命令行）是否为「开机自启的静默启动」
 * @param {string[]} argv
 * @returns {boolean}
 */
function isSilentStartArgv(argv) {
  return Array.isArray(argv) && argv.includes(SILENT_START_FLAG)
}

module.exports = {
  SILENT_START_FLAG,
  setAutoStart,
  readAutoStartState,
  isSilentStartArgv
}
