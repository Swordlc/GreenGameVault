<template>
  <div class="pages-section" v-if="pages.length > 0">
    <!-- 分页导航 - 使用 FunPagination 组件 -->
    <FunPagination
      v-if="totalPages > 1"
      :currentPage="currentPage"
      :totalPages="totalPages"
      :pageSize="pageSize"
      :totalItems="pages.length"
      itemType="张"
      @page-change="handlePageChange"
    />
    
    <!-- 图片网格 - 使用 FunGrid 组件 -->
    <FunGrid
      mode="auto-fill"
      :minWidth="150"
      gap="var(--spacing-md, 16px)"
      padding="16px 0"
      :singleColumnOnMobile="true"
    >
      <div 
        v-for="(page, idx) in paginatedPages" 
        :key="page" 
        class="page-item" 
        @click="handlePageClick(idx)"
      >
        <img 
          :src="resolveImage(page)" 
          :alt="'Page ' + (currentPageStartIndex + idx + 1)" 
          @error="handleImageError"
          loading="lazy"
          class="preview-thumbnail"
        >
        <div class="page-index">{{ currentPageStartIndex + idx + 1 }}</div>
      </div>
    </FunGrid>
  </div>
</template>

<script lang="ts">
/**
 * ⚠️ 保留说明（GreenGameVault）：
 * 本组件位于 components/image/ 下，但**不是「图片/漫画资源类型」的遗留**。
 * 它服务于【游戏详情页的截图浏览】：
 *   Game 在 src/configs/resources/game.ts 中配置 previewArea: 'useScreenshotFolder'，
 *   GenericResourceView.vue 的 <DetailPanel> #extra 插槽用本组件渲染
 *   SaveData/Game/Screenshots/<ID>_<名字>/ 下的历史截图。
 * 请勿删除。
 */
import { computed, type PropType } from 'vue'
import FunPagination from '../../fun-ui/navigation/Pagination/FunPagination.vue'
import FunGrid from '../../fun-ui/layout/Grid/FunGrid.vue'

export default {
  name: 'AlbumPagesGrid',
  components: {
    FunPagination,
    FunGrid
  },
  props: {
    pages: {
      type: Array as PropType<string[]>,
      required: true
    },
    currentPage: {
      type: Number,
      required: true
    },
    pageSize: {
      type: Number,
      required: true
    },
    totalPages: {
      type: Number,
      required: true
    },
    resolveImage: {
      type: Function as PropType<(path: string) => string>,
      required: true
    },
    handleImageError: {
      type: Function as PropType<(event: Event) => void>,
      required: true
    }
  },
  emits: ['page-click', 'page-change'],
  setup(props, { emit }) {
    const currentPageStartIndex = computed(() => {
      return (props.currentPage - 1) * props.pageSize
    })

    const paginatedPages = computed(() => {
      if (!props.pages || props.pages.length === 0) return []
      const start = currentPageStartIndex.value
      const end = start + props.pageSize
      return props.pages.slice(start, end)
    })

    const handlePageClick = (index: number) => {
      emit('page-click', index)
    }

    const handlePageChange = (page: number) => {
      emit('page-change', page)
    }

    return {
      currentPageStartIndex,
      paginatedPages,
      handlePageClick,
      handlePageChange
    }
  }
}
</script>

<style scoped>
.pages-section {
  margin-top: 20px;
}

.page-item {
  position: relative;
  aspect-ratio: 2 / 3;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.2s;
  background: var(--bg-secondary, #f5f5f5);
}

.page-item:hover {
  border-color: var(--primary-color, #007bff);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.preview-thumbnail {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.page-index {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.7), transparent);
  color: white;
  padding: 8px;
  font-size: 12px;
  font-weight: 500;
  text-align: center;
}
</style>

