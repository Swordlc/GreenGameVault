/**
 * 开机自启项的读写（`electron/utils/login-item.js`）
 *
 * 这个模块是「开机时静默启动」的全部实现 —— 它靠**往自启项里塞 `--silent` 参数**实现，
 * 于是「开机自启」和「静默启动」两个开关共用同一个注册表项：
 * 改任意一个都必须把整项重写一遍，否则界面改了、实际不生效。
 *
 * 用假 app 对象测，因为真注册表不能也不该在单测里动。
 *
 * ⚠️ 这里钉死的是一个很阴的坑：Electron 在 Windows 上查询自启项时会**连参数一起比**。
 *    如果不带参数去查一个带 `--silent` 的项，会得到 `openAtLogin: false` ——
 *    表现就是「明明开着，重启后开关自己关了」。
 */
import { describe, it, expect, vi } from 'vitest'
import loginItem from '../../electron/utils/login-item.js'

/** 造一个假 app：记录 setLoginItemSettings 的调用，并按登录项状态回答 getLoginItemSettings */
function makeApp(registered: { plain?: boolean; silent?: boolean } = {}) {
  const calls: any[] = []
  const app = {
    setLoginItemSettings: vi.fn((options: any) => { calls.push(options) }),
    getLoginItemSettings: vi.fn((options?: any) => {
      const wantsSilent = Array.isArray(options?.args) && options.args.includes('--silent')
      if (wantsSilent) return { openAtLogin: !!registered.silent }
      return { openAtLogin: !!registered.plain }
    })
  }
  return { app, calls }
}

describe('setAutoStart：写入自启项', () => {
  it('开机自启 + 静默 → 带上 --silent 参数', () => {
    const { app, calls } = makeApp()
    loginItem.setAutoStart(app, true, true)
    expect(calls).toEqual([{ openAtLogin: true, openAsHidden: false, args: ['--silent'] }])
  })

  it('开机自启但不静默 → args 为空数组（把老参数清掉）', () => {
    const { app, calls } = makeApp()
    loginItem.setAutoStart(app, true, false)
    expect(calls).toEqual([{ openAtLogin: true, openAsHidden: false, args: [] }])
  })

  it('关闭自启 → 只关掉，不带参数（与历史行为一致，不留带参数的孤儿项）', () => {
    const { app, calls } = makeApp()
    loginItem.setAutoStart(app, false, true)
    expect(calls).toEqual([{ openAtLogin: false }])
  })
})

describe('readAutoStartState：读回真实状态', () => {
  it('带 --silent 注册的项能被读出来（回归：不带参数去查会误报"已关闭"）', () => {
    const { app } = makeApp({ silent: true })
    expect(loginItem.readAutoStartState(app)).toEqual({ enabled: true, silent: true })
  })

  it('没带参数注册的老项 → enabled 且 silent=false', () => {
    const { app } = makeApp({ plain: true })
    expect(loginItem.readAutoStartState(app)).toEqual({ enabled: true, silent: false })
  })

  it('两种形式都没有 → 完全关闭', () => {
    const { app } = makeApp({})
    expect(loginItem.readAutoStartState(app)).toEqual({ enabled: false, silent: false })
  })

  it('老版本 Electron 不支持带 args 查询（抛异常）时，仍能读出不带参数的项', () => {
    const app = {
      getLoginItemSettings: vi.fn((options?: any) => {
        if (options && Array.isArray(options.args)) throw new Error('args 不支持')
        return { openAtLogin: true }
      })
    }
    expect(loginItem.readAutoStartState(app)).toEqual({ enabled: true, silent: false })
  })
})

describe('isSilentStartArgv：判断这次启动是不是"开机静默"', () => {
  it('打包后的形态：[exe, --silent]', () => {
    expect(loginItem.isSilentStartArgv(['C:\\...\\GreenGameVault.exe', '--silent'])).toBe(true)
  })

  it('开发环境形态：[electron, ., --silent]（所以必须用 includes 而不是 argv[1]）', () => {
    expect(loginItem.isSilentStartArgv(['electron.exe', '.', '--silent'])).toBe(true)
  })

  it('普通双击启动 → false', () => {
    expect(loginItem.isSilentStartArgv(['C:\\...\\GreenGameVault.exe'])).toBe(false)
  })

  it('参数名必须完全匹配，不能被子串骗到', () => {
    expect(loginItem.isSilentStartArgv(['--silent-mode'])).toBe(false)
    expect(loginItem.isSilentStartArgv(['--silently'])).toBe(false)
  })

  it('不是数组时安全返回 false', () => {
    expect(loginItem.isSilentStartArgv(undefined as any)).toBe(false)
    expect(loginItem.isSilentStartArgv('--silent' as any)).toBe(false)
  })
})

describe('开关与参数的往返一致性', () => {
  it('写进去什么、读出来就是什么（四种组合）', () => {
    for (const silent of [true, false]) {
      for (const enabled of [true, false]) {
        const { app } = makeApp()
        loginItem.setAutoStart(app, enabled, silent)
        // 把写入的注册表效果还原成假 app 的回答
        const written = app.setLoginItemSettings.mock.calls[0][0]
        const state = loginItem.readAutoStartState({
          getLoginItemSettings: (options?: any) => {
            if (!written.openAtLogin) return { openAtLogin: false }
            const wantsSilent = Array.isArray(options?.args) && options.args.includes('--silent')
            const registeredSilent = Array.isArray(written.args) && written.args.includes('--silent')
            return { openAtLogin: wantsSilent ? registeredSilent : !registeredSilent }
          }
        } as any)
        expect(state).toEqual({ enabled, silent: enabled ? silent : false })
      }
    }
  })
})
