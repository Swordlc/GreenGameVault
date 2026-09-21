/**
 * 资源评分和收藏统一管理 Composable
 * 为所有资源类型提供统一的评分、评论和收藏功能
 */
import { ref } from 'vue'

export interface ResourceUpdateFunction {
  (id: string, updates: { rating?: number; comment?: string; isFavorite?: boolean }): Promise<void>
}

/**
 * 创建资源评分和收藏处理函数
 * @param updateFn - 更新资源的函数
 * @param selectedItemRef - 当前选中的资源项引用（用于立即更新UI）
 */
export function useResourceRating(
  updateFn: ResourceUpdateFunction,
  selectedItemRef?: { value: any } | null
) {
  /**
   * 更新评分
   */
  const handleUpdateRating = async (rating: number, item: any) => {
    if (!item || !item.id) {
      return
    }
    try {
      await updateFn(item.id, { rating })
      // 立即更新UI
      if (selectedItemRef?.value && selectedItemRef.value.id === item.id) {
        selectedItemRef.value.rating = rating
      }
    } catch (error: any) {
      console.error('更新评分失败:', error)
      throw error
    }
  }

  /**
   * 更新评论
   */
  const handleUpdateComment = async (comment: string, item: any) => {
    if (!item || !item.id) {
      return
    }
    try {
      await updateFn(item.id, { comment })
      // 立即更新UI
      if (selectedItemRef?.value && selectedItemRef.value.id === item.id) {
        selectedItemRef.value.comment = comment
      }
    } catch (error: any) {
      console.error('更新评论失败:', error)
      throw error
    }
  }

  /**
   * 切换收藏状态
   */
  const handleToggleFavorite = async (item: any) => {
    if (!item || !item.id) {
      return
    }
    try {
      const newFavoriteStatus = !item.isFavorite
      await updateFn(item.id, { isFavorite: newFavoriteStatus })
      // 立即更新UI
      if (selectedItemRef?.value && selectedItemRef.value.id === item.id) {
        selectedItemRef.value.isFavorite = newFavoriteStatus
      }
    } catch (error: any) {
      console.error('切换收藏状态失败:', error)
      throw error
    }
  }

  return {
    handleUpdateRating,
    handleUpdateComment,
    handleToggleFavorite
  }
}

