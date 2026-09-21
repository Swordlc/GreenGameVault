/**
 * 帮助页面工具函数
 */
export function useHelpUtils() {
  /**
   * 打开外部链接
   */
  async function openExternalLink(url: string) {
    try {
      if (window.electronAPI && window.electronAPI.openExternal) {
        const result = await window.electronAPI.openExternal(url)
        if (!result.success) {
          console.error('打开外部链接失败:', result.error)
          // 降级到使用 window.open
          window.open(url, '_blank')
        }
      } else {
        // 如果 Electron API 不可用，降级到使用 window.open
        window.open(url, '_blank')
      }
    } catch (error) {
      console.error('打开外部链接出错:', error)
      // 降级到使用 window.open
      window.open(url, '_blank')
    }
  }

  /**
   * 复制到剪贴板
   */
  async function copyToClipboard(text: string) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
        console.log('已复制到剪贴板:', text)
      } else {
        // 降级方案：使用传统的复制方法
        const textArea = document.createElement('textarea')
        textArea.value = text
        textArea.style.position = 'fixed'
        textArea.style.opacity = '0'
        document.body.appendChild(textArea)
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
        console.log('已复制到剪贴板:', text)
      }
    } catch (error) {
      console.error('复制到剪贴板失败:', error)
    }
  }

  return {
    openExternalLink,
    copyToClipboard
  }
}

