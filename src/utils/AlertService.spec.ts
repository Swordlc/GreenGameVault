/**
 * AlertService 单元测试
 * 验证：未初始化时降级到 window.alert；已初始化时调用组件的 showAlert
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 动态 import 以在 mock 之后获取新实例
async function getFreshAlertService() {
  vi.resetModules()
  const mod = await import('./AlertService')
  return mod.default
}

describe('AlertService', () => {
  let alertSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // happy-dom 环境中 window.alert 可能为 undefined，需先提供
    if (typeof window.alert !== 'function') {
      window.alert = vi.fn()
    }
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
  })

  afterEach(() => {
    alertSpy?.mockRestore()
    vi.restoreAllMocks()
  })

  describe('未初始化时', () => {
    it('show(字符串) 会降级到 window.alert', async () => {
      const alertService = await getFreshAlertService()
      await alertService.show('测试消息')
      expect(alertSpy).toHaveBeenCalledWith('测试消息')
      expect(alertSpy).toHaveBeenCalledTimes(1)
    })

    it('show(options) 未初始化时调用 window.alert(message)', async () => {
      const alertService = await getFreshAlertService()
      await alertService.show({ message: '错误信息', type: 'error' })
      expect(alertSpy).toHaveBeenCalledWith('错误信息')
    })

    it('alert() 便捷方法会调用 show 并最终触发 window.alert', async () => {
      const alertService = await getFreshAlertService()
      await alertService.alert('原生风格提示')
      expect(alertSpy).toHaveBeenCalledWith('原生风格提示')
    })
  })

  describe('已初始化时', () => {
    it('show 会调用组件的 showAlert，而不是 window.alert', async () => {
      const alertService = await getFreshAlertService()
      const mockShowAlert = vi.fn((_title: string, _msg: string, _type: string, resolve: () => void) => resolve())
      alertService.init({ showAlert: mockShowAlert })

      await alertService.show({ title: '标题', message: '内容', type: 'success' })

      expect(alertSpy).not.toHaveBeenCalled()
      expect(mockShowAlert).toHaveBeenCalledWith('标题', '内容', 'success', expect.any(Function))
    })

    it('info/success/warning/error 传递正确参数', async () => {
      const alertService = await getFreshAlertService()
      const mockShowAlert = vi.fn((_t: string, _m: string, type: string, resolve: () => void) => resolve())
      alertService.init({ showAlert: mockShowAlert })

      await alertService.info('信息')
      expect(mockShowAlert).toHaveBeenCalledWith('提示', '信息', 'info', expect.any(Function))

      await alertService.success('成功')
      expect(mockShowAlert).toHaveBeenCalledWith('成功', '成功', 'success', expect.any(Function))

      await alertService.warning('警告')
      expect(mockShowAlert).toHaveBeenCalledWith('警告', '警告', 'warning', expect.any(Function))

      await alertService.error('错误')
      expect(mockShowAlert).toHaveBeenCalledWith('错误', '错误', 'error', expect.any(Function))
    })
  })

  describe('checkInitialized', () => {
    it('未初始化返回 false', async () => {
      const alertService = await getFreshAlertService()
      expect(alertService.checkInitialized()).toBe(false)
    })

    it('已初始化返回 true', async () => {
      const alertService = await getFreshAlertService()
      alertService.init({ showAlert: () => {} })
      expect(alertService.checkInitialized()).toBe(true)
    })
  })
})
