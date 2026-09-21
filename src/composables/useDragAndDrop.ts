import { ref } from 'vue'

export interface DragDropOptions {
  /**
   * 文件拖拽后的处理函数
   * @param files - 拖拽的文件列表
   */
  onDrop?: (files: File[]) => Promise<void> | void
  
  /**
   * 允许的文件扩展名（如 ['.exe', '.app']）
   * 如果为空，则接受所有文件
   */
  acceptedExtensions?: string[]
  
  /**
   * 是否启用拖拽功能
   */
  enabled?: boolean
}

/**
 * 通用拖拽处理 composable
 * 提供拖拽相关的状态和事件处理函数
 */
export function useDragAndDrop(options: DragDropOptions = {}) {
  const {
    onDrop,
    acceptedExtensions = [],
    enabled = true
  } = options

  // 拖拽状态
  const isDragOver = ref(false)

  /**
   * 检查文件是否符合要求
   */
  function isValidFile(file: File): boolean {
    if (acceptedExtensions.length === 0) {
      return true // 没有限制，接受所有文件
    }

    const fileName = file.name.toLowerCase()
    return acceptedExtensions.some(ext => fileName.endsWith(ext.toLowerCase()))
  }

  /**
   * 处理 dragover 事件
   */
  function handleDragOver(event: DragEvent) {
    if (!enabled) return
    
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy'
    }
  }

  /**
   * 处理 dragenter 事件
   */
  function handleDragEnter(event: DragEvent) {
    if (!enabled) return
    
    event.preventDefault()
    // 防止子元素触发 dragenter 时重复设置状态
    if (!isDragOver.value) {
      isDragOver.value = true
    }
  }

  /**
   * 处理 dragleave 事件
   */
  function handleDragLeave(event: DragEvent) {
    if (!enabled) return
    
    event.preventDefault()
    // 只有当离开整个拖拽区域时才取消高亮
    // 检查 relatedTarget 是否存在且不在当前元素内
    if (!event.relatedTarget || !(event.currentTarget as Element).contains(event.relatedTarget as Node)) {
      isDragOver.value = false
    }
  }

  /**
   * 处理 drop 事件
   */
  async function handleDrop(event: DragEvent) {
    if (!enabled || !onDrop) return
    
    event.preventDefault()
    isDragOver.value = false

    try {
      const files = Array.from(event.dataTransfer?.files || []) as File[]

      if (files.length === 0) {
        return
      }

      // 如果指定了文件类型限制，进行筛选
      const validFiles = acceptedExtensions.length > 0
        ? files.filter(file => isValidFile(file))
        : files

      if (validFiles.length === 0 && acceptedExtensions.length > 0) {
        // 有文件类型限制但没有有效文件
        return
      }

      // 调用处理函数
      await onDrop(validFiles)
    } catch (error) {
      console.error('拖拽处理失败:', error)
      throw error
    }
  }

  return {
    // 状态
    isDragOver,
    
    // 事件处理函数
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop
  }
}

