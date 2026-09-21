/**
 * 详情页图片分页管理 Composable
 * 处理详情页中图片列表的分页逻辑
 *
 * ⚠️ 保留说明（GreenGameVault）：
 * 本文件位于 image/ 目录下，但**不是「图片资源类型」的遗留**。
 * 游戏详情页的【截图浏览】功能复用本文件：
 *   Game 在 src/configs/resources/game.ts 中配置 previewArea: 'useScreenshotFolder'，
 *   GenericResourceView.vue 用它为截图画廊（AlbumPagesGrid）提供分页状态。
 * 请勿删除。
 */
import { ref, computed, watch, type Ref } from 'vue'
import saveManager from '../../utils/SaveManager'

export interface ImagePagesOptions {
  /**
   * 图片页面列表
   */
  pages: Ref<string[]>
  
  /**
   * 默认每页显示数量
   */
  defaultPageSize?: number
}

/**
 * 详情页图片分页管理 composable
 */
export function useImagePages(options: ImagePagesOptions) {
  const { pages, defaultPageSize = 50 } = options

  // 分页状态
  const detailCurrentPage = ref(1)
  const detailPageSize = ref(defaultPageSize)
  const detailTotalPages = ref(0)
  const jumpToPageInput = ref(1)

  /**
   * 计算总页数
   */
  const updateTotalPages = () => {
    if (pages.value && pages.value.length > 0) {
      detailTotalPages.value = Math.ceil(pages.value.length / detailPageSize.value)
      // 确保当前页不超过总页数
      if (detailCurrentPage.value > detailTotalPages.value) {
        detailCurrentPage.value = Math.max(1, detailTotalPages.value)
      }
    } else {
      detailTotalPages.value = 0
    }
  }

  // 监听 pages 变化，更新总页数
  watch(pages, () => {
    updateTotalPages()
  }, { immediate: true })

  /**
   * 当前页的图片列表
   */
  const paginatedPages = computed(() => {
    if (!pages.value || pages.value.length === 0) return []
    const start = (detailCurrentPage.value - 1) * detailPageSize.value
    const end = start + detailPageSize.value
    return pages.value.slice(start, end)
  })

  /**
   * 当前页的起始索引
   */
  const detailCurrentPageStartIndex = computed(() => {
    return (detailCurrentPage.value - 1) * detailPageSize.value
  })

  /**
   * 下一页
   */
  function nextPageGroup() {
    if (detailCurrentPage.value < detailTotalPages.value) {
      detailCurrentPage.value++
      jumpToPageInput.value = detailCurrentPage.value
    }
  }

  /**
   * 上一页
   */
  function previousPageGroup() {
    if (detailCurrentPage.value > 1) {
      detailCurrentPage.value--
      jumpToPageInput.value = detailCurrentPage.value
    }
  }

  /**
   * 跳转到指定页
   */
  function jumpToPageGroup(pageNum: number) {
    if (pageNum >= 1 && pageNum <= detailTotalPages.value) {
      detailCurrentPage.value = pageNum
      jumpToPageInput.value = pageNum
    }
  }

  /**
   * 重置分页状态
   */
  function resetPagination() {
    detailCurrentPage.value = 1
    detailTotalPages.value = 0
    jumpToPageInput.value = 1
  }

  /**
   * 更新页面大小
   */
  function updatePageSize(newPageSize: number) {
    if (detailPageSize.value !== newPageSize) {
      detailPageSize.value = newPageSize
      updateTotalPages()
    }
  }

  /**
   * 从设置中加载分页配置
   */
  async function loadImageSettings() {
    try {
      const settings = await saveManager.loadSettings()
      
      if (settings && settings.image) {
        const newPageSize = parseInt(settings.image.detailPageSize as string) || defaultPageSize
        
        if (detailPageSize.value !== newPageSize) {
          updatePageSize(newPageSize)
          
          console.log('图片分页设置已更新:', {
            detailPageSize: detailPageSize.value,
            totalPages: detailTotalPages.value,
            currentPage: detailCurrentPage.value
          })
        }
      }
    } catch (error) {
      console.error('加载图片分页设置失败:', error)
      // 使用默认值
      detailPageSize.value = defaultPageSize
      updateTotalPages()
    }
  }

  return {
    // 状态
    detailCurrentPage,
    detailPageSize,
    detailTotalPages,
    jumpToPageInput,
    
    // 计算属性
    paginatedPages,
    detailCurrentPageStartIndex,
    
    // 方法
    nextPageGroup,
    previousPageGroup,
    jumpToPageGroup,
    resetPagination,
    updatePageSize,
    updateTotalPages,
    loadImageSettings
  }
}

