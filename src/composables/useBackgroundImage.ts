/**
 * 背景图片管理 Composable
 * 负责管理应用背景图片的加载和显示
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import saveManager from '../utils/SaveManager'

export function useBackgroundImage() {
  const backgroundImagePath = ref('')
  const backgroundImageUrl = ref('')

  /**
   * 页面内容区域的样式（包含背景图片）
   */
  const pageContentStyle = computed(() => {
    const style: Record<string, string> = {}
    if (backgroundImageUrl.value) {
      style['--bg-image-url'] = `url(${backgroundImageUrl.value})`
    }
    return style
  })

  /**
   * 应用背景图片
   */
  async function applyBackgroundImage(imagePath: string) {
    try {
      backgroundImagePath.value = imagePath
      
      // 使用 readFileAsDataUrl 或 getFileUrl 获取图片URL
      if (window.electronAPI && window.electronAPI.readFileAsDataUrl) {
        const dataUrl = await window.electronAPI.readFileAsDataUrl(imagePath)
        if (dataUrl) {
          backgroundImageUrl.value = dataUrl
          console.log('背景图片已应用:', imagePath)
          return
        }
      }
      
      // 降级到 getFileUrl
      if (window.electronAPI && window.electronAPI.getFileUrl) {
        const result = await window.electronAPI.getFileUrl(imagePath)
        if (result && result.success && result.url) {
          backgroundImageUrl.value = result.url
          console.log('背景图片已应用（通过getFileUrl）:', imagePath)
          return
        }
      }
      
      // 如果都失败了，尝试直接使用路径（可能不工作，但至少不会报错）
      console.warn('无法获取背景图片URL，尝试使用原始路径:', imagePath)
      backgroundImageUrl.value = imagePath
    } catch (error) {
      console.error('应用背景图片失败:', error)
      backgroundImageUrl.value = ''
    }
  }

  /**
   * 清除背景图片
   */
  function clearBackgroundImage() {
    backgroundImagePath.value = ''
    backgroundImageUrl.value = ''
  }

  /**
   * 加载背景图片设置
   */
  async function loadBackgroundImage() {
    try {
      const settings = await saveManager.loadSettings()
      if (settings?.backgroundImagePath) {
        await applyBackgroundImage(settings.backgroundImagePath)
      }
    } catch (error) {
      console.warn('加载背景图片设置失败:', error)
    }
  }

  /**
   * 初始化背景图片事件监听
   */
  function initBackgroundImageListener() {
    const handleBackgroundImageChanged = async (event: CustomEvent) => {
      const { path } = event.detail
      backgroundImagePath.value = path || ''
      if (path) {
        await applyBackgroundImage(path)
      } else {
        backgroundImageUrl.value = ''
      }
    }

    window.addEventListener('background-image-changed', handleBackgroundImageChanged as EventListener)

    // 返回清理函数
    return () => {
      window.removeEventListener('background-image-changed', handleBackgroundImageChanged as EventListener)
    }
  }

  return {
    backgroundImagePath,
    backgroundImageUrl,
    pageContentStyle,
    applyBackgroundImage,
    clearBackgroundImage,
    loadBackgroundImage,
    initBackgroundImageListener
  }
}

