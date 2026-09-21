/**
 * 个性化设置管理 Composable
 * 负责管理应用的自定义标题和副标题
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import saveManager from '../utils/SaveManager'

export function usePersonalization() {
  const customAppTitle = ref('')
  const customAppSubtitle = ref('')

  /**
   * 加载个性化设置
   */
  async function loadPersonalization() {
    try {
      const settings = await saveManager.loadSettings()
      if (settings) {
        if (settings.customAppTitle) {
          customAppTitle.value = settings.customAppTitle
        }
        if (settings.customAppSubtitle) {
          customAppSubtitle.value = settings.customAppSubtitle
        }
      }
    } catch (error) {
      console.warn('加载个性化设置失败:', error)
    }
  }

  /**
   * 更新自定义标题
   */
  function updateTitle(title: string) {
    customAppTitle.value = title
  }

  /**
   * 更新自定义副标题
   */
  function updateSubtitle(subtitle: string) {
    customAppSubtitle.value = subtitle
  }

  /**
   * 初始化个性化设置事件监听
   */
  function initPersonalizationListener() {
    const handleTitleChanged = (event: CustomEvent) => {
      const { title } = event.detail
      customAppTitle.value = title || ''
    }

    const handleSubtitleChanged = (event: CustomEvent) => {
      const { subtitle } = event.detail
      customAppSubtitle.value = subtitle || ''
    }

    window.addEventListener('custom-app-title-changed', handleTitleChanged as EventListener)
    window.addEventListener('custom-app-subtitle-changed', handleSubtitleChanged as EventListener)

    // 返回清理函数
    return () => {
      window.removeEventListener('custom-app-title-changed', handleTitleChanged as EventListener)
      window.removeEventListener('custom-app-subtitle-changed', handleSubtitleChanged as EventListener)
    }
  }

  return {
    customAppTitle,
    customAppSubtitle,
    loadPersonalization,
    updateTitle,
    updateSubtitle,
    initPersonalizationListener
  }
}

