/**
 * 通用资源拖拽处理 Composable
 * 抽象所有资源页面的拖拽逻辑
 */
import { ref, type Ref } from 'vue'
import notify from '../utils/NotificationService'

export interface DragDropConfig<T> {
  items: Ref<T[]>
  isDragOver: Ref<boolean>
  onAddItem: (itemData: any) => Promise<any>
  onShowPathUpdateDialog?: (info: any) => void
  onReloadData?: () => Promise<void>
  extractNameFromPath?: (filePath: string) => string
  supportedExtensions?: string[]
  dragOverMessage?: string
}

/**
 * 通用资源拖拽处理
 */
export function useResourceDragDrop<T>(config: DragDropConfig<T>) {
  const {
    items,
    isDragOver,
    onAddItem,
    onShowPathUpdateDialog,
    onReloadData,
    extractNameFromPath = (path: string) => {
      if (!path) return ''
      const normalized = path.replace(/\\/g, '/')
      const filename = normalized.substring(normalized.lastIndexOf('/') + 1)
      const dotIndex = filename.lastIndexOf('.')
      return dotIndex > 0 ? filename.substring(0, dotIndex) : filename
    },
    supportedExtensions = [],
    dragOverMessage = '拖拽文件到这里添加（支持多选）'
  } = config

  /**
   * 处理拖拽悬停
   */
  const handleDragOver = (event: DragEvent) => {
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy'
    }
    if (!isDragOver.value) {
      isDragOver.value = true
    }
  }

  /**
   * 处理拖拽进入
   */
  const handleDragEnter = (event: DragEvent) => {
    event.preventDefault()
    isDragOver.value = true
  }

  /**
   * 处理拖拽离开
   */
  const handleDragLeave = (event: DragEvent) => {
    event.preventDefault()
    const relatedTarget = event.relatedTarget as Node
    if (!event.currentTarget.contains(relatedTarget)) {
      isDragOver.value = false
    }
  }

  /**
   * 处理文件拖放
   */
  const handleDrop = async (event: DragEvent) => {
    event.preventDefault()
    isDragOver.value = false

    try {
      const files = Array.from(event.dataTransfer?.files || []) as File[]

      if (files.length === 0) {
        notify.toast('error', '拖拽失败', '请拖拽文件到此处')
        return
      }

      // 如果指定了支持的文件扩展名，进行过滤
      let validFiles = files
      if (supportedExtensions.length > 0) {
        validFiles = files.filter(file => {
          const fileName = file.name.toLowerCase()
          return supportedExtensions.some(ext => fileName.endsWith(ext.toLowerCase()))
        })

        if (validFiles.length === 0) {
          const extensionsText = supportedExtensions.join('、')
          notify.toast('error', '文件类型不支持', `请拖拽 ${extensionsText} 格式的文件`)
          return
        }
      }

      let addedCount = 0
      let failedCount = 0
      const failedReasons: string[] = []

      // 处理每个文件
      for (const file of validFiles) {
        try {
          const filePath = (file as any).path || file.name

          // 检查是否已存在相同路径的文件
          const existingItem = items.value.find((item: any) => {
            const itemPath = item.filePath || item.folderPath || item.executablePath
            return itemPath === filePath
          })

          if (existingItem) {
            failedReasons.push(`"${file.name}" 已存在于库中`)
            failedCount++
            continue
          }

          // 检查是否存在同名但路径不同的丢失文件
          const fileName = extractNameFromPath(filePath)
          const existingItemByName = items.value.find((item: any) => {
            const itemPath = item.filePath || item.folderPath || item.executablePath
            const itemFileName = extractNameFromPath(itemPath)
            const isSameName = itemFileName.toLowerCase() === fileName.toLowerCase()
            const isFileMissing = item.fileExists === false || item.fileExists === undefined

            return isSameName && isFileMissing
          })

          if (existingItemByName && onShowPathUpdateDialog) {
            // 显示路径更新确认对话框
            onShowPathUpdateDialog({
              existingItem: existingItemByName,
              newPath: filePath,
              newFileName: file.name
            })
            // 暂停处理，等待用户确认
            return
          }

          // 创建新的资源对象
          const itemData = {
            name: fileName,
            filePath: filePath,
            // 其他默认字段可以根据需要添加
          }

          // 添加到资源管理器
          await onAddItem(itemData)
          addedCount++

        } catch (error: any) {
          console.error(`添加文件失败: ${file.name}`, error)
          failedReasons.push(`"${file.name}" 添加失败: ${error.message}`)
          failedCount++
        }
      }

      // 重新加载数据
      if (onReloadData) {
        await onReloadData()
      }

      // 显示结果通知
      if (addedCount > 0 && failedCount === 0) {
        notify.toast('success', '添加成功', `成功添加 ${addedCount} 个项目`)
      } else if (addedCount > 0 && failedCount > 0) {
        notify.toast('warning', '部分成功', `成功添加 ${addedCount} 个项目，${failedCount} 个文件添加失败：${failedReasons.join('；')}`)
      } else if (addedCount === 0 && failedCount > 0) {
        notify.toast('error', '添加失败', `${failedCount} 个文件添加失败：${failedReasons.join('；')}`)
      }

      console.log(`拖拽处理完成: 成功 ${addedCount} 个，失败 ${failedCount} 个`)

    } catch (error: any) {
      console.error('处理拖拽文件失败:', error)
      notify.toast('error', '处理失败', `处理拖拽文件失败: ${error.message}`)
    }
  }

  return {
    isDragOver,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop
  }
}
