import { ref, onUnmounted } from 'vue'

/**
 * Tag 选择面板的 composable
 * 提供统一的显示/隐藏逻辑和事件处理
 */
export function useTagPanel() {
  const showTagPanel = ref(false)
  const tagPanelHideTimeout = ref<ReturnType<typeof setTimeout> | null>(null)
  const isTagPanelHovered = ref(false)

  /**
   * 处理标签输入框获得焦点
   */
  const handleTagInputFocus = () => {
    if (tagPanelHideTimeout.value) {
      clearTimeout(tagPanelHideTimeout.value)
      tagPanelHideTimeout.value = null
    }
    showTagPanel.value = true
  }

  /**
   * 处理标签输入框失去焦点
   */
  const handleTagInputBlur = () => {
    tagPanelHideTimeout.value = setTimeout(() => {
      if (!isTagPanelHovered.value) {
        showTagPanel.value = false
      }
    }, 200)
  }

  /**
   * 处理鼠标进入面板
   */
  const handleTagPanelMouseEnter = () => {
    isTagPanelHovered.value = true
    if (tagPanelHideTimeout.value) {
      clearTimeout(tagPanelHideTimeout.value)
      tagPanelHideTimeout.value = null
    }
  }

  /**
   * 处理鼠标离开面板
   */
  const handleTagPanelMouseLeave = () => {
    isTagPanelHovered.value = false
    tagPanelHideTimeout.value = setTimeout(() => {
      showTagPanel.value = false
    }, 200)
  }

  /**
   * 手动关闭面板
   */
  const closeTagPanel = () => {
    if (tagPanelHideTimeout.value) {
      clearTimeout(tagPanelHideTimeout.value)
      tagPanelHideTimeout.value = null
    }
    showTagPanel.value = false
    isTagPanelHovered.value = false
  }

  // 组件卸载时清理定时器
  onUnmounted(() => {
    if (tagPanelHideTimeout.value) {
      clearTimeout(tagPanelHideTimeout.value)
    }
  })

  return {
    showTagPanel,
    handleTagInputFocus,
    handleTagInputBlur,
    handleTagPanelMouseEnter,
    handleTagPanelMouseLeave,
    closeTagPanel
  }
}

