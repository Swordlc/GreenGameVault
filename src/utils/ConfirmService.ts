/**
 * 全局 Confirm 服务
 * 提供统一的自定义 Confirm 确认对话框功能
 */

interface ConfirmOptions {
  title?: string
  message: string
  /** 是否默认取消（true: 默认焦点在取消按钮，false: 默认焦点在确定按钮） */
  defaultCancel?: boolean
}

class ConfirmService {
  confirmComponent: any
  isInitialized: boolean

  constructor() {
    this.confirmComponent = null
    this.isInitialized = false
  }

  // 初始化 Confirm 服务
  init(confirmComponent: any) {
    this.confirmComponent = confirmComponent
    this.isInitialized = true
  }

  // 检查是否已初始化
  checkInitialized() {
    if (!this.isInitialized || !this.confirmComponent) {
      console.warn('Confirm 服务未初始化，请确保 ConfirmDialog 组件已挂载')
      return false
    }
    return true
  }

  // 显示 Confirm 对话框
  show(options: ConfirmOptions | string): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.checkInitialized()) {
        // 如果未初始化，降级到浏览器原生 confirm
        const message = typeof options === 'string' ? options : options.message
        const result = window.confirm(message)
        resolve(result)
        return
      }

      // 处理字符串参数（兼容原生 confirm 用法）
      const confirmOptions: ConfirmOptions = typeof options === 'string' 
        ? { message: options }
        : options

      const title = confirmOptions.title || '确认'
      const message = confirmOptions.message || ''
      const defaultCancel = confirmOptions.defaultCancel !== undefined ? confirmOptions.defaultCancel : true

      // 调用组件方法显示 Confirm
      this.confirmComponent.showConfirm(title, message, resolve, defaultCancel)
    })
  }

  // 便捷方法：显示确认对话框
  confirm(
    message: string, 
    title: string = '确认',
    defaultCancel: boolean = true
  ): Promise<boolean> {
    return this.show({ title, message, defaultCancel })
  }
}

// 创建全局实例
const confirmService = new ConfirmService()

// 导出服务实例
export default confirmService

