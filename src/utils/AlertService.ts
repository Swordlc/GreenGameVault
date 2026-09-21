/**
 * 全局 Alert 服务
 * 提供统一的自定义 Alert 对话框功能
 */

type AlertType = 'info' | 'success' | 'warning' | 'error'

interface AlertOptions {
  title?: string
  message: string
  type?: AlertType
}

class AlertService {
  alertComponent: any
  isInitialized: boolean

  constructor() {
    this.alertComponent = null
    this.isInitialized = false
  }

  // 初始化 Alert 服务
  init(alertComponent: any) {
    this.alertComponent = alertComponent
    this.isInitialized = true
  }

  // 检查是否已初始化
  checkInitialized() {
    if (!this.isInitialized || !this.alertComponent) {
      console.warn('Alert 服务未初始化，请确保 Alert 组件已挂载')
      return false
    }
    return true
  }

  // 显示 Alert
  show(options: AlertOptions | string): Promise<void> {
    return new Promise((resolve) => {
      if (!this.checkInitialized()) {
        // 如果未初始化，降级到浏览器原生 alert
        const message = typeof options === 'string' ? options : options.message
        window.alert(message)
        resolve()
        return
      }

      // 处理字符串参数（兼容原生 alert 用法）
      const alertOptions: AlertOptions = typeof options === 'string' 
        ? { message: options }
        : options

      const title = alertOptions.title || '提示'
      const message = alertOptions.message || ''
      const type = alertOptions.type || 'info'

      // 调用组件方法显示 Alert
      this.alertComponent.showAlert(title, message, type, resolve)
    })
  }

  // 便捷方法：显示信息提示
  info(message: string, title: string = '提示'): Promise<void> {
    return this.show({ title, message, type: 'info' })
  }

  // 便捷方法：显示成功提示
  success(message: string, title: string = '成功'): Promise<void> {
    return this.show({ title, message, type: 'success' })
  }

  // 便捷方法：显示警告提示
  warning(message: string, title: string = '警告'): Promise<void> {
    return this.show({ title, message, type: 'warning' })
  }

  // 便捷方法：显示错误提示
  error(message: string, title: string = '错误'): Promise<void> {
    return this.show({ title, message, type: 'error' })
  }

  // 兼容原生 alert 的用法
  alert(message: string): Promise<void> {
    return this.show({ message, type: 'info' })
  }
}

// 创建全局实例
const alertService = new AlertService()

// 导出服务实例
export default alertService

