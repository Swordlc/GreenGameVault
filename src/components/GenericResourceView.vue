<template>
  <div class="generic-resource-view">
    <BaseView 
      ref="baseView" 
      :items="items" 
      :filtered-items="filteredItems" 
      :empty-state-config="emptyStateConfig"
      :empty-state-override="emptyStateOverride"
      :toolbar-config="toolbarConfig" 
      :context-menu-items="contextMenuItems"
      :pagination-config="paginationConfig" 
      :sort-by="sortBy" 
      :search-query="searchQuery"
      :scale="scale" 
      :show-layout-control="true"
      :is-multi-select-mode="isMultiSelectMode"
      @update:scale="updateScale"
      @empty-state-action="handleEmptyStateAction" 
      @add-item="showAddDialogHandler" 
      @button-click="handleButtonClick"
      @sort-changed="handleSortChanged"
      @search-query-changed="handleSearchQueryChanged" 
      @sort-by-changed="handleSortByChanged"
      @context-menu-click="handleContextMenuClick" 
      @page-change="handlePageChange"
      @toggle-multi-select="toggleMultiSelectMode">
      
    <!-- 主内容区域 -->
    <!-- 直接使用 div + useDragAndDrop，避免 FunDropZone 组件的性能问题 -->
    <div 
      class="resource-content"
      :class="{ 'drag-over': isDragOver }"
      @drop="handleDragDrop"
      @dragover="handleDragOver"
      @dragenter="handleDragEnter"
      @dragleave="handleDragLeave"
    >
      <!-- ===== 视频页专属：面包屑 + 绑定目录状态 ===== -->
      <div v-if="isVideoPage" class="video-path-bar">
        <!-- 正常浏览：全部 › 根目录 › 子目录… -->
        <div v-if="!isRecycleBinMode" class="video-breadcrumb">
          <span class="video-crumb-home">🗂️</span>
          <template v-for="(crumb, index) in videoBreadcrumb" :key="`${crumb.root || 'all'}|${crumb.rel}`">
            <span
              class="video-crumb"
              :class="{ 'is-current': index === videoBreadcrumb.length - 1 }"
              :title="crumb.label"
              @click="handleBreadcrumbClick(crumb)"
            >{{ crumb.label }}</span>
            <span v-if="index < videoBreadcrumb.length - 1" class="video-crumb-sep">›</span>
          </template>
        </div>

        <!-- 回收站：丢失的文件 › 原目录 › … -->
        <div v-else class="video-breadcrumb is-recycle">
          <span class="video-crumb-home">♻️</span>
          <span
            class="video-crumb"
            :class="{ 'is-current': !videoRecycleRel }"
            title="丢失的文件：只放磁盘上已经找不到的记录"
            @click="handleRecycleCrumb({ rel: '' })"
          >丢失的文件</span>
          <template v-for="(crumb, index) in recycleBreadcrumb" :key="crumb.rel">
            <span class="video-crumb-sep">›</span>
            <span
              class="video-crumb"
              :class="{ 'is-current': index === recycleBreadcrumb.length - 1 }"
              :title="crumb.label"
              @click="handleRecycleCrumb(crumb)"
            >{{ crumb.label }}</span>
          </template>
          <span class="video-recycle-count">共 {{ missingVideoCount }} 个丢失文件</span>
        </div>

        <div class="video-path-actions">
          <span v-if="videoIsScanning" class="video-status is-scanning">扫描中…</span>
          <span v-else-if="videoHasRoots && !videoWatcherHealthy" class="video-status is-warn" title="目录监听不可用，请用「重新扫描」手动刷新">
            实时更新不可用
          </span>
          <span
            v-else-if="videoHasRoots && !videoFfmpegAvailable"
            class="video-status is-hint"
            title="没有检测到 ffmpeg：抽帧封面将回退到浏览器解码，MKV/HEVC 等格式可能失败"
          >未检测到 FFmpeg</span>
          <button
            v-if="videoHasRoots"
            class="video-mini-btn"
            :class="{ 'is-off': !showFolderCards }"
            :title="showFolderCards ? '当前会显示文件夹卡片，点击隐藏' : '当前隐藏了文件夹卡片，点击显示'"
            @click="toggleShowFolderCards"
          >{{ showFolderCards ? '📁 文件夹' : '📁 文件夹（已隐藏）' }}</button>
          <button
            v-if="isRecycleBinMode ? !!videoRecycleRel : videoBreadcrumb.length > 1"
            class="video-mini-btn"
            @click="handleGoUp"
          >⬆ 上一级</button>
          <button
            v-if="isRecycleBinMode && missingVideoCount > 0"
            class="video-mini-btn is-danger"
            :title="`把当前范围里的 ${missingVideoCount} 条丢失记录从库中移除（磁盘上的文件不会动）`"
            @click="handleClearRecycleBin"
          >🧹 清空回收站</button>
          <button class="video-mini-btn" @click="handleRescanVideoLibrary">🔄 重新扫描</button>
        </div>
      </div>

      <!-- 使用 FunGrid 组件进行布局 -->
      <FunGrid
        v-if="paginatedItems.length > 0 || (isVideoPage && visibleFolderCards.length > 0)"
        mode="auto-fill"
        :scale="scale"
        :baseWidth="displayLayoutBaseWidth"
        :minScaledWidth="displayLayoutMinWidth"
        :maxScaledWidth="displayLayoutMaxWidth"
        gap="20px"
        padding="10px 20px"
        :singleColumnOnMobile="true"
        :customStyle="customLayoutStyle"
        :class="{ 'is-dragging': isDragOver }"
      >
        <!-- 文件夹卡片（视频页专属：单击进入子层级；标签并集用于筛选下的可见性）
             回收站里的 kind === 'missing' 卡片代表"磁盘上已经找不到的原目录"，
             右键它可以把整个文件夹（含里面全部文件）重新关联到新位置。 -->
        <div
          v-for="folder in (isVideoPage ? visibleFolderCards : [])"
          :key="folder.key"
          class="video-folder-card"
          :class="{ 'is-root': folder.kind === 'root', 'is-missing': folder.kind === 'missing' }"
          :title="folderCardTitle(folder)"
          @click="handleFolderClick(folder)"
          @contextmenu.prevent="handleFolderContextMenu($event, folder)"
        >
          <button
            v-if="folder.kind === 'root'"
            class="folder-unbind"
            title="解除绑定（不会删除记录与标签）"
            @click.stop="handleUnbindRoot(folder)"
          >✕</button>
          <div class="folder-icon">{{ folder.kind === 'root' ? '📂' : (folder.kind === 'missing' ? '🗑️' : '📁') }}</div>
          <div class="folder-name">{{ folder.name }}</div>
          <div v-if="folder.tags && folder.tags.length > 0" class="folder-tags">
            <span v-for="tag in folder.tags.slice(0, 3)" :key="tag" class="folder-tag">{{ tag }}</span>
            <span v-if="folder.tags.length > 3" class="folder-tag-more">+{{ folder.tags.length - 3 }}</span>
          </div>
          <div class="folder-meta">
            <span v-if="folder.kind === 'missing'">{{ folder.count }} 个丢失文件</span>
            <span v-else>{{ folder.count }} 个视频</span>
            <button
              v-if="folder.kind !== 'missing'"
              class="folder-open"
              title="在资源管理器中打开"
              @click.stop="handleOpenFolderInExplorer(folder)"
            >↗</button>
            <span v-else class="folder-hint" title="右键这张卡片 → 整个文件夹重新关联到…">右键重连</span>
          </div>
        </div>

        <MediaCard
          v-for="item in paginatedItems"
          :key="item.id?.value || item.id"
          :item="item"
          :type="(resourceType || 'game').toLowerCase()"
          :is-electron-environment="isElectronEnvironment"
          :file-exists="getFileExists(item)"
          :scale="scale"
          :is-running="isResourceRunning(item)"
          :is-multi-select-mode="isMultiSelectMode"
          :is-selected="isItemSelected(item)"
          @click="() => (this as any).showDetail(item)"
          @contextmenu.prevent="handleContextMenu($event, item)"
          @action="handleCardAction"
          @toggle-select="() => toggleSelectItem(item)"
        />
      </FunGrid>
      <div v-else class="empty-grid" :class="{ 'is-dragging': isDragOver }"></div>
    </div>
    </BaseView>
    
    <!-- 详情面板 -->
    <DetailPanel
      :visible="showDetailDialog && !!selectedItem"
      :item="selectedItem"
      :type="detailPanelType"
      :is-running="selectedItem ? isResourceRunning(selectedItem) : false"
      :on-update-resource="updateResource"
      @close="closeDetail"
      @action="handleDetailAction"
    >
      <!--
        预览区（#extra 插槽）：
        Game 类型的 game.ts 配置了 previewArea: 'useScreenshotFolder'，
        因此这里渲染的是【游戏截图目录 Game/Screenshots/<ID>_<名字>/ 的图片列表】。
        AlbumPagesGrid 虽然位于 components/image/ 下，但为游戏截图浏览功能所必需，请勿删除。
      -->
      <template #extra>
        <AlbumPagesGrid
          v-if="shouldShowPreview"
          :pages="detailPages"
          :currentPage="detailCurrentPage"
          :pageSize="detailPageSize"
          :totalPages="detailTotalPages"
          :resolveImage="resolveImage"
          :handleImageError="handleImageError"
          @page-click="handleDetailPageClick"
          @page-change="handleDetailPageChange"
        />
      </template>
    </DetailPanel>

    <!-- 回收站里文件夹卡片的右键菜单（整夹重新关联到…） -->
    <fun-context-menu
      :visible="folderMenuVisible"
      :position="folderMenuPosition"
      :menu-items="folderMenuItems"
      @item-click="handleFolderMenuItemClick"
    />
    
    <!-- 添加资源对话框 -->
    <ResourcesEditDialog
      :visible="showAddDialog"
      mode="add"
      :resource-class="ResourceClass"
      :is-electron-environment="isElectronEnvironment"
      :available-tags="allTags"
      :available-tags-by-field="availableTagsByField"
      :enable-engine-auto-detect="dialogConfig.enableEngineAutoDetect"
      :enable-screenshot-cover="dialogConfig.enableScreenshotCover"
      :enable-randomize-thumbnail="dialogConfig.enableRandomizeThumbnail"
      :add-title="dialogConfig.addTitle"
      :edit-title="dialogConfig.editTitle"
      :add-button-text="dialogConfig.addButtonText"
      :edit-button-text="dialogConfig.editButtonText"
      @close="closeAddDialog"
      @confirm="handleAddConfirm"
    />
    
    <!-- 编辑资源对话框 -->
    <ResourcesEditDialog
      :visible="showEditDialog"
      mode="edit"
      :resource-class="ResourceClass"
      :resource-data="editForm"
      :is-electron-environment="isElectronEnvironment"
      :available-tags="allTags"
      :available-tags-by-field="availableTagsByField"
      :enable-engine-auto-detect="dialogConfig.enableEngineAutoDetect"
      :enable-screenshot-cover="dialogConfig.enableScreenshotCover"
      :enable-randomize-thumbnail="dialogConfig.enableRandomizeThumbnail"
      :add-title="dialogConfig.addTitle"
      :edit-title="dialogConfig.editTitle"
      :add-button-text="dialogConfig.addButtonText"
      :edit-button-text="dialogConfig.editButtonText"
      @close="closeEdit"
      @confirm="handleEditConfirm"
    />
    
    <!-- 路径更新确认对话框 -->
    <PathUpdateDialog
      :visible="showPathUpdateDialog"
      :title="pathUpdateDialogTitle"
      :description="pathUpdateDialogDescription"
      :item-name-label="pathUpdateItemNameLabel"
      :item-name="pathUpdateItemName"
      :old-path="pathUpdateOldPath"
      :new-path="pathUpdateNewPath"
      :missing-label="pathUpdateMissingLabel"
      :found-label="pathUpdateFoundLabel"
      :question="pathUpdateQuestion"
      @confirm="confirmPathUpdate"
      @cancel="closePathUpdateDialog"
    />

    <!-- 批量增加tag对话框 -->
    <BatchAddTagDialog
      :visible="showBatchAddTagDialog"
      @close="closeBatchAddTagDialog"
      @confirm="handleBatchAddTagConfirm"
    />

    <!-- 批量删除tag对话框 -->
    <BatchDeleteTagDialog
      :visible="showBatchDeleteTagDialog"
      @close="closeBatchDeleteTagDialog"
      @confirm="handleBatchDeleteTagConfirm"
    />

    <!-- 批量删除确认对话框 -->
    <BatchDeleteConfirmDialog
      :visible="showBatchDeleteConfirmDialog"
      :count="selectedItems.size"
      @close="closeBatchDeleteConfirmDialog"
      @confirm="handleBatchDeleteConfirm"
    />
    
    <!-- 强制结束程序确认对话框 -->
    <div v-if="showTerminateConfirmDialog" class="modal-overlay" @click="closeTerminateConfirmDialog">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h3>强制结束程序</h3>
          <button class="btn-close" @click="closeTerminateConfirmDialog">✕</button>
        </div>
        <div class="modal-body">
          <p>确定要强制结束程序 <strong>{{ terminateResourceName }}</strong> 吗？</p>
          <p style="color: var(--text-secondary); font-size: 0.9rem; margin-top: 10px;">
            此操作将立即终止程序进程，未保存的数据可能会丢失。
          </p>
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" @click="closeTerminateConfirmDialog">取消</button>
          <button class="btn-confirm" @click="confirmTerminateGame" style="background: #ef4444;">确认结束</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 批量导入对话框 -->
  <BatchImportDialog
    ref="batchImportDialogRef"
    :visible="showBatchImportDialog"
    :files="batchImportFiles"
    :folder-path="batchImportFolderPath"
    @close="closeBatchImportDialog"
    @confirm="handleBatchImportConfirm"
  />
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, onBeforeUnmount, watch, toRefs } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BaseView from './BaseView.vue'
import MediaCard from './MediaCard.vue'
import DetailPanel from './DetailPanel.vue'
import AlbumPagesGrid from './image/AlbumPagesGrid.vue'
import PathUpdateDialog from './PathUpdateDialog.vue'
import BatchImportDialog from './BatchImportDialog.vue'
import BatchAddTagDialog from './BatchAddTagDialog.vue'
import BatchDeleteTagDialog from './BatchDeleteTagDialog.vue'
import BatchDeleteConfirmDialog from './BatchDeleteConfirmDialog.vue'
import { createResourcePage } from '../composables/createResourcePage'
import FunGrid from '../fun-ui/layout/Grid/FunGrid.vue'
import { useDragAndDrop } from '../composables/useDragAndDrop'
// 资源类导入（游戏 + 视频）
import { Game } from '@resources/game.ts'
import { Video } from '@resources/video.ts'
import { pageConfigLoader, type PageConfig } from '../configs/pages/PageConfigLoader.ts'
import { executeActionHandler, getActionHandler, type ActionHandlerContext } from '../utils/ResourceActionHandlers'
import { useGameRunningStore } from '../stores/game-running'
import { BaseResources } from '@resources/base/ResourcesDataBase.ts'
import notify from '../utils/NotificationService.ts'
import confirmService from '../utils/ConfirmService.ts'
// 全局「使用最新截图作为封面」：扫描规则与编辑对话框里的单个按钮共用同一套实现
import { scanGamesMissingCover, toSaveDataRelativePath } from '../utils/ScreenshotCover.ts'
import saveManager from '../utils/SaveManager.ts'
import { calculateAndUpdateResourceSize, calculateResourceSizesBatch } from '../utils/ResourceSizeService.ts'
import { getGameScreenshotFolderPath, useGameScreenshot } from '../composables/game/useGameScreenshot'
import { useResourceFilter } from '../composables/useResourceFilter'
// 视频页专用：绑定文件夹 / 递归扫描同步 / 层级浏览 / 实时监听 / 打开次数 / 抽帧封面
import { useVideoLibrary } from '../composables/video/useVideoLibrary'
// 视频页：文件夹在标签筛选/搜索下的可见性（纯函数）
import { filterVisibleFolders, folderContainsVideo } from '../utils/videoFolderFilter'
// 视频页：丢失记录判定（「主视图只显示磁盘上真实存在的视频」用它把关）
import { isMissingItem } from '../utils/videoRelink'
// 视频页：主视图到底显示哪些视频（子树筛选池 → 收窄到当前层；纯函数）
import { filterVisibleVideoItems } from '../utils/videoVisibility'
import { collectSearchTexts, matchesFuzzy } from '../utils/fuzzySearch'
// 编辑对话框按字段名取候选，这里把「筛选器 key → 字段名」的映射补齐
import { buildTagsByField } from '../utils/filterFieldMap'
// 以下两个 image composable 服务于【游戏详情页的截图浏览】，不是图片资源类型遗留，请勿删除
import { useImagePages } from '../composables/image/useImagePages'
import { useImageCache } from '../composables/image/useImageCache'
import ResourcesEditDialog from './ResourcesEditDialog.vue'
import type { FilterItem } from '../types/filter'
import coverManager from '../utils/CoverManager.ts'

// 资源类型到资源类的映射（GreenGameVault：游戏 + 视频）
const resourceClassMap: Record<string, { resourceClass: any }> = {
  Game: {
    resourceClass: Game
  },
  Video: {
    resourceClass: Video
  }
}

export default defineComponent({
  name: 'GenericResourceView',
  components: {
    BaseView,
    MediaCard,
    DetailPanel,
    AlbumPagesGrid,
    ResourcesEditDialog,
    PathUpdateDialog,
    BatchImportDialog,
    BatchAddTagDialog,
    BatchDeleteTagDialog,
    BatchDeleteConfirmDialog,
    FunGrid
  },
  emits: ['filter-data-updated'],
  props: {
    pageConfig: {
      type: Object,
      required: false,
      default: null
    },
    resourceType: {
      type: String,
      required: false,
      default: null
    },
    items: {
      type: Array,
      default: () => []
    }
  },
  setup(props, { emit }) {
    // 主页「抓阄链路」点卡片跳过来时会带 ?gameId=xxx，需要读/清当前路由
    const route = useRoute()
    const router = useRouter()

    // 从 pageConfig 或 resourceType prop 获取资源类型
    const resourceType = computed(() => {
      return props.pageConfig?.type || props.resourceType || 'Game'
    })
    
    // 获取资源类
    const resourceConfig = resourceClassMap[resourceType.value]
    if (!resourceConfig) {
      console.error(`未找到资源类型 ${resourceType.value} 的配置`)
      return {
        items: ref([]),
        filteredItems: ref([]),
        searchQuery: ref(''),
        sortBy: ref('name-asc'),
        scale: ref(100),
        paginatedItems: ref([]),
        emptyStateConfig: {},
        toolbarConfig: {},
        contextMenuItems: [],
        paginationConfig: {},
        isElectronEnvironment: ref(false)
      }
    }

    const ResourceClass = resourceConfig.resourceClass

    // 资源类型到页面配置 ID 的映射（GreenGameVault：游戏 + 视频）
    const resourceTypeToPageIdMap: Record<string, string> = {
      Game: 'games',
      Video: 'videos'
    }

    // 是否视频页（视频页复用本组件，但有一批「只读标签管理」专属行为）
    const isVideoPage = computed(() => resourceType.value === 'Video')

    /** 路径归一化（Windows 大小写不敏感 + 反斜杠统一） */
    const pathKeyOf = (input: unknown): string =>
      String(input ?? '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

    // 获取页面配置（从 JSON 配置加载器）
    const pageConfig = computed(() => {
      const pageId = resourceTypeToPageIdMap[resourceType.value]
      if (!pageId) {
        console.error(`未找到资源类型 ${resourceType.value} 对应的页面配置 ID`)
        return undefined
      }
      const config = pageConfigLoader.getPageConfig(pageId)
      if (!config) {
        console.error(`未找到页面配置 ID ${pageId} 的配置`)
      }
      return config
    })

    // 获取对话框配置
    const dialogConfig = computed(() => {
      return pageConfig.value?.dialogConfig || {
        addTitle: '添加资源',
        editTitle: '编辑资源',
        addButtonText: '添加',
        editButtonText: '保存修改'
      }
    })

    // 当前资源类型是否使用 launchExecutable（游戏、软件等可执行程序），用于运行状态与时长追踪
    const supportsRunningTracking = computed(() =>
      ResourceClass?.actionConfig?.handlerName === 'launchExecutable'
    )

    // 响应式数据
    const items = ref<any[]>([])
    const isElectronEnvironment = ref(!!(typeof window !== 'undefined' && (window as any).electronAPI))
    const searchQuery = ref('')
    // 排序方式：每次进入页面都回到页面配置里的 defaultSortBy（游戏页＝最近游玩，正在玩的排最前）
    const sortBy = ref(pageConfig.value?.defaultSortBy || 'name-asc')
    
    // 多选模式相关
    const isMultiSelectMode = ref(false)
    const selectedItems = ref<Set<string>>(new Set())
    
    // 数据加载状态
    const isLoadingData = ref(false)
    
    // 批量导入对话框相关
    const showBatchImportDialog = ref(false)
    const batchImportFiles = ref<string[]>([])
    const batchImportFolderPath = ref<string>('')
    const batchImportDialogRef = ref<any>(null)

    // 批量增加tag对话框相关
    const showBatchAddTagDialog = ref(false)

    // 批量删除tag对话框相关
    const showBatchDeleteTagDialog = ref(false)

    // 批量删除确认对话框相关
    const showBatchDeleteConfirmDialog = ref(false)
    
    /**
     * 从文件路径提取资源名称
     */
    const extractNameFromPath = (filePath: string): string => {
      if (!filePath) return '未知资源'
      const fileName = filePath.split(/[\\/]/).pop() || ''
      const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '')
      
      let cleanName = nameWithoutExt
        .replace(/[-_\s]+/g, ' ')
        .trim()
      
      if (!cleanName) {
        cleanName = nameWithoutExt
      }
      
      return cleanName.charAt(0).toUpperCase() + cleanName.slice(1)
    }
    
    /**
     * 处理拖拽文件
     */
    const handleFileDrop = async (files: File[]) => {
      try {
        console.log('[GenericResourceView] 拖拽文件数量:', files.length)
        
        if (files.length === 0) {
          notify.toast('error', '拖拽失败', '请拖拽文件到此处')
          return
        }
        
        let addedCount = 0
        let failedCount = 0
        let typeMismatchCount = 0
        
        for (const file of files) {
          const filePath = (file as any).path || file.name
            const fileName = file.name.toLowerCase()
            
            // 获取文件扩展名
            const fileExt = fileName.includes('.') 
              ? '.' + fileName.split('.').pop() 
              : ''
            
            // 检测是否为文件夹
            const isFolder = (() => {
              // 方法1: 检查 webkitGetAsEntry
              const entry = typeof (file as any).webkitGetAsEntry === 'function'
                ? (file as any).webkitGetAsEntry()
                : null
              if (entry && entry.isDirectory) {
                return true
              }
              
              // 方法2: 检查文件类型和扩展名
              // 文件夹通常没有文件类型，且没有扩展名（或扩展名不在常见文件扩展名列表中）
              const hasExtension = /\.\w+$/.test(fileName)
              const isLikelyDirectory = (!file.type || file.type === '') && !hasExtension
              
              return isLikelyDirectory
            })()
            
            console.log(`[GenericResourceView] 处理文件: ${file.name}, 扩展名: ${fileExt}, 是否为文件夹: ${isFolder}`)
            
            // 检查是否已存在相同路径
            const existingItem = items.value.find((item: any) => {
              const itemPath = BaseResources.extractPrimitiveValue(
                item.resourcePath?.value || item.resourcePath
              )
              return itemPath === filePath
            })
            
            if (existingItem) {
              console.log(`[GenericResourceView] 资源已存在: ${file.name}`)
              failedCount++
              continue
            }
            
            // 根据页面配置的 resourceTypes 自动匹配资源类型
            const pageResourceTypes = props.pageConfig?.resourceTypes || [resourceType.value]
            console.log('[GenericResourceView] 页面支持的资源类型:', pageResourceTypes)
            
            let matchedResourceType: string | null = null
            let MatchedResourceClass: any = null
            
            // 遍历页面支持的资源类型，找到第一个匹配的
            for (const resType of pageResourceTypes) {
              const config = resourceClassMap[resType]
              if (!config) {
                console.warn(`[GenericResourceView] 未找到资源类型配置: ${resType}`)
                continue
              }
              
              const ResourceClassToCheck = config.resourceClass
              const acceptedExtensions = ResourceClassToCheck.acceptedExtensions || []
              
              console.log(`[GenericResourceView] 检查资源类型 ${resType}, 接受的扩展名:`, acceptedExtensions)
              
              // 检查是否接受所有文件类型
              if (acceptedExtensions.includes('*')) {
                matchedResourceType = resType
                MatchedResourceClass = ResourceClassToCheck
                console.log(`[GenericResourceView] 匹配成功（接受所有类型）: ${resType}`)
                break
              }
              
              // 如果是文件夹，检查是否接受文件夹
              if (isFolder && acceptedExtensions.includes('<folder>')) {
                matchedResourceType = resType
                MatchedResourceClass = ResourceClassToCheck
                console.log(`[GenericResourceView] 匹配成功（文件夹）: ${resType}`)
                break
              }
              
              // 检查文件扩展名是否匹配（非文件夹情况）
              if (!isFolder && acceptedExtensions.some((ext: string) => ext.toLowerCase() === fileExt)) {
                matchedResourceType = resType
                MatchedResourceClass = ResourceClassToCheck
                console.log(`[GenericResourceView] 匹配成功: ${resType}`)
                break
              }
            }
            
            // 如果没有匹配的资源类型
            if (!matchedResourceType || !MatchedResourceClass) {
              console.warn(`[GenericResourceView] 文件 ${file.name} 不匹配页面的资源类型配置`)
              typeMismatchCount++
              continue
            }
            
            // 创建匹配到的资源类型
            const resourceData: any = {
              id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              resourceType: 'game', // GreenGameVault 仅保留游戏类型
              name: extractNameFromPath(file.name),
              description: '',
              tags: [],
              resourcePath: filePath,
              coverPath: '',
              folderSize: 0,
              playTime: 0,
              playCount: 0,
              visitedSessions: [],
              addedDate: new Date().toISOString(),
              fileExists: true
            }
            
            // 获取文件大小（失败则抛出，不静默吞错）
            if (isElectronEnvironment.value && window.electronAPI) {
              if (window.electronAPI.getFileStats) {
                const result = await window.electronAPI.getFileStats(filePath)
                if (result.success && result.size) {
                  resourceData.folderSize = result.size
                }
              } else if (window.electronAPI.getFolderSize) {
                const result = await window.electronAPI.getFolderSize(filePath)
                if (result.success) {
                  resourceData.folderSize = result.size
                }
              }
            }
            
            // 使用匹配到的资源类创建实例
            const resource = MatchedResourceClass.fromJSON(resourceData)
            console.log(`[GenericResourceView] 创建资源对象 (类型: ${matchedResourceType}):`, resource)
            
            // 添加到列表
          items.value.push(resource)
          addedCount++
        }
        
        if (addedCount > 0) {
          await saveData()
          notify.toast(
            'success',
            '添加成功',
            `成功添加 ${addedCount} 个资源${failedCount > 0 ? `，${failedCount} 个失败` : ''}${typeMismatchCount > 0 ? `，${typeMismatchCount} 个类型不匹配` : ''}`
          )
        } else if (typeMismatchCount > 0) {
          notify.toast(
            'error',
            '资源类型不匹配',
            `${typeMismatchCount} 个文件的类型不匹配当前页面的配置`
          )
        } else if (failedCount > 0) {
          notify.toast(
            'error',
            '添加失败',
            `${failedCount} 个文件添加失败（可能已存在）`
          )
        }
      } catch (error: any) {
        console.error('[GenericResourceView] 处理拖拽失败:', error)
        notify.toast('error', '处理失败', `处理拖拽文件失败: ${error.message}`)
        throw error
      }
    }
    
    /**
     * 处理拖拽错误
     */
    const handleDropError = (error: { type: 'size' | 'count' | 'type', message: string }) => {
      const title = error.type === 'size' ? '文件过大' : 
                    error.type === 'count' ? '文件数量超限' : 
                    '文件类型不支持'
      notify.toast('error', title, error.message)
    }
    
    // 使用拖拽 composable（直接使用，避免 FunDropZone 组件的性能问题）
    // 视频页是只读的：资源由绑定文件夹扫描得到，拖拽入库无意义，直接关掉
    const { isDragOver, handleDragOver, handleDragEnter, handleDragLeave, handleDrop: handleDragDrop } = useDragAndDrop({
      acceptedExtensions: [],
      enabled: !isVideoPage.value,
      onDrop: handleFileDrop
    })
    
    /**
     * 保存页面数据到文件
     */
    const saveData = async () => {
      const pageId = pageConfig.value?.id
      if (!pageId) {
        throw new Error('无法保存数据：pageId 不存在')
      }
      
      if (!isElectronEnvironment.value || !window.electronAPI || !window.electronAPI.sqliteSavePageResources) {
        throw new Error('不在 Electron 环境或数据库 API 不可用，无法保存')
      }
      const saveableData = items.value.map(item => (item as any).getSaveData())
      console.log(`[GenericResourceView] 保存页面 ${pageId} 数据到数据库，共 ${saveableData.length} 条记录`)
      console.log('[GenericResourceView] saveableData 完整内容:', saveableData)
      saveableData.forEach((item, index) => {
        console.log(`[GenericResourceView] 第 ${index} 条记录 - id: ${item.id}, resourceType: ${item.resourceType}`)
        console.log(`[GenericResourceView] 第 ${index} 条记录 所有字段:`, Object.keys(item))
      })
      const result = await window.electronAPI.sqliteSavePageResources(pageId, saveableData)
      if (!result || !result.ok) {
        throw new Error((result && result.message) ? result.message : '保存页面数据到数据库失败')
      }
      console.log(`[GenericResourceView] 页面 ${pageId} 数据保存成功`)
      return true
    }

    // 游戏截图功能（仅 Game 类型且 Electron 环境）
    const gameScreenshotComposable =
      resourceType.value === 'Game' && isElectronEnvironment.value
        ? useGameScreenshot(
            isElectronEnvironment,
            () => gameRunningStore.getRunningGamesMap(),
            async (result: { gameId?: string; filepath: string }) => {
              if (!result?.gameId || !result?.filepath) return
              const item = items.value.find((i: any) => (i.id?.value || i.id) === result.gameId)
              if (!item) return
              // 当封面为空（未设置、已清除或仅空白）时，将本次截图设为封面
              const currentCover = item.coverPath?.value ?? item.coverPath ?? (item as any).image
              const isCoverEmpty = currentCover == null || String(currentCover).trim() === ''
              if (!isCoverEmpty) return
              if (item.coverPath && typeof item.coverPath === 'object' && 'value' in item.coverPath) {
                item.coverPath.value = result.filepath
              } else {
                (item as any).coverPath = result.filepath
              }
              await saveData()
              const name = item.name?.value ?? item.name
              notify.toast('success', '封面已更新', `已自动将截图设置为 "${name}" 的封面图`)
            }
          )
        : null

    // 详情页预览相关状态（服务于游戏截图浏览：Game 的 previewArea = 'useScreenshotFolder'）
    const detailPages = ref<string[]>([])
    const showDetailModal = ref(false)

    // 详情页图片分页 composable（游戏截图列表分页）
    const imagePagesComposable = useImagePages({
      pages: detailPages,
      defaultPageSize: 50
    })

    // 检查 Electron 环境
    isElectronEnvironment.value = !!(window as any).electronAPI

    // 获取排序选项
    const sortOptions = pageConfig.value?.sortOptions || []

    // 游戏运行状态管理（使用 store）
    const gameRunningStore = useGameRunningStore()
    
    // 存储游戏启动时的初始 playTime（Map<resourceId, initialPlayTime>）
    const gameInitialPlayTimes = ref<Map<string, number>>(new Map())
    
    // 定时器引用（用于定期更新总时长）
    let playtimeUpdateTimer: ReturnType<typeof setInterval> | null = null
    
    // 强制结束程序确认对话框状态
    const showTerminateConfirmDialog = ref(false)
    const resourceToTerminate = ref<any>(null)

    // 检查资源是否正在运行（凡使用 launchExecutable 的资源都会登记到 store，按 id 查询即可）
    const isResourceRunning = (resource: any): boolean => {
      const resourceId = resource.id?.value || resource.id
      if (!resourceId) return false
      return gameRunningStore.isGameRunning(resourceId)
    }

    // 创建用于筛选的“运行中”函数（游戏/软件等可执行程序共用同一 store）
    const isGameRunningForFilter = (item: any) => {
      return gameRunningStore.isGameRunning(item.id?.value || item.id)
    }

    // 多选模式相关方法
    const toggleMultiSelectMode = () => {
      isMultiSelectMode.value = !isMultiSelectMode.value
      if (!isMultiSelectMode.value) {
        selectedItems.value.clear()
      }
    }
    
    const isItemSelected = (item: any): boolean => {
      const itemId = item.id?.value || item.id
      return selectedItems.value.has(itemId)
    }
    
    const toggleSelectItem = (item: any) => {
      const itemId = item.id?.value || item.id
      if (selectedItems.value.has(itemId)) {
        selectedItems.value.delete(itemId)
      } else {
        selectedItems.value.add(itemId)
      }
    }

    const handleBatchAddTag = () => {
      if (selectedItems.value.size === 0) {
        notify.toast('warning', '批量增加tag', '请先选择要操作的项目')
        return
      }
      showBatchAddTagDialog.value = true
    }

    const closeBatchAddTagDialog = () => {
      showBatchAddTagDialog.value = false
    }

    const handleBatchAddTagConfirm = async (tags: string[]) => {
      if (tags.length === 0) {
        notify.toast('warning', '批量增加tag', '请至少输入一个标签')
        return
      }

      let successCount = 0
      let failCount = 0

      for (const itemId of selectedItems.value) {
        const item = items.value.find((i: any) => (i.id?.value || i.id) === itemId)
        if (item) {
          try {
            const currentTags = BaseResources.extractPrimitiveValue(item.tags?.value ?? item.tags) || []
            const newTags = [...new Set([...currentTags, ...tags])]
            
            if (item.tags && typeof item.tags === 'object' && 'value' in item.tags) {
              item.tags.value = newTags
            } else {
              item.tags = newTags
            }
            successCount++
          } catch (error) {
            console.error(`[GenericResourceView] 批量增加tag失败: ${itemId}`, error)
            failCount++
          }
        }
      }

      if (successCount > 0) {
        await saveData()
        notify.toast('success', '批量增加tag', `成功为 ${successCount} 个项目添加标签${failCount > 0 ? `，${failCount} 个失败` : ''}`)
      } else {
        notify.toast('error', '批量增加tag', '添加失败')
      }

      closeBatchAddTagDialog()
    }

    /**
     * 全局「使用最新截图作为封面」
     *
     * 针对当前页里所有【封面为空】的游戏：找到各自的截图文件夹，取最新一张截图设为封面。
     * 流程刻意做成「只读扫描 → 弹确认框告知真实数量 → 才写库」，
     * 免得误点一下就把库里上百条记录改花；已有封面的一律不碰。
     */
    const handleBatchLatestScreenshotCover = async () => {
      if (!isElectronEnvironment.value || !window.electronAPI?.listImageFiles) {
        notify.toast('error', '操作失败', '当前环境不支持此功能')
        return
      }

      const extractId = (it: any) => String(BaseResources.extractPrimitiveValue(it.id?.value ?? it.id) ?? '')

      // 只处理封面为空的
      const targets = items.value
        .filter((it: any) => {
          const cover = BaseResources.extractPrimitiveValue(it.coverPath?.value ?? it.coverPath)
          return cover == null || String(cover).trim() === ''
        })
        .map((it: any) => ({
          id: extractId(it),
          name: String(BaseResources.extractPrimitiveValue(it.name?.value ?? it.name) ?? '')
        }))
        .filter((g: any) => !!g.id)

      if (targets.length === 0) {
        notify.toast('info', '使用最新截图作为封面', '当前页所有游戏都已有封面，无需处理')
        return
      }

      notify.toast('info', '使用最新截图作为封面', `正在扫描 ${targets.length} 个无封面游戏的截图目录…`)

      let scan
      try {
        scan = await scanGamesMissingCover(targets)
      } catch (error: any) {
        console.error('[GenericResourceView] 扫描截图失败:', error)
        notify.toast('error', '扫描失败', error?.message || '未知错误')
        return
      }

      const found = scan.targets.length
      const noFolder = scan.skipped.filter(s => s.reason === 'no-folder').length
      const noImage = scan.skipped.filter(s => s.reason === 'no-image').length

      if (found === 0) {
        notify.toast(
          'warning',
          '使用最新截图作为封面',
          `${targets.length} 个无封面游戏中没有找到可用截图（${noFolder} 个没有截图文件夹，${noImage} 个文件夹里没有图片）`
        )
        return
      }

      const confirmed = await confirmService.confirm(
        `共 ${targets.length} 个游戏没有封面。\n` +
          `其中 ${found} 个找到了截图，将各取「最新一张」设为封面；\n` +
          `另外 ${noFolder} 个没有截图文件夹、${noImage} 个文件夹里没有图片，会自动跳过。\n\n` +
          `确认后会立即写入存档（已有封面的游戏不受影响），是否继续？`,
        '使用最新截图作为封面'
      )
      if (!confirmed) return

      let assigned = 0
      for (const target of scan.targets) {
        const item = items.value.find((i: any) => extractId(i) === target.id)
        if (!item) continue
        const coverValue = toSaveDataRelativePath(target.newestFile)
        if (item.coverPath && typeof item.coverPath === 'object' && 'value' in item.coverPath) {
          item.coverPath.value = coverValue
        } else {
          (item as any).coverPath = coverValue
        }
        assigned++
      }

      if (assigned === 0) {
        notify.toast('warning', '使用最新截图作为封面', '没有可写入的游戏')
        return
      }

      try {
        await saveData()
      } catch (error: any) {
        console.error('[GenericResourceView] 保存封面失败:', error)
        notify.toast('error', '保存失败', error?.message || '写入存档失败')
        return
      }

      notify.toast(
        'success',
        '使用最新截图作为封面',
        `已为 ${assigned} 个游戏装载封面` +
          (noFolder + noImage > 0 ? `，${noFolder + noImage} 个没有可用截图已跳过` : '')
      )
    }

    const handleBatchDeleteTag = () => {      if (selectedItems.value.size === 0) {
        notify.toast('warning', '批量删除tag', '请先选择要操作的项目')
        return
      }
      showBatchDeleteTagDialog.value = true
    }

    const closeBatchDeleteTagDialog = () => {
      showBatchDeleteTagDialog.value = false
    }

    const handleBatchDeleteTagConfirm = async (tags: string[]) => {
      if (tags.length === 0) {
        notify.toast('warning', '批量删除tag', '请至少输入一个标签')
        return
      }

      let successCount = 0
      let failCount = 0

      for (const itemId of selectedItems.value) {
        const item = items.value.find((i: any) => (i.id?.value || i.id) === itemId)
        if (item) {
          try {
            const currentTags = BaseResources.extractPrimitiveValue(item.tags?.value ?? item.tags) || []
            const newTags = currentTags.filter((tag: string) => !tags.includes(tag))
            
            if (item.tags && typeof item.tags === 'object' && 'value' in item.tags) {
              item.tags.value = newTags
            } else {
              item.tags = newTags
            }
            successCount++
          } catch (error) {
            console.error(`[GenericResourceView] 批量删除tag失败: ${itemId}`, error)
            failCount++
          }
        }
      }

      if (successCount > 0) {
        await saveData()
        notify.toast('success', '批量删除tag', `成功从 ${successCount} 个项目删除标签${failCount > 0 ? `，${failCount} 个失败` : ''}`)
      } else {
        notify.toast('error', '批量删除tag', '删除失败')
      }

      closeBatchDeleteTagDialog()
    }

    const handleBatchDelete = () => {
      if (selectedItems.value.size === 0) {
        notify.toast('warning', '批量删除文件', '请先选择要操作的项目')
        return
      }
      showBatchDeleteConfirmDialog.value = true
    }

    const closeBatchDeleteConfirmDialog = () => {
      showBatchDeleteConfirmDialog.value = false
    }

    const handleBatchDeleteConfirm = async () => {
      const deleteCount = selectedItems.value.size

      try {
        for (const itemId of selectedItems.value) {
          const index = items.value.findIndex((i: any) => (i.id?.value || i.id) === itemId)
          if (index > -1) {
            items.value.splice(index, 1)
          }
        }

        await saveData()
        notify.toast('success', '批量删除文件', `成功删除 ${deleteCount} 个项目`)

        selectedItems.value.clear()
        isMultiSelectMode.value = false
      } catch (error) {
        console.error('[GenericResourceView] 批量删除文件失败:', error)
        notify.toast('error', '批量删除文件', '删除失败')
      }

      closeBatchDeleteConfirmDialog()
    }

    const contextMenuItems = computed(() => {
      if (isMultiSelectMode.value) {
        // 视频页是「只读标签管理」：批量菜单里**绝不能**出现「批量删除文件」
        if (isVideoPage.value) {
          // 回收站里：抽帧没有意义（文件都不在了），换成"移除记录"
          if (isRecycleBinMode.value) {
            return [
              { key: 'batchAddTag', icon: '🏷️', label: '批量增加tag' },
              { key: 'batchDeleteTag', icon: '🏷️', label: '批量删除tag' },
              { key: 'batchRemoveRecords', icon: '🗑️', label: '批量移除记录（磁盘文件不动）' }
            ]
          }
          return [
            { key: 'batchAddTag', icon: '🏷️', label: '批量增加tag' },
            { key: 'batchDeleteTag', icon: '🏷️', label: '批量删除tag' },
            { key: 'batchGrabCover', icon: '🎬', label: '批量抽帧设为封面' }
          ]
        }
        return [
          { key: 'batchAddTag', icon: '🏷️', label: '批量增加tag' },
          { key: 'batchDeleteTag', icon: '🏷️', label: '批量删除tag' },
          { key: 'batchDelete', icon: '🗑️', label: '批量删除文件' }
        ]
      } else {
        // 回收站里：文件在磁盘上已经没有了，只留「详情 / 重新关联 / 编辑 / 移除记录」
        if (isVideoPage.value && isRecycleBinMode.value) {
          return [
            { key: 'detail', icon: '👁️', label: '查看详情' },
            { key: 'relink', icon: '🔗', label: '重新关联到…' },
            { key: 'edit', icon: '✏️', label: '编辑信息' },
            { key: 'remove-record', icon: '🗑️', label: '从库中移除（磁盘文件不动）' }
          ]
        }
        return [...(ResourceClass.contextMenuItems || [])]
      }
    })

    /**
     * 视频库（绑定文件夹 / 扫描同步 / 层级 / 实时监听 / 打开次数 / 抽帧封面）
     * 非视频页时内部的 enabled 为 false，所有能力空转，不影响游戏页。
     */
    const videoLib = useVideoLibrary({
      enabled: isVideoPage.value,
      items,
      resourceClass: ResourceClass,
      isElectronEnvironment,
      save: async () => {
        try {
          return await saveData()
        } catch (error) {
          console.error('[GenericResourceView] 视频库保存失败:', error)
          return false
        }
      }
    })

    // 视频页：筛选/排序/分页只作用于「当前范围」；其它页面照旧用全量。
    //
    // ⚠️ 这里故意用**子树**（scopePool），不是「当前这一层」：
    //    主人 2026-10-05 报的「文件夹里只有子文件夹时左侧筛选显示空」，
    //    根因就是筛选池只有这一层的直接子文件。
    //    真正"只显示当前层"的收窄在下面 filteredItems 的显示闸门里做。
    //
    // 回收站模式下池子换成「丢失的记录」——左栏的标签/作者/格式跟着回收站内容走。
    const recycleSelectedRef: any = { value: null }
    const isRecycleBinMode = computed(() => {
      if (!isVideoPage.value) return false
      const selected = recycleSelectedRef.value?.value
      return Array.isArray(selected) && selected.length > 0
    })
    const itemsForFilter = computed<any[]>(() => {
      if (!isVideoPage.value) return items.value
      return isRecycleBinMode.value ? videoLib.missingItems.value : videoLib.scopePool.value
    })

    // 使用通用筛选 composable（传入页面配置 ID 和额外数据）
    const filterComposable = useResourceFilter(
      itemsForFilter,
      searchQuery, 
      sortBy, 
      pageConfig.value?.id || '',
      {
        isGameRunning: isGameRunningForFilter,
        // 视频页：文件管理器式模糊搜索 —— 文件名/相对路径/作者/标签/简介都能搜，
        // 支持空格分词（「第二 改名」）与忽略下划线（「第二部改名」）。
        // 字段清单来自 Video.searchFields（文件夹可见性判定用的是同一份，避免两处不一致）。
        searchFields: isVideoPage.value
          ? [...(ResourceClass?.searchFields || ['name'])]
          : []
      }
    )

    // 左栏「丢失的文件」这一项选中 = 进回收站。这里直接把它的 selected ref 抓住，
    // 让上面的筛选池跟着切换（顺序上必须等 useResourceFilter 建好状态之后才拿得到）。
    if (isVideoPage.value) {
      recycleSelectedRef.value = (filterComposable as any).filterStates?.['missing-resources']?.selected || null
    }
    
    // 从筛选器状态中获取所有标签（用于编辑对话框，兼容单一口径）
    const allTags = computed<FilterItem[]>(() => {
      const tagsState = filterComposable.filterStates?.tags
      return tagsState?.items?.value || []
    })

    // 按字段 key 提供各自的候选列表（作者用 author 数据，标签用 tags 数据）
    // ⚠️ 编辑对话框是按**资源字段名**取的（author / tags），而筛选器的 key 可能是
    //    authors / extensions —— buildTagsByField 会把两套键都补齐，
    //    否则取不到候选时会退化成"拿标签列表兜底"，作者栏里就会冒出标签。
    const availableTagsByField = computed<Record<string, FilterItem[]>>(() => {
      const states = (filterComposable.filterStates || {}) as Record<string, any>
      const itemsByFilterKey: Record<string, FilterItem[]> = {}
      for (const key of Object.keys(states)) {
        const items = states[key]?.items?.value
        itemsByFilterKey[key] = Array.isArray(items) ? items : []
      }
      return buildTagsByField(pageConfig.value?.filterConfig || [], itemsByFilterKey) as Record<string, FilterItem[]>
    })

    /**
     * 把「丢失的文件」这一项的计数改成**当前范围内全部丢失记录**的数量。
     *
     * 为什么不能交给 extractFn 自己数：筛选池（scopePool）里只有"当前层子树"，
     * 而丢失记录要按整棵子树算 —— 但池子若把丢失记录也算进标签候选，
     * 又会出现"标签是丢失文件上的、点进去主视图却什么都没有"。
     * 所以标签/作者照旧只看存在的东西，丢失计数这里单独补上。
     */
    const applyMissingCount = (data: any) => {
      if (!data?.filters || !isVideoPage.value) return
      const count = videoLib.missingItems.value.length
      const label = pageConfig.value?.filterConfig
        ?.find((config: any) => config.key === 'missing-resources')?.params?.missingLabel || '丢失的文件'
      data.filters = data.filters.map((filter: any) => {
        if (filter.key !== 'missing-resources') return filter
        const items = Array.isArray(filter.items) && filter.items.length > 0
          ? [{ ...filter.items[0], count }]
          : [{ name: label, count }]
        return { ...filter, items }
      })
    }

    /** 重新提取筛选器数据并推给左侧栏（视频库扫描/切换目录后必须刷新，否则左栏是旧数据） */
    const refreshFilterData = () => {
      try {
        filterComposable.extractAllFilters?.()
        const data = filterComposable.getFilterData?.()
        if (data) {
          applyMissingCount(data)
          emit('filter-data-updated', data)
        }
      } catch (error) {
        console.warn('[GenericResourceView] 刷新筛选器数据失败:', error)
      }
    }

    // 视频页：扫描完成、切换目录、进出回收站后刷新左栏筛选器
    if (isVideoPage.value) {
      watch(
        () => [videoLib.lastScanAt.value, videoLib.currentRoot.value, videoLib.currentRel.value],
        () => {
          refreshFilterData()
        }
      )
      watch(isRecycleBinMode, (inRecycleBin) => {
        if (inRecycleBin) videoLib.resetRecycle()
        refreshFilterData()
      })
    }

    // 终止游戏方法
    const terminateGame = async (resource: any) => {
      try {
        const resourceName = BaseResources.extractPrimitiveValue(resource.name?.value || resource.name)
        const executablePath = BaseResources.extractPrimitiveValue(
          resource.resourcePath?.value || resource.executablePath?.value || resource.resourcePath || resource.executablePath
        )
        const resourceId = BaseResources.extractPrimitiveValue(resource.id?.value || resource.id)
        
        if (!isElectronEnvironment.value || !window.electronAPI || !window.electronAPI.terminateGame) {
          notify.toast('error', '操作失败', '当前环境不支持强制结束程序功能')
          return
        }

        const result = await window.electronAPI.terminateGame(executablePath, resourceName)
        
        if (result.success) {
          // 从运行列表中移除（游戏/软件等可执行程序统一登记，统一移除）
          gameRunningStore.removeRunningGame(resourceId)
          
          // 更新运行时长（使用初始时长逻辑）
          if (result.playTime && result.playTime > 0) {
            const currentPlayTime = BaseResources.extractPrimitiveValue(resource.playTime?.value || resource.playTime) || 0
            const initialPlayTime = gameInitialPlayTimes.value.get(resourceId) || currentPlayTime
            // 计算最终总时长（使用 store 中的会话时长，如果 store 中还有数据）
            let totalPlayTime = currentPlayTime
            if (gameRunningStore.isGameRunning(resourceId)) {
              // 如果还在运行列表中，使用 store 计算
              totalPlayTime = gameRunningStore.getCurrentPlayTime(resourceId, initialPlayTime)
            } else {
              // 否则直接累加
              totalPlayTime = currentPlayTime + result.playTime
            }
            
            // 更新资源数据
            const item = items.value.find((i: any) => (i.id?.value || i.id) === resourceId)
            if (item) {
              if (item.playTime && typeof item.playTime === 'object' && 'value' in item.playTime) {
                item.playTime.value = totalPlayTime
              } else {
                item.playTime = totalPlayTime
              }
            }
            
            // 清除保存的初始值
            gameInitialPlayTimes.value.delete(resourceId)
          }
          
          notify.toast('success', '程序已结束', `${resourceName} 已强制结束`)
        } else {
          console.warn('[GenericResourceView] ⚠️ 强制结束程序失败:', result.error)
          notify.toast('error', '结束失败', `结束失败: ${result.error || '未知错误'}`)
        }
      } catch (error) {
        console.error('[GenericResourceView] ❌ 终止程序失败:', error)
        notify.toast('error', '结束失败', `结束失败: ${error.message || '未知错误'}`)
      }
    }

    // 处理可执行程序进程结束事件（游戏/软件等）
    const handleGameProcessEnded = async (data: { executablePath: string; playTime: number; pid: number }) => {
      // 根据 executablePath 找到对应的资源
      const resource = items.value.find((item: any) => {
        const itemPath = BaseResources.extractPrimitiveValue(
          item.resourcePath?.value || item.executablePath?.value || item.resourcePath || item.executablePath
        )
        return itemPath === data.executablePath
      })
      
        if (resource) {
        const resourceId = BaseResources.extractPrimitiveValue(resource.id?.value || resource.id)
        
        // 从运行列表中移除（凡用 launchExecutable 启动的都会在此登记，统一移除）
        gameRunningStore.removeRunningGame(resourceId)
        
        // 更新运行时长（使用最终时长更新逻辑）
        if (data.playTime && data.playTime > 0) {
          // 获取初始 playTime（从保存的初始值获取，如果不存在则使用当前值）
          const currentPlayTime = BaseResources.extractPrimitiveValue(resource.playTime?.value || resource.playTime) || 0
          const initialPlayTime = gameInitialPlayTimes.value.get(resourceId) || currentPlayTime
          // 计算最终总时长（使用 store 中的会话时长，如果 store 中还有数据）
          let totalPlayTime = currentPlayTime
          if (gameRunningStore.isGameRunning(resourceId)) {
            totalPlayTime = gameRunningStore.getCurrentPlayTime(resourceId, initialPlayTime)
          } else {
            totalPlayTime = currentPlayTime + data.playTime
          }
          
          // 更新资源数据
          if (resource.playTime && typeof resource.playTime === 'object' && 'value' in resource.playTime) {
            resource.playTime.value = totalPlayTime
          } else {
            resource.playTime = totalPlayTime
          }
          // visitedSessions 在启动时已记录，此处仅更新 playTime
          gameInitialPlayTimes.value.delete(resourceId)
          
          // 持久化到数据库
          try {
            await saveData()
          } catch (err: any) {
            console.error('[GenericResourceView] 游戏时长保存到数据库失败:', err)
            notify.toast('error', '保存失败', `游戏时长未能写入数据库: ${err.message}`)
            throw err
          }
        }
      } else {
        console.warn('[GenericResourceView] ⚠️ 未找到对应的资源，executablePath:', data.executablePath)
      }
    }

    // 处理资源操作（根据 actionConfig 启动资源；可选 options.handlerName 指定要执行的 handler，如 'launchWithLocale'）
    const handleResourceAction = async (resource: any, options?: { handlerName?: string }) => {      // 从资源实例获取实际的资源类型
      const actualResourceType = BaseResources.extractPrimitiveValue(
        resource.resourceType?.value || resource.resourceType
      ) || resource?.constructor?.name || resourceType.value
      
      // 构建 handler 上下文
      const context: ActionHandlerContext = {
        isElectronEnvironment: isElectronEnvironment.value,
        updateResource: async (id: string, updates: any) => {
          const idStr = String(id ?? '')
          const item = items.value.find((i: any) => String(i.id?.value ?? i.id ?? '') === idStr)
          if (item) {
            Object.keys(updates).forEach(key => {
              if (item[key] && typeof item[key] === 'object' && 'value' in item[key]) {
                item[key].value = updates[key]
              } else {
                item[key] = updates[key]
              }
            })
            await saveData()
          }
        },
        isResourceRunning: (resource: any) => {
          return isResourceRunning(resource)
        },
        addRunningResource: (resourceInfo: any) => {
          // 凡配置了 launchExecutable 的资源（游戏、软件等）都登记到运行列表
          if (supportsRunningTracking.value) {
            gameRunningStore.addRunningGame({
              id: resourceInfo.id,
              pid: resourceInfo.pid,
              windowTitles: resourceInfo.windowTitles || [],
              gameName: resourceInfo.gameName || ''
            })
          }
        },
        removeRunningResource: (resourceId: string) => {
          if (supportsRunningTracking.value) {
            gameRunningStore.removeRunningGame(resourceId)
          }
        },
        getInitialPlayTime: (resourceId: string) => {
          // 获取资源启动时的初始 playTime
          const item = items.value.find((i: any) => (i.id?.value || i.id) === resourceId)
          if (item) {
            const playTime = item.playTime?.value ?? item.playTime
            return playTime != null ? playTime : 0
          }
          return 0
        },
        saveInitialPlayTime: (resourceId: string, playTime: number) => {
          // 保存初始运行时长到 Map 中
          gameInitialPlayTimes.value.set(resourceId, playTime)
        },
        closeDetail: () => {
          // 关闭详情页面（如果有的话）
          if ((resourcePage as any).closeDetail) {
            (resourcePage as any).closeDetail()
          }
        },
        showTerminateConfirmDialog: (resource: any) => {
          // 显示终止确认对话框
          showTerminateConfirmDialog.value = true
          resourceToTerminate.value = resource
        },
        
      }

      // 若指定了 handlerName（如右键「转区启动」），则执行该 handler；否则按资源 actionConfig 执行
      const overrideHandlerName = options?.handlerName
      if (overrideHandlerName) {
        const handler = getActionHandler(overrideHandlerName)
        if (handler) {
          await handler(resource, context)
          return
        }
      }
      await executeActionHandler(resource, context)
    }

    /**
     * 卡片上那个「主操作按钮」（封面上的 ▶️）的派发入口。
     *
     * 游戏走原来的 handler 注册表（launchExecutable）；
     * 视频走 videoLib.openVideo —— 因为「打开次数 +1 / 标记丢失 / 落库」这套逻辑
     * 只应该有一份实现，右键菜单与详情页也用的是它。
     * （2026-10-04 主人反馈：卡片上直接点播放没反应，右键的「打开」却正常，就是这个分叉。）
     */
    const handleCardAction = async (resource: any) => {
      if (isVideoPage.value) {
        await videoLib.openVideo(resource)
        return
      }
      await handleResourceAction(resource)
    }

    // 使用筛选 composable 的 filteredItems（已经是响应式的）
    //
    // 视频页的「显示闸门」（主人 2026-10-05 需求：主视图与文件目录强绑定）：
    //   - 普通模式：只要**磁盘上真实存在**、且正好在当前这一层的视频；
    //     丢失的记录一律不进主视图 —— 它们只出现在左栏「丢失的文件」（回收站）里。
    //   - 回收站模式：只要回收站当前钻到的那一层里的丢失记录。
    // 筛选池是子树（为了让左栏筛选有数据），所以这里必须再收窄一次。
    // 判定逻辑抽在 utils/videoVisibility.ts 里，方便单测。
    const rawFilteredItems = filterComposable.filteredGames
    const filteredItems = computed<any[]>(() => {
      // 🔴 这道「显示闸门」是**视频页专属**的：它按 rootPath / relPath 判断"是否在当前这一层"，
      // 而游戏等其它资源页根本没有层级概念 —— 一旦也被它过滤就会全军覆没。
      // （v1.3.0 唯独漏了这一处守卫，导致游戏页恒显示「没有找到匹配的游戏」；
      //   2026-10-05 用 CDP 实测定位：IPC 返回 270 条游戏，DOM 里 0 张卡片。）
      if (!isVideoPage.value) return rawFilteredItems.value || []

      return filterVisibleVideoItems(rawFilteredItems.value || [], {
        recycleMode: isRecycleBinMode.value,
        recycleRel: videoLib.recycleRel.value,
        isMissing: isMissingItem,
        isAtCurrentLevel: videoLib.isAtCurrentLevel,
        relativeFolderOf: videoLib.relativeFolderOf
      })
    })
    // 下游（分页、空状态判定、模板）统一用这份收窄后的列表
    ;(filterComposable as any).filteredGames = filteredItems
    ;(filterComposable as any).filteredItems = filteredItems
    

    // 监听 items 变化，自动提取筛选器数据（完全按照 ImageView 的方式）
    // 临时注释掉，测试性能问题
    // watch([items], () => {
    //   if (filterComposable.extractAllFilters && items.value.length > 0) {
    //     filterComposable.extractAllFilters()
    //     // 延迟更新筛选器数据，确保数据已提取
    //     setTimeout(() => {
    //       // 注意：这里不能直接 emit，需要在 methods 中通过 updateFilterData 处理
    //     }, 0)
    //   }
    // }, { immediate: false, deep: true })

    // 创建右键菜单处理器（简化版；launch/folder/terminate/edit/remove 在 handleDetailActionImpl 定义后统一绑定）
    const contextMenuHandlers: Record<string, (item: any) => void | Promise<void>> = {
      detail: (item: any) => {
        // 调用 showDetail 方法（从 resourcePage 获取）
        if ((resourcePage as any).showDetail) {
          (resourcePage as any).showDetail(item)
        }
      },
      edit: (item: any) => {
        // 编辑
      },
      remove: (item: any) => {
        const index = items.value.findIndex((i: any) => (i.id?.value || i.id) === (item.id?.value || item.id))
        if (index > -1) {
          items.value.splice(index, 1)
        }
      },
      'update-folder-size': async (item: any) => {
        if (!isElectronEnvironment.value) {
          const errorMsg = '当前环境不支持文件夹大小计算功能'
          console.log('[GenericResourceView] 文件夹大小计算失败:', errorMsg)
          notify.toast('error', '操作失败', errorMsg)
          return
        }
        
        const cardConfig = item.constructor?.cardDisplayConfig || 
                         (typeof item.constructor?.getCardDisplayConfig === 'function' 
                           ? item.constructor.getCardDisplayConfig() 
                           : null)
        
        console.log('[GenericResourceView] 检查资源类型配置:', {
          resourceType: item.constructor?.name,
          cardConfigExists: !!cardConfig,
          badgeField: cardConfig?.badge?.field
        })
        
        if (cardConfig?.badge?.field !== 'folderSize') {
          const errorMsg = `该资源类型(${item.constructor?.name || '未知'})不支持文件夹大小计算，需要配置badge.field为'folderSize'`
          console.log('[GenericResourceView] 文件夹大小计算失败:', errorMsg)
          notify.toast('error', '操作失败', errorMsg)
          return
        }
        
        try {
          const itemName = BaseResources.extractPrimitiveValue(item.name?.value || item.name) || '未知'
          const oldSize = BaseResources.extractPrimitiveValue(item.folderSize?.value || item.folderSize) || 0
          
          console.log('[GenericResourceView] 开始计算文件夹大小:', {
            itemName,
            oldSize,
            resourceType: item.constructor?.name
          })
         // 计算资源大小
          const success = await calculateAndUpdateResourceSize(
            item, 
            isElectronEnvironment.value, 
            resourceType.value === 'Game' // 游戏类型计算文件夹大小
          )
          
          console.log('[GenericResourceView] 文件夹大小计算结果:', {
            itemName,
            success,
            newSize: BaseResources.extractPrimitiveValue(item.folderSize?.value || item.folderSize) || 0
          })
          
          if (success) {
            const newSize = BaseResources.extractPrimitiveValue(item.folderSize?.value || item.folderSize) || 0
            const oldSizeMB = (oldSize / 1024 / 1024).toFixed(2)
            const newSizeMB = (newSize / 1024 / 1024).toFixed(2)
            
            console.log('[GenericResourceView] 文件夹大小更新成功:', {
              itemName,
              oldSizeMB,
              newSizeMB
            })
            
            notify.toast(
              'success',
              '更新成功',
              `"${itemName}" 文件夹大小已更新\n旧大小: ${oldSizeMB} MB\n新大小: ${newSizeMB} MB`
            )
          } else {
            const errorMsg = `无法获取 "${itemName}" 的文件夹大小`
            console.log('[GenericResourceView] 文件夹大小计算失败:', errorMsg)
            notify.toast('error', '更新失败', errorMsg)
          }
        } catch (error: any) {
          const itemName = BaseResources.extractPrimitiveValue(item.name?.value || item.name) || '未知'
          const errorMsg = `无法获取 "${itemName}" 的文件夹大小: ${error.message}`
          console.error('[GenericResourceView] 文件夹大小计算异常:', error)
          notify.toast('error', '更新失败', errorMsg)
        }
      }
    }

    // 路径更新对话框相关方法
    const confirmPathUpdate = async () => {
      try {
        const { existingItem, newPath } = resourcePage.pathUpdateInfo.value

        if (!existingItem || !newPath) {
          console.error('[GenericResourceView] 路径更新信息不完整')
          return
        }

        const itemName = BaseResources.extractPrimitiveValue(existingItem.name?.value || existingItem.name)
        const oldPath = BaseResources.extractPrimitiveValue(
          existingItem.resourcePath?.value || existingItem.executablePath?.value || existingItem.resourcePath || existingItem.executablePath
        )
        console.log(`[GenericResourceView] 更新资源 "${itemName}" 的路径:`)
        console.log(`旧路径: ${oldPath}`)
        console.log(`新路径: ${newPath}`)

        // 更新资源路径
        if (existingItem.resourcePath && typeof existingItem.resourcePath === 'object' && 'value' in existingItem.resourcePath) {
          existingItem.resourcePath.value = newPath
        } else if (existingItem.executablePath && typeof existingItem.executablePath === 'object' && 'value' in existingItem.executablePath) {
          existingItem.executablePath.value = newPath
        } else {
          existingItem.resourcePath = newPath
          existingItem.executablePath = newPath
        }
        
        if (existingItem.fileExists && typeof existingItem.fileExists === 'object' && 'value' in existingItem.fileExists) {
          existingItem.fileExists.value = true
        } else {
          existingItem.fileExists = true
        }

        // 重新计算文件夹大小（如果资源类型支持）
        if (isElectronEnvironment.value && window.electronAPI && window.electronAPI.getFolderSize) {
          try {
            const result = await window.electronAPI.getFolderSize(newPath)
            if (result.success) {
              if (existingItem.folderSize && typeof existingItem.folderSize === 'object' && 'value' in existingItem.folderSize) {
                existingItem.folderSize.value = result.size
              } else {
                existingItem.folderSize = result.size
              }
              console.log(`[GenericResourceView] 资源 ${itemName} 文件夹大小: ${result.size} 字节`)
            }
          } catch (error) {
            console.error('[GenericResourceView] 获取文件夹大小失败:', error)
          }
        }

        // 保存更新后的数据
        await saveData()

        // 关闭对话框
        resourcePage.closePathUpdateDialog()

        // 显示成功通知
        notify.toast(
          'success',
          '路径更新成功',
          `资源 "${itemName}" 的路径已更新`
        )

        console.log(`[GenericResourceView] 资源 "${itemName}" 路径更新完成`)

      } catch (error: any) {
        console.error('[GenericResourceView] 更新资源路径失败:', error)
        notify.toast('error', '更新失败', `更新资源路径失败: ${error.message}`)
      }
    }

    // 强制结束程序确认对话框相关方法
    const closeTerminateConfirmDialog = () => {
      showTerminateConfirmDialog.value = false
      resourceToTerminate.value = null
    }

    const confirmTerminateGame = async () => {
      if (resourceToTerminate.value) {
        await terminateGame(resourceToTerminate.value)
        closeTerminateConfirmDialog()
      }
    }

    // 计算属性：获取终止资源的名称
    const terminateResourceName = computed(() => {
      if (!resourceToTerminate.value) return ''
      return BaseResources.extractPrimitiveValue(
        resourceToTerminate.value.name?.value || resourceToTerminate.value.name
      ) || '未知资源'
    })

    // 路径更新对话框的计算属性（根据资源类型动态生成）
    const pathUpdateDialogTitle = computed(() => {
      const itemType = pageConfig.value?.name || '资源'
      return `更新${itemType}路径`
    })

    const pathUpdateDialogDescription = computed(() => {
      const itemType = pageConfig.value?.name || '资源'
      return `发现同名但路径不同的${itemType}文件：`
    })

    const pathUpdateItemNameLabel = computed(() => {
      const itemType = pageConfig.value?.name || '资源'
      return `${itemType}名称`
    })

    const pathUpdateItemName = computed(() => {
      const existingItem = resourcePage.pathUpdateInfo.value.existingItem
      if (!existingItem) return ''
      return BaseResources.extractPrimitiveValue(existingItem.name?.value || existingItem.name) || ''
    })

    const pathUpdateOldPath = computed(() => {
      const existingItem = resourcePage.pathUpdateInfo.value.existingItem
      if (!existingItem) return ''
      return BaseResources.extractPrimitiveValue(
        existingItem.resourcePath?.value || existingItem.executablePath?.value || existingItem.resourcePath || existingItem.executablePath
      ) || ''
    })

    const pathUpdateNewPath = computed(() => {
      return resourcePage.pathUpdateInfo.value.newPath || ''
    })

    const pathUpdateMissingLabel = computed(() => '文件丢失')
    const pathUpdateFoundLabel = computed(() => '文件存在')
    const pathUpdateQuestion = computed(() => '是否要更新路径？')

    // 图片缓存 composable（服务于游戏截图浏览）
    // 注意：ComicViewer 已移除，因此不再传入 isComicViewer（useImageCache 内部默认 ref(false)）
    const imageCacheComposable = useImageCache({
      enableThumbnails: true,
      jpegQuality: 80,
      thumbnailSize: 200,
      maxCacheSize: 50 * 1024 * 1024, // 50MB
      preloadCount: 3,
      isDetailModal: showDetailModal,
      pages: detailPages
    })

    // 使用工厂函数创建资源页面（简化版）
    const resourcePage = createResourcePage({
      pageConfig: {
        pageType: pageConfig.value?.id || 'games',
        itemType: pageConfig.value?.name || '资源',
        defaultPageSize: pageConfig.value?.defaultPageSize || 20
      },
      items: items,
      filteredItems: filteredItems,
      searchQuery: searchQuery,
      sortBy: sortBy,
      crudConfig: {
        items: items,
        onAdd: async (data: any) => {
          const newItem = new ResourceClass()
          console.log('[GenericResourceView] onAdd 开始 - data:', data)
          console.log('[GenericResourceView] onAdd 开始 - newItem 初始 id:', newItem.id?.value)
          
          for (const key in data) {
            if (key in newItem) {
              const field = (newItem as any)[key]
              if (field && typeof field === 'object' && 'value' in field) {
                field.value = BaseResources.extractPrimitiveValue(data[key])
              } else {
                (newItem as any)[key] = data[key]
              }
            }
          }
          
          console.log('[GenericResourceView] onAdd 处理后 - newItem.id.value:', newItem.id?.value)
          
          // 处理封面：保存到 cover 文件夹
          const resourceId = BaseResources.extractPrimitiveValue(newItem.id?.value || newItem.id)
          if (resourceId) {
            console.log('[GenericResourceView] 准备处理封面...')
            const processedItem = await coverManager.processCoverForResource(newItem, resourceType.value, resourceId)
            if (processedItem) {
              Object.assign(newItem, processedItem)
              console.log('[GenericResourceView] 封面处理完成')
            }
          }
          
          // 如果资源有 folderSize 字段配置，自动计算大小
          const cardConfig = newItem.constructor?.cardDisplayConfig || 
                           (typeof newItem.constructor?.getCardDisplayConfig === 'function' 
                             ? newItem.constructor.getCardDisplayConfig() 
                             : null)
          if (cardConfig?.badge?.field === 'folderSize' && isElectronEnvironment.value) {
            await calculateAndUpdateResourceSize(
              newItem, 
              isElectronEnvironment.value, 
              resourceType.value === 'Game' // 游戏类型计算文件夹大小
            )
          }
          
          items.value.push(newItem)
          
          // 保存数据
          await saveData()
          
          return newItem
        },
        onUpdate: async (id: string, updates: any) => {
          const item = items.value.find((i: any) => (i.id?.value || i.id) === id)
          if (item) {
            // 更新 ResourceField 的值（而不是直接覆盖对象）
            Object.keys(updates).forEach(key => {
              if (item[key] && typeof item[key] === 'object' && 'value' in item[key]) {
                // 是 ResourceField，更新 value
                item[key].value = BaseResources.extractPrimitiveValue(updates[key])
              } else {
                // 不是 ResourceField，直接赋值（如 folderSize, playTime 等额外字段）
                item[key] = updates[key]
              }
            })
            
            // 处理封面：如果封面字段被更新了，保存到 cover 文件夹
            const hasCoverUpdate = ['coverPath', 'cover', 'thumbnail', 'thumbnailPath'].some(
              field => updates[field] !== undefined
            )
            if (hasCoverUpdate) {
              console.log('[GenericResourceView] 封面已更新，准备处理封面...')
              const resourceId = BaseResources.extractPrimitiveValue(item.id?.value || item.id)
              if (resourceId) {
                const processedItem = await coverManager.processCoverForResource(item, resourceType.value, resourceId)
                if (processedItem) {
                  Object.assign(item, processedItem)
                  console.log('[GenericResourceView] 封面处理完成')
                }
              }
            }
            
            // 仅当更新了 resourcePath、且当前没有 folderSize 数据时才计算大小（不覆盖已有值）
            if (updates.resourcePath && isElectronEnvironment.value) {
              const cardConfig = item.constructor?.cardDisplayConfig || 
                               (typeof item.constructor?.getCardDisplayConfig === 'function' 
                                 ? item.constructor.getCardDisplayConfig() 
                                 : null)
              if (cardConfig?.badge?.field === 'folderSize') {
                const folderSize = BaseResources.extractPrimitiveValue(item.folderSize?.value ?? item.folderSize)
                if (folderSize === undefined || folderSize === null) {
                  await calculateAndUpdateResourceSize(
                    item, 
                    isElectronEnvironment.value, 
                    resourceType.value === 'Game' // 游戏类型计算文件夹大小
                  )
                }
              }
            }
            
            // 保存数据
            await saveData()
          }
        },
        onDelete: async (id: string) => {
          const index = items.value.findIndex((i: any) => (i.id?.value || i.id) === id)
          if (index > -1) {
            items.value.splice(index, 1)
            
            // 保存数据
            await saveData()
          }
        },
        onLoad: async () => {
          // 数据已在 onMounted 时加载
        },
        onSave: async () => {
          // 调用统一的保存函数
          await saveData()
        },
        getItemName: (item: any) => item.name?.value || item.name,
        itemType: pageConfig.value?.name || '资源'
      },
      contextMenuHandlers: contextMenuHandlers,
      emptyState: pageConfig.value?.emptyStateConfig || {
        icon: '📄',
        title: '暂无数据',
        description: '点击"添加"按钮添加新项目',
        buttonText: '添加',
        buttonAction: 'showAddDialog'
      },
      toolbar: {
        ...pageConfigLoader.getToolbarConfig(resourceTypeToPageIdMap[resourceType.value]),
        sortOptions: sortOptions.map(option => ({
          id: option.id,
          label: option.label
        }))
      },
      displayLayout: pageConfig.value?.displayLayoutConfig,
      // 不提供 getStats，让 DetailPanel 使用配置生成的数据记录
      // getStats: (item: any) => {
      //   // 简化版统计信息
      //   return [
      //     { label: '名称', value: item.name?.value || item.name || '未知' }
      //   ]
      // },
      // 不提供 getActions，让 DetailPanel 使用默认的 actions（会根据 type 自动生成对应的按钮）
      // getActions: (item: any) => {
      //   return [
      //     { key: 'edit', icon: '✏️', label: '编辑', class: 'btn-edit' },
      //     { key: 'remove', icon: '🗑️', label: '删除', class: 'btn-remove' }
      //   ]
      // }
    })

    // 获取文件存在性状态（辅助函数）
    const getFileExists = (item: any): boolean => {
      if (item.fileExists && typeof item.fileExists === 'object' && 'value' in item.fileExists) {
        return item.fileExists.value !== false
      }
      return item.fileExists !== false
    }

    // 设置文件存在性状态（辅助函数）
    const setFileExists = (item: any, exists: boolean): void => {
      if (item.fileExists && typeof item.fileExists === 'object' && 'value' in item.fileExists) {
        item.fileExists.value = exists
      } else {
        item.fileExists = exists
      }
    }

    // 获取资源文件路径（支持多种字段名）
    const getResourceFilePath = (item: any): string | null => {
      // 尝试不同的路径字段名
      const pathFields = ['resourcePath', 'filePath', 'executablePath']
      for (const field of pathFields) {
        const fieldValue = item[field]
        if (fieldValue) {
          const path = BaseResources.extractPrimitiveValue(fieldValue)
          if (path) return path
        }
      }
      return null
    }

    /**
     * 详情面板 / 右键菜单 共用操作：根据 actionKey 执行对应逻辑，便于复用。
     */
    const handleDetailActionImpl = async (actionKey: string, item: any) => {
      switch (actionKey) {
        case 'launch':
          handleResourceAction(item)
          break
        case 'launchWithLocale':
          handleResourceAction(item, { handlerName: 'launchWithLocale' })
          break
        case 'terminate':
          showTerminateConfirmDialog.value = true
          resourceToTerminate.value = item
          break
        case 'folder': {
          const filePath = getResourceFilePath(item)
          const folderPath = BaseResources.extractPrimitiveValue(item.folderPath?.value ?? item.folderPath)
          const path = filePath || folderPath
          if (!path || !path.trim()) {
            notify.toast('error', '打开失败', '未找到资源路径')
            break
          }
          if (!isElectronEnvironment.value || !window.electronAPI) {
            notify.toast('error', '打开失败', '当前环境不支持')
            break
          }
          if (filePath && window.electronAPI.openFileFolder) {
            window.electronAPI.openFileFolder(filePath).then((result: { success?: boolean; error?: string }) => {
              if (result.success) {
                notify.toast('success', '已打开', '已打开文件所在文件夹')
              } else {
                notify.toast('error', '打开失败', result.error || '未知错误')
              }
            }).catch((err: Error) => {
              notify.toast('error', '打开失败', err.message || '未知错误')
            })
          } else if (folderPath && window.electronAPI.openFolder) {
            window.electronAPI.openFolder(folderPath).then((result: { success?: boolean; error?: string }) => {
              if (result.success) {
                notify.toast('success', '已打开', '已打开文件夹')
              } else {
                notify.toast('error', '打开失败', result.error || '未知错误')
              }
            }).catch((err: Error) => {
              notify.toast('error', '打开失败', err.message || '未知错误')
            })
          } else {
            notify.toast('error', '打开失败', 'API 不可用')
          }
          break
        }
        case 'edit':
          if ((resourcePage as any).showEdit) {
            (resourcePage as any).showEdit(item)
          }
          break
        case 'remove':
          if ((resourcePage as any).deleteItem) {
            (resourcePage as any).deleteItem(item)
          }
          break
        case 'screenshot-folder': {
          const gameId = BaseResources.extractPrimitiveValue(item.id?.value ?? item.id)
          const gameName = BaseResources.extractPrimitiveValue(item.name?.value ?? item.name) ?? ''
          if (!gameId) {
            notify.toast('error', '打开失败', '游戏ID不存在，无法打开截图文件夹')
            break
          }
          if (!isElectronEnvironment.value || !window.electronAPI?.openFolder) {
            notify.toast('error', '打开失败', '当前环境不支持')
            break
          }
          getGameScreenshotFolderPath(gameId, gameName, isElectronEnvironment.value)
            .then(async (gameScreenshotPath) => {
              try {
                if (window.electronAPI?.ensureDirectory) {
                  await window.electronAPI.ensureDirectory(gameScreenshotPath)
                }
                const result = await window.electronAPI!.openFolder(gameScreenshotPath)
                if (result.success) {
                  notify.toast('success', '已打开', `已打开 ${gameName} 的截图文件夹`)
                } else {
                  notify.toast('error', '打开失败', result.error || '未知错误')
                }
              } catch (err: any) {
                notify.toast('error', '打开失败', err.message || '未知错误')
              }
            })
            .catch((err: any) => {
              notify.toast('error', '打开失败', err.message || '未知错误')
            })
          break
        }
        // ===== 视频页动作（播放 / 抽帧封面 / 删除封面 / 打开所在文件夹 / 重新关联）=====
        case 'open':
        case 'grab-cover':
        case 'remove-cover':
        case 'reveal':
        case 'relink': {
          try {
            if (actionKey === 'open') await videoLib.openVideo(item)
            else if (actionKey === 'grab-cover') await videoLib.grabCover(item)
            else if (actionKey === 'remove-cover') await videoLib.deleteCover(item)
            else if (actionKey === 'relink') await videoLib.relinkVideo(item)
            else await videoLib.revealInExplorer(item)
          } catch (error: any) {
            console.error(`[GenericResourceView] 视频动作 ${actionKey} 失败:`, error)
            notify.toast('error', '操作失败', error?.message || '未知错误')
          }
          break
        }
        default:
          break
      }
    }

    // 右键菜单与详情面板复用同一套逻辑：按 key 派发到 handleDetailActionImpl
    contextMenuHandlers.launch = (item: any) => handleDetailActionImpl('launch', item)
    contextMenuHandlers.launchWithLocale = (item: any) => handleDetailActionImpl('launchWithLocale', item)
    contextMenuHandlers.folder = (item: any) => handleDetailActionImpl('folder', item)
    contextMenuHandlers['screenshot-folder'] = (item: any) => handleDetailActionImpl('screenshot-folder', item)
    contextMenuHandlers.terminate = (item: any) => handleDetailActionImpl('terminate', item)
    contextMenuHandlers.edit = (item: any) => handleDetailActionImpl('edit', item)
    contextMenuHandlers.remove = (item: any) => handleDetailActionImpl('remove', item)

    // 视频页：右键 / 详情面板动作（播放、抽帧封面、删封面、打开所在文件夹、重新关联）
    contextMenuHandlers.open = (item: any) => videoLib.openVideo(item)
    contextMenuHandlers['grab-cover'] = (item: any) => videoLib.grabCover(item)
    contextMenuHandlers['remove-cover'] = (item: any) => videoLib.deleteCover(item)
    contextMenuHandlers.reveal = (item: any) => videoLib.revealInExplorer(item)
    // 文件改名/挪走后，由用户手动指认新文件（把选择权交给用户，不自动猜）
    contextMenuHandlers.relink = (item: any) => videoLib.relinkVideo(item)

    contextMenuHandlers.batchAddTag = () => handleBatchAddTag()
    contextMenuHandlers.batchDeleteTag = () => handleBatchDeleteTag()
    contextMenuHandlers.batchDelete = () => handleBatchDelete()
    // 回收站：单条 / 批量「从库中移除记录」（磁盘文件一动不动）
    contextMenuHandlers['remove-record'] = (item: any) => handleRemoveSingleRecord(item)
    contextMenuHandlers.batchRemoveRecords = async () => {
      const targets = items.value.filter((item: any) => selectedItems.value.has(item.id?.value || item.id))
      if (targets.length === 0) {
        notify.toast('warning', '批量移除记录', '请先选择要移除的记录')
        return
      }
      if (!(await confirmRemoveRecords(targets.length))) return
      const removed = await videoLib.removeRecords(targets)
      selectedItems.value.clear()
      isMultiSelectMode.value = false
      refreshFilterData()
      notify.toast('success', '已从库中移除', `${removed} 条记录（磁盘上的文件没有动）`)
    }
    // 视频页：批量抽帧（逐个串行，最后只弹一条汇总）
    contextMenuHandlers.batchGrabCover = async () => {
      const targets = items.value.filter((item: any) => selectedItems.value.has(item.id?.value || item.id))
      if (targets.length === 0) {
        notify.toast('warning', '批量抽帧', '请先选择要操作的视频')
        return
      }
      // 回收站里选中的记录文件都不在了，抽帧必然全失败 —— 提前说清楚
      const alive = targets.filter((item: any) => !isMissingItem(item))
      if (alive.length === 0) {
        notify.toast('warning', '批量抽帧', '选中的文件在磁盘上都已经找不到了（可右键「重新关联到…」先把文件接回来）')
        return
      }
      await videoLib.grabCoverBatch(alive)
    }

    // 通用的文件存在性检查函数
    const checkFileExistence = async (): Promise<void> => {
      if (!isElectronEnvironment.value || !window.electronAPI || !window.electronAPI.checkFileExists) {
        // 如果API不可用，默认设置为存在
        items.value.forEach((item: any) => {
          setFileExists(item, true)
        })
        // 更新筛选器数量
        if (filterComposable.extractAllFilters) {
          filterComposable.extractAllFilters()
          setTimeout(() => {
            const filterData = filterComposable.getFilterData()
            emit('filter-data-updated', filterData)
          }, 100)
        }
        return
      }
      
      let checkedCount = 0
      let missingCount = 0
      
      for (const item of items.value) {
        // 获取文件路径
        const filePath = getResourceFilePath(item)
        
        // 如果没有找到路径，标记为不存在
        if (!filePath) {
          setFileExists(item, false)
          missingCount++
          checkedCount++
          continue
        }
        
        try {
          const result = await window.electronAPI.checkFileExists(filePath)
          const exists = result.exists || false
          
          // 更新 fileExists 字段
          setFileExists(item, exists)
          
          if (!exists) {
            missingCount++
          }
        } catch (error) {
          const itemName = BaseResources.extractPrimitiveValue(item.name?.value || item.name) || '未知资源'
          console.error(`[GenericResourceView] ❌ 检测文件存在性失败: ${itemName}`, error)
          
          // 出错时标记为不存在
          setFileExists(item, false)
          missingCount++
        }
        
        checkedCount++
      }
      
      // 如果有丢失的文件，显示提醒
      if (missingCount > 0) {
        notify.toast('warning', '文件检测完成', `检测到 ${missingCount} 个文件不存在`)
      }
      
      // 更新筛选器数量（特别是"丢失的资源"筛选器）
      if (filterComposable.extractAllFilters) {
        filterComposable.extractAllFilters()
        // 延迟更新筛选器数据，确保数据已提取
        setTimeout(() => {
          const filterData = filterComposable.getFilterData()
          emit('filter-data-updated', filterData)
        }, 100)
      }
    }

    // 自动计算资源大小（仅针对配置了 folderSize 且尚未有数据的资源；有值则不覆盖）
    const calculateResourceSizes = async () => {
      if (!isElectronEnvironment.value) {
        return
      }
      
      const cardConfig = ResourceClass.cardDisplayConfig || 
                        (typeof ResourceClass.getCardDisplayConfig === 'function' 
                          ? ResourceClass.getCardDisplayConfig() 
                          : null)
      if (cardConfig?.badge?.field !== 'folderSize') {
        return
      }
      
      // 筛选：有 resourcePath，且 folderSize 为 undefined、null 或 0 才计算
      const resourcesToCalculate = items.value.filter((item: any) => {
        const resourcePath = BaseResources.extractPrimitiveValue(
          item.resourcePath?.value || item.resourcePath || item.executablePath?.value || item.executablePath
        )
        if (!resourcePath || typeof resourcePath !== 'string' || !resourcePath.trim()) {
          return false
        }
        const folderSize = BaseResources.extractPrimitiveValue(item.folderSize?.value ?? item.folderSize)
        return folderSize === undefined || folderSize === null || folderSize === 0
      })
      
      if (resourcesToCalculate.length === 0) {
        return
      }
      
      const updatedCount = await calculateResourceSizesBatch(
        resourcesToCalculate,
        isElectronEnvironment.value,
        resourceType.value === 'Game' // 游戏类型计算文件夹大小
      )
      if (updatedCount > 0) {
        await saveData()
      }
    }

    // 监听请求更新游戏时长事件（实时更新总时长）
    const handleRequestUpdatePlaytime = (event: CustomEvent) => {
      const { gameId } = event.detail
      const resource = items.value.find((i: any) => (i.id?.value || i.id) === gameId)
      if (resource && gameRunningStore && gameInitialPlayTimes.value) {
        // 如果还没有保存初始值，先保存（第一次更新时）
        if (!gameInitialPlayTimes.value.has(gameId)) {
          const playTimeValue = BaseResources.extractPrimitiveValue(resource.playTime?.value || resource.playTime) || 0
          gameInitialPlayTimes.value.set(gameId, playTimeValue)
        }
        
        // 获取初始 playTime（启动时的值）
        const initialPlayTime = gameInitialPlayTimes.value.get(gameId) || 0
        // 计算当前总时长 = 初始时长 + 会话时长
        const totalPlayTime = gameRunningStore.getCurrentPlayTime(gameId, initialPlayTime)
        // 更新游戏时长（用于显示）
        if (resource.playTime && typeof resource.playTime === 'object' && 'value' in resource.playTime) {
          resource.playTime.value = totalPlayTime
        } else {
          resource.playTime = totalPlayTime
        }
      }
    }
    
    // 监听请求最终游戏时长事件（游戏结束时）
    const handleRequestFinalPlaytime = (event: CustomEvent) => {
      const { gameId } = event.detail
      const resource = items.value.find((i: any) => (i.id?.value || i.id) === gameId)
      if (resource && gameRunningStore && gameInitialPlayTimes.value) {
        // 获取初始 playTime（从保存的初始值获取，如果不存在则使用当前值）
        const currentPlayTime = BaseResources.extractPrimitiveValue(resource.playTime?.value || resource.playTime) || 0
        const initialPlayTime = gameInitialPlayTimes.value.get(gameId) || currentPlayTime
        // 计算最终总时长
        const totalPlayTime = gameRunningStore.getCurrentPlayTime(gameId, initialPlayTime)
        // 更新并保存
        if (resource.playTime && typeof resource.playTime === 'object' && 'value' in resource.playTime) {
          resource.playTime.value = totalPlayTime
        } else {
          resource.playTime = totalPlayTime
        }
        // 清除保存的初始值
        gameInitialPlayTimes.value.delete(gameId)
        
        // 注意：这里不调用保存方法，因为 GenericResourceView 是通用组件，保存逻辑由上层管理
        // 如果需要保存，可以通过事件通知上层组件
      }
    }

    /**
     * 主页「抓阄链路」点卡片跳过来时带着 ?gameId=xxx / ?videoId=xxx：
     * 数据加载完成后自动打开对应资源的详情面板，并立刻把 query 清掉，
     * 免得刷新/返回时又弹一次。找不到就只清 query，不打扰用户。
     *
     * 视频还会顺手把层级切到这条记录所在的目录 —— 关掉详情就能看到它所在的这一层。
     */
    function openDetailFromQuery() {
      const queryGameId = route.query?.gameId
      const queryVideoId = route.query?.videoId
      const wantedId = typeof queryVideoId === 'string' && queryVideoId
        ? queryVideoId
        : (typeof queryGameId === 'string' && queryGameId ? queryGameId : '')
      if (!wantedId) return

      const target = items.value.find((item: any) => {
        const raw = item?.id
        return String(raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw ?? '') === wantedId
      })

      if (target) {
        console.log(`[GenericResourceView] 按链接参数打开详情: id=${wantedId}`)
        // 视频：先把层级切到它所在目录，这样关掉详情面板就能看到上下文
        if (isVideoPage.value) videoLib.focusItem(target)
        resourcePage.showDetail(target)
      } else {
        console.warn(`[GenericResourceView] 链接参数 id=${wantedId} 不在本页数据中，已忽略`)
      }

      const restQuery = { ...route.query }
      delete restQuery.gameId
      delete restQuery.videoId
      router.replace({ path: route.path, query: restQuery }).catch(() => {})
    }

    // 已经停留在本页时 query 变化（例如从主页再次点进来）也要响应
    watch(
      () => [route.query.gameId, route.query.videoId],
      () => {
        openDetailFromQuery()
      }
    )

    // 监听游戏进程结束事件
    onMounted(async () => {
      // 1. 加载页面数据（仅从数据库读取）
      const pageId = pageConfig.value?.id
      if (!pageId) {
        throw new Error('[GenericResourceView] 没有 pageId，无法加载数据')
      }
      isLoadingData.value = true
      try {
        if (!isElectronEnvironment.value || !window.electronAPI || !window.electronAPI.sqliteGetPageData) {
          throw new Error('[GenericResourceView] 不在 Electron 环境或数据库 API 不可用')
        }
        console.log(`[GenericResourceView] ====== 加载数据 ====== pageId="${pageId}", resourceType="${resourceType.value}", ResourceClass=${ResourceClass?.name}`)
        const result = await window.electronAPI.sqliteGetPageData(pageId)
        console.log(`[GenericResourceView] sqliteGetPageData 返回:`, { ok: result?.ok, dataLength: result?.data?.length, message: result?.message })
        if (!result || !result.ok) {
          throw new Error(result?.message || '[GenericResourceView] 获取页面数据失败')
        }
        const loadedData = result.data
        console.log(`[GenericResourceView] loadedData 条数: ${loadedData?.length ?? 0}`, loadedData?.length > 0 ? `首条 keys: ${Object.keys(loadedData[0] || {}).join(',')}` : '')
        if (ResourceClass && ResourceClass.fromJSON) {
          const converted: any[] = []
          for (let i = 0; i < (loadedData?.length || 0); i++) {
            try {
              converted.push(ResourceClass.fromJSON(loadedData[i]))
            } catch (e) {
              console.error(`[GenericResourceView] fromJSON 第 ${i} 条失败:`, loadedData[i], e)
              throw e
            }
          }
          items.value = converted
          console.log(`[GenericResourceView] fromJSON 转换完成，items.length=${items.value.length}`)
        } else {
          items.value = loadedData || []
        }
        if (filterComposable.extractAllFilters) {
          filterComposable.extractAllFilters()
          setTimeout(() => {
            const filterData = filterComposable.getFilterData()
            emit('filter-data-updated', filterData)
          }, 100)
        }
      } catch (error) {
        console.error(`[GenericResourceView] 页面 ${pageId} 数据加载失败:`, error)
        console.error(`[GenericResourceView] 错误堆栈:`, (error as Error)?.stack)
        throw error
      } finally {
        isLoadingData.value = false
      }

      // 2.5 主页抓阄链路跳过来（?gameId=xxx）时，自动打开对应游戏的详情面板
      openDetailFromQuery()

      // 2.6 视频页：数据库记录已就位 → 后台扫描绑定目录做增量同步，并开启实时监听
      if (isVideoPage.value) {
        videoLib.initialize({ silent: true }).then(() => {
          refreshFilterData()
        }).catch((error: any) => {
          console.error('[GenericResourceView] 视频库初始化失败:', error)
        })
      }

      // 3. 加载分页设置
      console.log('[GenericResourceView] 准备加载分页设置', {
        pageId,
        resourceType: resourceType.value,
        currentPageSize: resourcePage.pageSize,
        totalPages: resourcePage.totalPages
      })
      await resourcePage.loadPaginationSettings(pageId)
      console.log('[GenericResourceView] 分页设置加载完成', {
        pageId,
        resourceType: resourceType.value,
        updatedPageSize: resourcePage.pageSize,
        totalPages: resourcePage.totalPages,
        currentPage: resourcePage.currentPage
      })
      
      // 4. 注册事件监听器（游戏进程结束只跟可执行程序有关，视频页跳过）
      if (!isVideoPage.value && isElectronEnvironment.value && window.electronAPI && window.electronAPI.onGameProcessEnded) {
        window.electronAPI.onGameProcessEnded((event: any, data: any) => {
          handleGameProcessEnded(data)
        })
      }

      // 游戏页：注册全局截图快捷键（与 GameView 一致）
      console.log('[GenericResourceView] 截图相关检查:', {
        resourceType: resourceType.value,
        hasTakeScreenshot: !!gameScreenshotComposable?.takeScreenshot,
        isElectron: isElectronEnvironment.value,
        hasOnGlobalScreenshotTrigger: !!(window.electronAPI?.onGlobalScreenshotTrigger),
        hasInitializeGlobalShortcut: !!gameScreenshotComposable?.initializeGlobalShortcut
      })
      if (gameScreenshotComposable?.takeScreenshot && isElectronEnvironment.value && window.electronAPI?.onGlobalScreenshotTrigger) {
        window.electronAPI.onGlobalScreenshotTrigger(() => {
          console.log('[GenericResourceView] 收到 global-screenshot-trigger，执行 takeScreenshot')
          gameScreenshotComposable.takeScreenshot()
        })
        // 向主进程注册截图快捷键（否则按键无反应）
        if (gameScreenshotComposable.initializeGlobalShortcut) {
          gameScreenshotComposable.initializeGlobalShortcut().then(() => {
            console.log('[GenericResourceView] initializeGlobalShortcut 调用完成')
          }).catch((e: any) => {
            console.warn('[GenericResourceView] initializeGlobalShortcut 失败:', e)
          })
          console.log('[GenericResourceView] 已调用 initializeGlobalShortcut')
        } else {
          console.warn('[GenericResourceView] 无 initializeGlobalShortcut，截图键将不会注册')
        }
      } else {
        console.warn('[GenericResourceView] 未注册截图监听，条件不满足')
      }
      
      // 注册游戏时长更新事件监听器（用于实时更新总时长）
      window.addEventListener('game-request-update-playtime', handleRequestUpdatePlaytime as EventListener)
      window.addEventListener('game-request-final-playtime', handleRequestFinalPlaytime as EventListener)
      
      // 启动定时器，定期触发行时长更新（每1秒）（凡使用 launchExecutable 的页面都参与）
      playtimeUpdateTimer = setInterval(() => {
        if (supportsRunningTracking.value) {
          const runningIds = gameRunningStore.runningGameIds
          if (runningIds && runningIds.length > 0) {
            runningIds.forEach((resourceId: string) => {
              const event = new CustomEvent('game-request-update-playtime', {
                detail: { gameId: resourceId }
              })
              window.dispatchEvent(event)
            })
          }
        }
      }, 1000) // 每1秒更新一次
      
      // 组件挂载后自动检查文件存在性
      // 注意：数据加载在前面已经处理了，这里的 items.value 检查是为了处理传入 props.items 的情况
      // 视频页跳过：存在性由「扫描同步」统一负责（逐条 IPC 检查在万级文件下会拖死主进程）
      if (!isVideoPage.value && items.value && items.value.length > 0) {
        await checkFileExistence()
        // 自动计算资源大小
        await calculateResourceSizes()
      }
    })
    
    // 组件卸载前清理事件监听器
    onBeforeUnmount(() => {
      // 视频页：停掉目录监听（外部播放统计由主进程的 PotStats 挂载常驻，不随页面走）
      if (isVideoPage.value) {
        videoLib.dispose().catch((error: any) => {
          console.warn('[GenericResourceView] 视频库资源释放失败:', error)
        })
      }
      window.removeEventListener('game-request-update-playtime', handleRequestUpdatePlaytime as EventListener)
      window.removeEventListener('game-request-final-playtime', handleRequestFinalPlaytime as EventListener)
      // 清理定时器
      if (playtimeUpdateTimer) {
        clearInterval(playtimeUpdateTimer)
        playtimeUpdateTimer = null
      }
      // 游戏页：移除全局截图监听
      if (isElectronEnvironment.value && window.electronAPI?.removeGlobalScreenshotListener) {
        window.electronAPI.removeGlobalScreenshotListener()
      } else if (isElectronEnvironment.value && window.electronAPI?.removeAllListeners) {
        window.electronAPI.removeAllListeners('global-screenshot-trigger')
      }
    })


    // 监听 items 变化，当数据更新时自动检查文件存在性和计算大小
    watch(
      () => items.value.length,
      async (newLength, oldLength) => {
        // 视频页：存在性/大小都由扫描结果维护，这里不做逐条 IPC 检查
        if (isVideoPage.value) return
        // 只在数据从空变为有数据，或者数据数量变化时检查
        if (newLength > 0 && (oldLength === 0 || newLength !== oldLength)) {
          // 延迟一点执行，确保数据已经更新完成
          await new Promise(resolve => setTimeout(resolve, 100))
          await checkFileExistence()
          await calculateResourceSizes()
        }
      },
      { immediate: false }
    )
    
    // 详情面板类型（计算属性）- 完全从资源的配置中读取
    const detailPanelType = computed(() => {
      // 从当前选中资源的配置中读取
      if (resourcePage.selectedItem.value) {
        const selectedItem = resourcePage.selectedItem.value
        const ResourceClass = selectedItem.constructor
        const config = ResourceClass?.detailPanelConfig
        
        // 如果配置中有 type 字段，使用配置的 type
        if (config?.type) {
          return config.type
        }
      }
      
      // 如果配置中没有 type，返回默认值（DetailPanel 需要 type prop）
      return 'game'
    })
    
    // 计算是否应该显示预览（从配置的 previewArea 读取：useSelfFolder = 资源自身文件夹，useScreenshotFolder = 游戏截图文件夹）
    const shouldShowPreview = computed(() => {
      if (!resourcePage.selectedItem.value) return false
      const selectedItem = resourcePage.selectedItem.value
      const ResourceClass = selectedItem.constructor
      const config = ResourceClass?.detailPanelConfig
      const area = config?.previewArea
      return area === 'useSelfFolder' || area === 'useScreenshotFolder'
    })

    // 监听详情面板显示，同步 showDetailModal（完全复刻 ImageView.vue）
    watch(
      () => resourcePage.showDetailDialog.value,
      (showDetail) => {
        showDetailModal.value = showDetail
      }
    )
    
    // 监听详情面板显示，加载预览内容
    // （Game 的 previewArea = 'useScreenshotFolder'：从游戏截图目录读取图片列表供浏览）
    watch(
      () => [resourcePage.showDetailDialog.value, resourcePage.selectedItem.value],
      async ([showDetail, selectedItem]) => {
        if (showDetail && selectedItem) {
          const ResourceClass = selectedItem.constructor
          const config = ResourceClass?.detailPanelConfig
          const previewArea = config?.previewArea

          // useSelfFolder = 资源自身文件夹 / useScreenshotFolder = 游戏截图文件夹
          const shouldLoad = previewArea === 'useSelfFolder' || previewArea === 'useScreenshotFolder'
          if (shouldLoad) {
            try {
              detailPages.value = []
              imagePagesComposable.resetPagination()
              
              try {
                if (imagePagesComposable.loadImageSettings && typeof imagePagesComposable.loadImageSettings === 'function') {
                  await imagePagesComposable.loadImageSettings()
                }
              } catch (error) {
                console.warn('[GenericResourceView] 加载图片设置失败:', error)
              }
              
              let files: string[] = []
              if (isElectronEnvironment.value && window.electronAPI) {
                if (previewArea === 'useSelfFolder') {
                  const resourcePath = BaseResources.extractPrimitiveValue(
                    selectedItem.resourcePath?.value || selectedItem.resourcePath
                  )
                  if (resourcePath) {
                    if (/\.(cbz|zip)$/i.test(resourcePath) && window.electronAPI.listImageFilesInArchive) {
                      const resp = await window.electronAPI.listImageFilesInArchive(resourcePath)
                      if (resp.success && Array.isArray(resp.files) && resp.files.length > 0) {
                        const base = `archive:///${resourcePath.replace(/\\/g, '/')}`
                        files = resp.files.map((entry: string) => `${base}#${encodeURIComponent(entry)}`)
                      }
                    } else if (window.electronAPI.listImageFiles) {
                      const resp = await window.electronAPI.listImageFiles(resourcePath)
                      if (resp.success) files = resp.files || []
                    }
                  }
                } else if (previewArea === 'useScreenshotFolder' && window.electronAPI?.listImageFiles) {
                  const gameId = BaseResources.extractPrimitiveValue(selectedItem.id?.value ?? selectedItem.id)
                  const gameName = BaseResources.extractPrimitiveValue(selectedItem.name?.value ?? selectedItem.name) ?? ''
                  if (gameId) {
                    const screenshotFolderPath = await getGameScreenshotFolderPath(gameId, gameName, isElectronEnvironment.value)
                    const resp = await window.electronAPI.listImageFiles(screenshotFolderPath)
                    if (resp.success) files = resp.files || []
                  }
                }
              }
              detailPages.value = files
              imagePagesComposable.updateTotalPages()
              
              if (selectedItem.pagesCount && typeof selectedItem.pagesCount === 'object' && 'value' in selectedItem.pagesCount) {
                selectedItem.pagesCount.value = files.length
              } else if (selectedItem.pagesCount !== undefined) {
                selectedItem.pagesCount = files.length
              }
            } catch (error) {
              console.error('[GenericResourceView] 加载图片列表失败:', error)
            }
          }
        } else if (!showDetail) {
          // 关闭详情时清空图片列表
          detailPages.value = []
        }
      },
      { immediate: false }
    )
    
    // 注意：resolveImage 和 handleImageError 来自 imageCacheComposable（通过 ...imageCacheComposable 展开）
    // 不需要单独定义，完全复刻 ImageView.vue 的方式
    
    // 处理截图/图片点击
    // ⚠️ 原实现是打开应用内的 ComicViewer 全屏查看器；ComicViewer 已随「图片/漫画」功能一并移除，
    //    因此这里改为调用系统默认看图程序打开该图片，以保住「点击缩略图放大查看」这一能力。
    //    如需恢复应用内全屏查看，需恢复 src/components/ComicViewer.vue 并在此重新接上。
    const handleDetailPageClick = async (index: number) => {
      // 计算实际索引（考虑分页，使用 composable 的 detailCurrentPageStartIndex）
      const actualIndex = imagePagesComposable.detailCurrentPageStartIndex.value + index
      const pagePath = detailPages.value[actualIndex]
      const selectedItem = resourcePage.selectedItem.value

      // 记录浏览（与 GRM 原行为一致：查看预览图会写入 visitedSessions）
      if (selectedItem) {
        try {
          const resourceId = BaseResources.extractPrimitiveValue(selectedItem.id?.value || selectedItem.id)
          const item = items.value.find((i: any) => (i.id?.value || i.id) === resourceId)
          if (item) {
            const now = new Date().toISOString()
            if (item.visitedSessions != null && typeof item.visitedSessions === 'object' && 'value' in item.visitedSessions) {
              const sessions = Array.isArray(item.visitedSessions.value) ? item.visitedSessions.value : []
              item.visitedSessions.value = [...sessions, now]
            } else if (Array.isArray(item.visitedSessions)) {
              item.visitedSessions = [...item.visitedSessions, now]
            } else {
              item.visitedSessions = [now]
            }
            await saveData()
          }
        } catch (error) {
          console.warn('[GenericResourceView] 更新浏览信息失败:', error)
        }
      }

      // 用系统默认看图程序打开该截图
      if (pagePath && isElectronEnvironment.value && window.electronAPI?.openExternal) {
        try {
          const res = await window.electronAPI.openExternal(pagePath)
          if (!res?.success) {
            notify.toast('error', '打开失败', res?.error || '无法打开该截图')
          }
        } catch (error: any) {
          notify.toast('error', '打开失败', error?.message || '无法打开该截图')
        }
      }
    }
    
    // 处理分页变化
    const handleDetailPageChange = (page: number) => {
      imagePagesComposable.jumpToPageGroup(page)
    }

    // FunGrid 布局相关计算属性
    const displayLayoutConfig = pageConfig.value?.displayLayoutConfig || { minWidth: 200, maxWidth: 400 }

    const displayLayoutBaseWidth = computed(() => {
      // 使用 maxWidth 作为基础宽度，如果没有则使用默认值
      return displayLayoutConfig.maxWidth || 400
    })

    const displayLayoutMinWidth = computed(() => {
      // 使用 minWidth 作为最小缩放宽度
      return displayLayoutConfig.minWidth || 100
    })

    const displayLayoutMaxWidth = computed(() => {
      // 使用 maxWidth 作为最大缩放宽度
      return displayLayoutConfig.maxWidth || undefined
    })

    // 从 layoutStyles 中提取额外的样式（如 justifyContent）
    const customLayoutStyle = computed(() => {
      const layoutStyles = (resourcePage as any).layoutStyles
      if (!layoutStyles) return undefined
      
      const custom: Record<string, string> = {}
      // layoutStyles 是 computed，需要访问 .value
      const styles = layoutStyles.value || layoutStyles
      
      if (styles && typeof styles === 'object' && 'justifyContent' in styles) {
        custom.justifyContent = styles.justifyContent as string
      }
      return Object.keys(custom).length > 0 ? custom : undefined
    })

    // 处理灵活工具栏按钮点击
    const handleButtonClick = async (item: any) => {
      console.log('🔘 GenericResourceView 收到按钮点击:', item)
      
      // 支持直接调用 showAddDialogHandler 和其他预设方法
      if (item.action === 'showAddDialog') {
        resourcePage.showAddDialogHandler()
      } else if (item.action === 'filterBySearch') {
        // 搜索操作不需要额外处理，搜索框已经绑定了 searchQuery
      } else if (item.action === 'bindVideoFolder') {
        // 视频页：绑定文件夹（自动递归扫描）
        await videoLib.bindFolder()
        refreshFilterData()
      } else if (item.action === 'rescanVideoLibrary') {
        // 视频页：手动重新扫描（实时监听不可用时的兜底）
        await videoLib.rescan()
        refreshFilterData()
      } else if (item.action === 'batchLatestScreenshotCover') {
        // 全局：给当前页所有无封面的游戏装载「最新截图」作为封面
        await handleBatchLatestScreenshotCover()
      } else if (item.action === 'showBatchImportDialog') {
        // 批量导入本地资源
        if (!isElectronEnvironment.value || !window.electronAPI) {
          notify.toast('error', '操作失败', '当前环境不支持此功能')
          return
        }

        try {
          // 选择文件夹
          const folderResult = await window.electronAPI.selectFolder()
          if (!folderResult.success || !folderResult.path) {
            console.log('[GenericResourceView] 用户取消选择文件夹或选择失败')
            return
          }

          // 获取当前页面支持的资源类型
          const pageResourceTypes = pageConfig.value?.resourceTypes || [resourceType.value]

          // 收集所有匹配的扩展名
          let allAcceptedExtensions: string[] = []
          pageResourceTypes.forEach((resType: string) => {
            const config = resourceClassMap[resType]
            if (config && config.resourceClass && config.resourceClass.acceptedExtensions) {
              allAcceptedExtensions = [...allAcceptedExtensions, ...config.resourceClass.acceptedExtensions]
            }
          })

          // 去重
          allAcceptedExtensions = [...new Set(allAcceptedExtensions)]

          // 使用新的 API 递归搜索匹配的文件
          const searchResult = await window.electronAPI.searchMatchingFiles(folderResult.path, allAcceptedExtensions)
          if (!searchResult.success) {
            notify.toast('error', '搜索文件失败', searchResult.error || '未知错误')
            return
          }

          const matchedFiles = searchResult.files || []
          
          // 设置文件列表和文件夹路径并显示对话框
          batchImportFiles.value = matchedFiles
          batchImportFolderPath.value = folderResult.path
          showBatchImportDialog.value = true
        } catch (error: any) {
          console.error('[GenericResourceView] 批量导入失败:', error)
          notify.toast('error', '操作失败', error.message || '未知错误')
        }
      }
    }

    // 关闭批量导入对话框
    const closeBatchImportDialog = () => {
      showBatchImportDialog.value = false
      batchImportFiles.value = []
      batchImportFolderPath.value = ''
    }

    // 处理批量导入确认
    const handleBatchImportConfirm = async (selectedFiles: string[], folderPath: string) => {
      if (selectedFiles.length === 0) {
        notify.toast('warning', '提示', '请至少选择一个文件')
        return
      }

      try {
        let addedCount = 0
        let failedCount = 0

        // 获取当前页面支持的资源类型
        const pageResourceTypes = pageConfig.value?.resourceTypes || [resourceType.value]

        for (const relativeFilePath of selectedFiles) {
          // 拼接完整路径
          const fullFilePath = folderPath + (folderPath.endsWith('\\') || folderPath.endsWith('/') ? '' : '/') + relativeFilePath
          const fileName = relativeFilePath.split(/[\\/]/).pop() || ''

          // 获取文件扩展名
          const lowerFileName = fileName.toLowerCase()
          const fileExt = lowerFileName.includes('.') 
            ? '.' + lowerFileName.split('.').pop() 
            : ''

          // 匹配资源类型
          let matchedResourceType: string | null = null
          let MatchedResourceClass: any = null
          
          for (const resType of pageResourceTypes) {
            const config = resourceClassMap[resType]
            if (!config) continue
            
            const ResourceClassToCheck = config.resourceClass
            const acceptedExtensions = ResourceClassToCheck.acceptedExtensions || []
            
            // 检查文件扩展名是否匹配
            if (acceptedExtensions.some((ext: string) => ext.toLowerCase() === fileExt)) {
              matchedResourceType = resType
              MatchedResourceClass = ResourceClassToCheck
              break
            }
          }

          if (!matchedResourceType || !MatchedResourceClass) {
            failedCount++
            continue
          }

          // 创建资源数据
          const resourceData: any = {
            id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            resourceType: 'game', // GreenGameVault 仅保留游戏类型
            name: extractNameFromPath(fileName),
            description: '',
            tags: [],
            resourcePath: fullFilePath,
            coverPath: '',
            folderSize: 0,
            playTime: 0,
            playCount: 0,
            visitedSessions: [],
            addedDate: new Date().toISOString(),
            fileExists: true
          }

          // 获取文件大小
          if (isElectronEnvironment.value && window.electronAPI) {
            if (window.electronAPI.getFileStats) {
              const result = await window.electronAPI.getFileStats(fullFilePath)
              if (result.success && result.size) {
                resourceData.folderSize = result.size
              }
            } else if (window.electronAPI.getFolderSize) {
              const result = await window.electronAPI.getFolderSize(fullFilePath)
              if (result.success) {
                resourceData.folderSize = result.size
              }
            }
          }

          // 使用匹配到的资源类创建实例
          const resource = MatchedResourceClass.fromJSON(resourceData)
          
          // 检查是否已存在相同路径
          const existingItem = items.value.find((item: any) => {
            const itemPath = BaseResources.extractPrimitiveValue(
              item.resourcePath?.value || item.resourcePath
            )
            return itemPath === fullFilePath
          })

          if (existingItem) {
            failedCount++
            continue
          }

          // 添加到列表
          items.value.push(resource)
          addedCount++
        }

        // 保存数据
        if (addedCount > 0) {
          await saveData()
        }

        // 显示通知
        if (addedCount > 0 || failedCount > 0) {
          notify.toast(
            addedCount > 0 ? 'success' : 'warning',
            addedCount > 0 ? '导入成功' : '导入结果',
            addedCount > 0 
              ? `成功导入 ${addedCount} 个资源${failedCount > 0 ? `，${failedCount} 个失败` : ''}`
              : `没有资源被导入（${failedCount} 个失败）`
          )
        }

        // 关闭对话框
        closeBatchImportDialog()
      } catch (error: any) {
        console.error('[GenericResourceView] 批量导入确认失败:', error)
        notify.toast('error', '导入失败', error.message || '未知错误')
      }
    }

    /* ------------------------------------------------------------------ */
    /* 视频页专属：层级浏览 UI + 空状态                                  */
    /* ------------------------------------------------------------------ */
    /** 面包屑（视频页） */
    const videoBreadcrumb = videoLib.breadcrumb
    /** 当前层的文件夹卡片（视频页） */
    const videoFolderCards = videoLib.folderCards

    /**
     * 当前是否有生效中的搜索/筛选。
     * 这决定空状态该说「没找到匹配」还是「这一层本来就没有」。
     *
     * ⚠️ 「丢失的文件」这一项不算：它是"进回收站"的开关，不是筛选条件。
     *    不排掉的话，回收站里永远会被判成"有筛选生效"，空状态文案就永远是"没找到匹配"。
     */
    const hasActiveSearchOrFilter = computed(() => {
      if (String(searchQuery.value || '').trim() !== '') return true
      const states = (filterComposable as any).filterStates || {}
      return Object.keys(states).some(key => {
        if (key === 'missing-resources') return false
        const state = states[key]
        return (state?.selected?.value?.length || 0) > 0 || (state?.excluded?.value?.length || 0) > 0
      })
    })

    /**
     * 空状态覆盖（只给视频页用；返回 undefined 表示「交给 BaseView 原逻辑」，返回 null 表示「不显示」）
     *
     * 修的坑（主人 2026-10-04 反馈）：某一层**只有文件夹、没有视频**时，
     * BaseView 只看「items 有值但 filteredItems 为空」，于是弹出一块
     * 「没有找到匹配的视频 / 尝试使用不同的搜索词」盖在文件夹卡片上 —— 明明是正常的目录层。
     *
     * 后来又补了回收站（主人 2026-10-05）：丢了东西时别再说"这一层没有视频"。
     */
    const emptyStateOverride = computed(() => {
      if (!isVideoPage.value) return undefined

      // ===== 回收站 =====
      if (isRecycleBinMode.value) {
        if (filterComposable.filteredGames.value.length > 0) return null
        if (visibleFolderCards.value.length > 0) return null
        if (hasActiveSearchOrFilter.value) {
          return {
            icon: '🔍',
            title: '回收站里没有匹配的文件',
            description: '换个搜索词，或把左栏的标签筛选清掉再试',
            showButton: false
          }
        }
        if (videoLib.missingItems.value.length > 0) {
          return {
            icon: '♻️',
            title: '这一层没有丢失的文件',
            description: showFolderCards.value
              ? '丢失的文件按"原来的目录"分组，点上方面包屑回到上一层看看'
              : '文件夹卡片被你隐藏了；先点上方「📁 文件夹」把它们显示出来，就能看到按原目录分组的丢失文件',
            showButton: false
          }
        }
        return {
          icon: '✅',
          title: '回收站是空的',
          description: '没有文件丢失。主视图只会显示磁盘上真实存在的视频；被改名/移动/删除的文件会落在这里，右键文件夹可以整夹重新关联回来',
          showButton: false
        }
      }

      // 有搜索/筛选：没结果才是真的「没找到」
      if (hasActiveSearchOrFilter.value) {
        if (filterComposable.filteredGames.value.length > 0) return null
        if (visibleFolderCards.value.length > 0) return null // 还有对得上的文件夹可钻
        return {
          icon: '🔍',
          title: '没有找到匹配的视频',
          description: '支持空格分词与模糊匹配（比如「第二 改名」「第二部改名」都能搜到 第二部_改名了.mkv）',
          showButton: false
        }
      }

      // 一个目录都没绑：引导绑定
      if (!videoLib.hasRoots.value) {
        return {
          icon: '🎬',
          title: '还没有绑定视频文件夹',
          description: '点击「绑定文件夹」后会自动递归扫描其中的视频（含子文件夹）；本页只做标签与封面管理',
          showButton: true,
          buttonText: '绑定文件夹',
          onAction: 'bindVideoFolder'
        }
      }

      // 这一层有文件夹卡片：让文件夹自己说话，别用「没找到」盖住
      if (visibleFolderCards.value.length > 0) return null
      if (!showFolderCards.value && videoLib.folderCards.value.length > 0) return null // 用户主动隐藏了文件夹

      // 这一层真的什么都没有（没视频也没子文件夹）
      if (videoLib.scopedItems.value.length === 0) {
        // 但子树里可能有"丢了的文件"——顺手指路到回收站，别让用户以为文件凭空没了
        if (videoLib.missingItems.value.length > 0) {
          return {
            icon: '♻️',
            title: '这一层没有视频了',
            description: `这棵目录树里有 ${videoLib.missingItems.value.length} 个文件在磁盘上已经找不到了；左栏点「丢失的文件」进回收站看看，右键文件夹可以整夹重新关联回来`,
            showButton: false
          }
        }
        return {
          icon: '📂',
          title: '这一层没有视频',
          description: '往上一层看看，或者点上方面包屑回到别的目录',
          showButton: false
        }
      }

      return null
    })

    /* --------------------- 视频页：文件夹在筛选/搜索下的可见性 --------------------- */

    /** 是否显示文件夹卡片（本地偏好，默认显示） */
    const SHOW_FOLDERS_STORAGE_KEY = 'ggv-video-show-folders'
    const showFolderCards = ref(true)
    // 记住上次的选择
    try {
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(SHOW_FOLDERS_STORAGE_KEY) : null
      if (saved === '0') showFolderCards.value = false
    } catch (_) {
      // 忽略
    }

    /** 左栏「标签筛选」当前选中的 include / exclude（文件夹并集判定要用） */
    const activeTagFilter = computed(() => {
      const state = (filterComposable as any).filterStates?.tags
      return {
        include: [...(state?.selected?.value || [])] as string[],
        exclude: [...(state?.excluded?.value || [])] as string[]
      }
    })

    /** 某条视频是否命中当前搜索（与页面搜索用同一套字段与匹配规则） */
    const matchVideoByQuery = (item: any) => {
      const query = String(searchQuery.value || '').trim()
      if (!query) return true
      const fields: string[] = ResourceClass?.searchFields || ['name']
      const texts = fields.flatMap(field => collectSearchTexts(item?.[field]))
      return matchesFuzzy(texts, query)
    }

    /** 取某条视频所在目录（相对根目录；根下为 ''） */
    const folderPathOfVideo = (item: any): string => {
      const rel = String(BaseResources.extractPrimitiveValue(item?.relPath) || '')
      const index = rel.lastIndexOf('/')
      return index > 0 ? rel.slice(0, index) : ''
    }

    /** 取某条视频的标签 */
    const tagsOfVideo = (item: any): string[] => {
      const raw = BaseResources.extractPrimitiveValue(item?.tags)
      return Array.isArray(raw) ? raw.filter((tag: unknown): tag is string => typeof tag === 'string' && tag !== '') : []
    }

    /**
     * 某个文件夹卡片**子树**里的视频。
     *  - folder 卡片：rootPath 相同、且所在目录在卡片 rel 之下（含自身）
     *  - root 卡片：rootPath 相同（整棵根目录树）
     *  - missing 卡片：回收站里按"原目录"重建的树，同样按子树算
     *
     * 2026-10-05 改：原来是"只看直接子级"，于是
     *   「搜索命中的视频在更深一层」时上层文件夹会被隐藏，「只有子文件夹」的目录层左栏也是空的。
     *   口径与 collectFolderTags（标签并集）保持一致，都按子树。
     */
    const videosInsideFolder = (folder: any): any[] => {
      if (!folder) return []
      if (folder.kind === 'missing') {
        const rel = folder.rel || ''
        return videoLib.missingItems.value.filter((item: any) => {
          const itemRel = videoLib.relativeFolderOf(item)
          return itemRel === rel || itemRel.startsWith(rel + '/')
        })
      }
      const rootKey = pathKeyOf(folder.root)
      return (items.value || []).filter((item: any) => {
        if (isMissingItem(item)) return false // 主视图的文件夹只由真实存在的文件撑起来
        const itemRoot = String(BaseResources.extractPrimitiveValue(item?.rootPath) || '')
        if (pathKeyOf(itemRoot) !== rootKey) return false
        return folderContainsVideo(folder.rel || '', folderPathOfVideo(item))
      })
    }

    /** 实际显示给用户看的文件夹卡片（受标签筛选 / 搜索 / 「显示文件夹」开关影响） */
    const visibleFolderCards = computed(() => {
      if (!isVideoPage.value) return []
      if (!showFolderCards.value) return []

      const source = isRecycleBinMode.value ? videoLib.recycleFolderCards.value : videoLib.folderCards.value
      return filterVisibleFolders(source, {
        query: String(searchQuery.value || '').trim(),
        tagFilter: activeTagFilter.value,
        matchVideo: matchVideoByQuery,
        tagsOfVideo,
        videosInsideOf: videosInsideFolder
      })
    })

    /* --------------------- 视频页：回收站（丢失的文件）UI --------------------- */

    /** 回收站当前钻到的层级（相对当前浏览层） */
    const videoRecycleRel = videoLib.recycleRel

    /** 回收站面包屑（「丢失的文件 › 原目录 › …」） */
    const recycleBreadcrumb = computed<Array<{ label: string, rel: string }>>(() => {
      const rel = videoLib.recycleRel.value
      if (!rel) return []
      const segments = rel.split('/').filter(Boolean)
      let acc = ''
      return segments.map(segment => {
        acc = acc ? `${acc}/${segment}` : segment
        return { label: segment, rel: acc }
      })
    })

    /** 当前范围内丢失文件的总数（左栏计数 / 回收站提示用） */
    const missingVideoCount = computed(() => videoLib.missingItems.value.length)

    /** 回收站面包屑跳转（rel === '' 表示回到"丢失的文件"顶层） */
    const handleRecycleCrumb = (crumb: { rel: string }) => {
      videoLib.setRecycleRel(crumb?.rel || '')
    }

    /** 「显示文件夹」开关（记在本地） */
    const toggleShowFolderCards = () => {
      showFolderCards.value = !showFolderCards.value
      try {
        localStorage.setItem(SHOW_FOLDERS_STORAGE_KEY, showFolderCards.value ? '1' : '0')
      } catch (error) {
        console.warn('[GenericResourceView] 保存「显示文件夹」失败:', error)
      }
    }
    const videoIsScanning = videoLib.isScanning
    const videoWatcherHealthy = videoLib.watcherHealthy
    const videoHasRoots = videoLib.hasRoots
    const videoFfmpegAvailable = computed(() => !!videoLib.ffmpegInfo.value?.available)

    /** 进入子目录 / 进入回收站里的"原目录" */
    const handleFolderClick = (folder: any) => {
      if (folder?.kind === 'missing') {
        videoLib.setRecycleRel(folder.rel || '')
        return
      }
      videoLib.enterFolder(folder)
      resourcePage.resetToFirstPage?.()
    }

    /** 面包屑跳转 */
    const handleBreadcrumbClick = (crumb: any) => {
      videoLib.goToBreadcrumb(crumb)
      resourcePage.resetToFirstPage?.()
    }

    /** 返回上一级（回收站里就是退回上一层"原目录"） */
    const handleGoUp = () => {
      if (isRecycleBinMode.value) {
        const rel = videoLib.recycleRel.value
        if (!rel) return
        const segments = rel.split('/')
        segments.pop()
        videoLib.setRecycleRel(segments.join('/'))
        return
      }
      videoLib.goUp()
      resourcePage.resetToFirstPage?.()
    }

    /* -------- 回收站文件夹卡片的右键菜单（整夹重新关联） -------- */

    const folderMenuVisible = ref(false)
    const folderMenuPosition = ref({ x: 0, y: 0 })
    const folderMenuFolder = ref<any>(null)

    const folderMenuItems = computed(() => {
      const folder = folderMenuFolder.value
      const count = folder?.count || 0
      return [
        { key: 'relink-folder', icon: '🔗', label: `整个文件夹重新关联到…（${count} 个文件）` },
        { key: 'remove-folder', icon: '🗑️', label: `从库中移除这组记录（${count} 个，磁盘文件不动）` }
      ]
    })

    /** 只有回收站里的"原目录"卡片需要右键菜单 */
    const handleFolderContextMenu = (event: MouseEvent, folder: any) => {
      if (folder?.kind !== 'missing') return
      folderMenuFolder.value = folder
      folderMenuPosition.value = { x: event.clientX, y: event.clientY }
      folderMenuVisible.value = true
    }

    const handleFolderMenuItemClick = async (menuItem: any) => {
      folderMenuVisible.value = false
      const folder = folderMenuFolder.value
      if (!folder) return
      if (menuItem?.key === 'relink-folder') {
        await videoLib.relinkMissingFolder(folder)
        refreshFilterData()
        return
      }
      if (menuItem?.key === 'remove-folder') {
        if (!(await confirmRemoveRecords(folder.count, folder.fullPath))) return
        await videoLib.removeMissingFolder(folder)
        refreshFilterData()
      }
    }

    /**
     * 移除记录前的确认（文案必须把"删的是记录、不是文件"说死）
     */
    const confirmRemoveRecords = async (count: number, detail?: string) => {
      return await confirmService.confirm(
        `从库中移除 ${count} 条丢失记录 —— 「磁盘上的文件不会动」。\n\n` +
        '标签、打开次数、封面索引会一起消失，且不可撤销。\n' +
        (detail ? `\n${detail}` : ''),
        '从库中移除'
      )
    }

    /** 清空回收站（当前范围内的全部丢失记录） */
    const handleClearRecycleBin = async () => {
      const count = videoLib.missingItems.value.length
      if (count === 0) {
        notify.toast('warning', '回收站是空的', '当前范围没有丢失的记录')
        return
      }
      const scope = videoLib.currentRoot.value
        ? `${videoLib.currentRoot.value}${videoLib.currentRel.value ? '\\' + videoLib.currentRel.value.replace(/\//g, '\\') : ''}`
        : '全部绑定目录'
      if (!(await confirmRemoveRecords(count, `范围：${scope}`))) return
      const removed = await videoLib.clearMissingRecords()
      videoLib.resetRecycle()
      refreshFilterData()
      notify.toast('success', '回收站已清空', `${removed} 条记录已从库中移除（磁盘文件没有动）`)
    }

    /** 单条丢失记录：从库中移除 */
    const handleRemoveSingleRecord = async (item: any) => {
      const name = String(BaseResources.extractPrimitiveValue(item?.name) || item?.fileName || '这条记录')
      if (!(await confirmRemoveRecords(1, name))) return
      await videoLib.removeRecords([item])
      refreshFilterData()
    }

    const closeFolderMenu = () => {
      folderMenuVisible.value = false
    }
    onMounted(() => document.addEventListener('click', closeFolderMenu))
    onBeforeUnmount(() => document.removeEventListener('click', closeFolderMenu))

    /** 文件夹卡片 tooltip */
    const folderCardTitle = (folder: any) => {
      if (!folder) return ''
      const tagText = folder.tags && folder.tags.length > 0
        ? `\n标签（含子文件夹）：${folder.tags.slice(0, 20).join('、')}${folder.tags.length > 20 ? '…' : ''}`
        : ''
      if (folder.kind === 'missing') {
        return `${folder.fullPath}\n（磁盘上已经找不到这个目录了）\n共 ${folder.count} 个丢失文件 · 右键可整夹重新关联回来${tagText}`
      }
      return `${folder.fullPath}${tagText}`
    }

    /** 解除绑定（只解除绑定，不删记录、不碰文件） */
    const handleUnbindRoot = async (folder: any) => {
      const ok = await videoLib.unbindFolder(folder.root || folder.fullPath)
      if (ok) refreshFilterData()
    }

    /** 在资源管理器里打开文件夹 */
    const handleOpenFolderInExplorer = async (folder: any) => {
      if (!isElectronEnvironment.value || !window.electronAPI?.openFolder) return
      await window.electronAPI.openFolder(folder.fullPath)
    }

    /** 手动重新扫描 */
    const handleRescanVideoLibrary = async () => {
      await videoLib.rescan()
      refreshFilterData()
    }

    /** 绑定文件夹 */
    const handleBindVideoFolder = async () => {
      const ok = await videoLib.bindFolder()
      if (ok) refreshFilterData()
    }

    /**
     * 空状态按钮：视频页走「绑定文件夹」，其它页面沿用 createResourcePage 的默认行为
     */
    const handleEmptyStateActionImpl = (actionName: string) => {
      if (isVideoPage.value && actionName === 'bindVideoFolder') {
        handleBindVideoFolder()
        return
      }
      resourcePage.handleEmptyStateAction(actionName)
    }

    return {
      resourceType, // 返回 computed，保持响应式
      isElectronEnvironment,
      // 是否视频页（模板用它切换专属 UI）
      isVideoPage,
      // 视频页专属状态与方法
      videoBreadcrumb,
      videoFolderCards,
      // 受标签筛选/搜索/「显示文件夹」开关影响的文件夹卡片
      visibleFolderCards,
      showFolderCards,
      toggleShowFolderCards,
      // 视频页的空状态覆盖（文件夹层不再被「没有找到匹配的视频」盖住）
      emptyStateOverride,
      // 「丢失的文件」计数注入（左栏刷新时用，见 methods.updateFilterData）
      applyMissingCount,
      videoIsScanning,
      videoWatcherHealthy,
      videoHasRoots,
      videoFfmpegAvailable,
      handleFolderClick,
      handleBreadcrumbClick,
      handleGoUp,
      handleUnbindRoot,
      handleOpenFolderInExplorer,
      handleRescanVideoLibrary,
      handleBindVideoFolder,
      // ===== 回收站（丢失的文件）=====
      isRecycleBinMode,
      videoRecycleRel,
      recycleBreadcrumb,
      missingVideoCount,
      handleRecycleCrumb,
      handleClearRecycleBin,
      folderCardTitle,
      folderMenuVisible,
      folderMenuPosition,
      folderMenuItems,
      handleFolderContextMenu,
      handleFolderMenuItemClick,
      // 卡片主操作按钮的统一派发（视频→openVideo，游戏→launchExecutable）
      handleCardAction,
      // 多选模式相关
      isMultiSelectMode,
      selectedItems,
      toggleMultiSelectMode,
      isItemSelected,
      toggleSelectItem,
      // 批量导入对话框相关
      showBatchImportDialog,
      batchImportFiles,
      batchImportFolderPath,
      batchImportDialogRef,
      closeBatchImportDialog,
      handleBatchImportConfirm,
      // 批量增加tag对话框相关
      showBatchAddTagDialog,
      closeBatchAddTagDialog,
      handleBatchAddTagConfirm,
      // 全局「使用最新截图作为封面」
      handleBatchLatestScreenshotCover,
      // 批量删除tag对话框相关
      showBatchDeleteTagDialog,
      closeBatchDeleteTagDialog,
      handleBatchDeleteTagConfirm,
      // 批量删除确认对话框相关
      showBatchDeleteConfirmDialog,
      closeBatchDeleteConfirmDialog,
      handleBatchDeleteConfirm,
      isResourceRunning,
      handleResourceAction,
      terminateGame,
      getFileExists, // 获取文件存在性状态
      checkFileExistence, // 文件存在性检查方法
      // FunGrid 布局相关
      displayLayoutBaseWidth,
      displayLayoutMinWidth,
      displayLayoutMaxWidth,
      customLayoutStyle,
      // 灵活工具栏按钮处理
      handleButtonClick,
      // 对话框配置
      dialogConfig,
      // 详情面板相关（从 resourcePage 获取）
      showDetailDialog: resourcePage.showDetailDialog,
      selectedItem: resourcePage.selectedItem,
      itemStats: resourcePage.itemStats,
      itemActions: resourcePage.itemActions,
      closeDetail: resourcePage.closeDetail,
      updateResource: resourcePage.updateResource,
      // 详情面板类型映射（计算属性）
      detailPanelType,
      shouldShowPreview,
      // 详情页图片预览相关（服务于游戏截图浏览）
      // 图片缓存相关
      ...imageCacheComposable,
      // 详情页图片分页相关（排除 loadImageSettings，重命名为 loadImagePagesSettings 避免与方法冲突）
      loadImagePagesSettings: imagePagesComposable.loadImageSettings,
      detailCurrentPage: imagePagesComposable.detailCurrentPage,
      detailPageSize: imagePagesComposable.detailPageSize,
      detailTotalPages: imagePagesComposable.detailTotalPages,
      jumpToPageInput: imagePagesComposable.jumpToPageInput,
      paginatedPages: imagePagesComposable.paginatedPages,
      detailCurrentPageStartIndex: imagePagesComposable.detailCurrentPageStartIndex,
      nextPageGroup: imagePagesComposable.nextPageGroup,
      previousPageGroup: imagePagesComposable.previousPageGroup,
      jumpToPageGroup: imagePagesComposable.jumpToPageGroup,
      resetPagination: imagePagesComposable.resetPagination,
      updateTotalPages: imagePagesComposable.updateTotalPages,
      detailPages,
      handleDetailPageClick,
      handleDetailPageChange,
      // 拖拽相关
      handleFileDrop,
      handleDropError,
      isDragOver,
      handleDragOver,
      handleDragEnter,
      handleDragLeave,
      handleDragDrop,
      // 路径更新对话框相关
      showPathUpdateDialog: resourcePage.showPathUpdateDialog,
      pathUpdateInfo: resourcePage.pathUpdateInfo,
      closePathUpdateDialog: resourcePage.closePathUpdateDialog,
      confirmPathUpdate,
      pathUpdateDialogTitle,
      pathUpdateDialogDescription,
      pathUpdateItemNameLabel,
      pathUpdateItemName,
      pathUpdateOldPath,
      pathUpdateNewPath,
      pathUpdateMissingLabel,
      pathUpdateFoundLabel,
      pathUpdateQuestion,
      // 强制结束程序确认对话框相关
      showTerminateConfirmDialog,
      resourceToTerminate,
      terminateResourceName,
      closeTerminateConfirmDialog,
      confirmTerminateGame,
      // 详情面板操作处理（与右键菜单共用 handleDetailActionImpl）
      handleDetailAction: handleDetailActionImpl,
      ...resourcePage, // 展开所有方法和属性，使模板可以直接访问
      // 空状态按钮（必须在 ...resourcePage 之后：视频页要覆盖成「绑定文件夹」）
      handleEmptyStateAction: handleEmptyStateActionImpl,
      // 批量操作相关（必须在 ...resourcePage 之后，以覆盖 resourcePage 中的 contextMenuItems）
      handleBatchAddTag,
      handleBatchDeleteTag,
      handleBatchDelete,
      contextMenuItems,
      // 明确声明方法，确保 TypeScript 能正确识别
      updateScale: resourcePage.updateScale,
      showAddDialogHandler: resourcePage.showAddDialogHandler,
      handleSortChanged: resourcePage.handleSortChanged,
      handleSearchQueryChanged: resourcePage.handleSearchQueryChanged,
      handleSortByChanged: resourcePage.handleSortByChanged,
      handleContextMenuClick: resourcePage.handleContextMenuClick,
      handlePageChange: resourcePage.handlePageChange,
      // 筛选相关（按照 GameView.vue 的方式暴露所有方法）
      // 注意：顺序与 GameView.vue 保持一致，先 toRefs 再展开 filterComposable
      ...toRefs(filterComposable),
      ...filterComposable,
      // 保存 filterComposable 引用，供 methods 中使用
      _filterComposable: filterComposable,
      // 明确暴露 filteredItems 和 paginatedItems，确保模板能正确访问
      // 重要：使用 filterComposable.filteredGames（即 filteredItems），而不是 resourcePage.filteredItems
      // 因为 resourcePage.filteredItems 可能没有正确响应筛选变化
      filteredItems: filterComposable.filteredGames, // 直接使用筛选 composable 的结果
      paginatedItems: resourcePage.paginatedItems,
      // 编辑对话框相关
      ResourceClass,
      allTags,
      availableTagsByField,
      // 编辑对话框状态和方法（从 resourcePage 获取）
      showEditDialog: resourcePage.showEditDialog,
      editForm: resourcePage.editForm,
      closeEdit: resourcePage.closeEdit,
      handleEditConfirm: resourcePage.handleEditConfirm,
      // 供 App.vue 游戏时长/保存逻辑使用（与 GameView 兼容）：games 即 items，saveGames 即 saveData
      games: items,
      saveGames: saveData
    }
    
    // 调试：检查 setup 返回的对象中的筛选方法
    const setupReturn = {
      resourceType,
      isElectronEnvironment,
      isResourceRunning,
      handleResourceAction,
      terminateGame,
      getFileExists,
      checkFileExistence,
      ...resourcePage,
      updateScale: resourcePage.updateScale,
      handleEmptyStateAction: resourcePage.handleEmptyStateAction,
      showAddDialogHandler: resourcePage.showAddDialogHandler,
      handleSortChanged: resourcePage.handleSortChanged,
      handleSearchQueryChanged: resourcePage.handleSearchQueryChanged,
      handleSortByChanged: resourcePage.handleSortByChanged,
      handleContextMenuClick: resourcePage.handleContextMenuClick,
      handlePageChange: resourcePage.handlePageChange,
      ...toRefs(filterComposable),
      ...filterComposable
    }
    
    return setupReturn as any // 使用 as any 绕过类型检查，因为方法确实存在
  },
  methods: {
    handleContextMenu(event: MouseEvent, item: any) {
      (this.$refs.baseView as any)?.showContextMenuHandler(event, item)
    },
    // 更新筛选器数据到 App.vue
    updateFilterData() {
      // 优先从 this 访问，如果不存在则从 filterComposable 访问
      const getFilterDataFn = (this as any).getFilterData || 
                             ((this as any)._filterComposable && (this as any)._filterComposable.getFilterData)
      
      console.log('[GenericResourceView] updateFilterData 被调用')
      console.log('[GenericResourceView] getFilterDataFn 存在:', !!getFilterDataFn)
      console.log('[GenericResourceView] _filterComposable 存在:', !!(this as any)._filterComposable)
      
      if (getFilterDataFn && typeof getFilterDataFn === 'function') {
        const filterData = getFilterDataFn()
        // 详细打印每个筛选器的状态
        const filtersDetail = filterData?.filters?.map((f: any) => ({
          key: f.key,
          title: f.title,
          itemsCount: f.items?.length || 0,
          selectedCount: f.selected?.length || 0,
          excludedCount: f.excluded?.length || 0,
          selected: f.selected || [],
          excluded: f.excluded || []
        })) || []
        console.log('[GenericResourceView] updateFilterData - 筛选器数据:', {
          filtersCount: filterData?.filters?.length || 0,
          filters: filtersDetail
        })
        // 特别检查 developers 筛选器的状态
        const developersFilter = filtersDetail.find((f: any) => f.key === 'developers')
        if (developersFilter) {
          console.log('[GenericResourceView] developers 筛选器状态:', {
            selected: developersFilter.selected,
            excluded: developersFilter.excluded,
            itemsCount: developersFilter.itemsCount
          })
        }
        // 视频页：「丢失的文件」计数要单独补上（筛选池里不含丢失记录，extractFn 数不出来）
        if (typeof (this as any).applyMissingCount === 'function') {
          (this as any).applyMissingCount(filterData)
        }
        this.$emit('filter-data-updated', filterData)
      } else {
        console.warn('[GenericResourceView] getFilterData 方法不存在，无法更新筛选器数据')
      }
    },
    // 处理来自 App.vue 的筛选器事件（动态支持所有筛选器，完全按照 GameView 的方式）
    handleFilterEvent(event, data) {
      console.log('GenericResourceView handleFilterEvent:', event, data)
      const filterKey = data?.filterKey || data
      
      // 动态获取筛选方法名
      const filterMethodName = `filterBy${filterKey.charAt(0).toUpperCase() + filterKey.slice(1)}`
      const excludeMethodName = `excludeBy${filterKey.charAt(0).toUpperCase() + filterKey.slice(1)}`
      const clearMethodName = `clear${filterKey.charAt(0).toUpperCase() + filterKey.slice(1)}Filter`
      
      console.log('[GenericResourceView] 筛选方法名:', { filterMethodName, excludeMethodName, clearMethodName })
      console.log('[GenericResourceView] 方法是否存在:', {
        filterMethod: !!this[filterMethodName],
        excludeMethod: !!this[excludeMethodName],
        clearMethod: !!this[clearMethodName]
      })
      
      switch (event) {
        case 'filter-select':
          if (this[filterMethodName] && typeof this[filterMethodName] === 'function') {
            // 获取筛选前的状态
            const filterComposable = (this as any)._filterComposable
            const filterState = filterComposable?.filterStates?.[filterKey]
            const beforeSelected = filterState?.selected?.value ? [...filterState.selected.value] : []
            console.log('[GenericResourceView] 调用筛选方法前，selected 状态:', beforeSelected)
            
            console.log('[GenericResourceView] 调用筛选方法:', filterMethodName, '参数:', data.itemName)
            this[filterMethodName](data.itemName)
            
            // 获取筛选后的状态
            const afterSelected = filterState?.selected?.value ? [...filterState.selected.value] : []
            console.log('[GenericResourceView] 调用筛选方法后，selected 状态:', afterSelected)
            console.log('[GenericResourceView] 筛选方法调用完成，更新筛选器数据')
            this.updateFilterData()
          } else {
            console.warn('[GenericResourceView] 筛选方法不存在:', filterMethodName)
          }
          break
        case 'filter-exclude':
          if (this[excludeMethodName] && typeof this[excludeMethodName] === 'function') {
            console.log('[GenericResourceView] 调用排除方法:', excludeMethodName, '参数:', data.itemName)
            this[excludeMethodName](data.itemName)
            this.updateFilterData()
          } else {
            console.warn('[GenericResourceView] 排除方法不存在:', excludeMethodName)
          }
          break
        case 'filter-clear':
          if (this[clearMethodName] && typeof this[clearMethodName] === 'function') {
            console.log('[GenericResourceView] 调用清除方法:', clearMethodName)
            this[clearMethodName]()
            this.updateFilterData()
          } else {
            console.warn('[GenericResourceView] 清除方法不存在:', clearMethodName)
          }
          break
      }
    }
  },
  async mounted() {
    // 等待下一个 tick，确保数据已完全更新到响应式系统中（完全按照 ImageView loadAlbums 的方式）
    await this.$nextTick()
    
    // 提取所有筛选器数据（使用 useResourceFilter 的方法，完全按照 ImageView loadAlbums 的方式）
    if (this.extractAllFilters && typeof this.extractAllFilters === 'function') {
      console.log('[GenericResourceView] 调用 extractAllFilters，当前 items 数量:', (this as any).items?.length || 0)
      this.extractAllFilters()
      console.log('[GenericResourceView] extractAllFilters 执行完成')
    } else {
      console.warn('[GenericResourceView] extractAllFilters 方法不存在')
    }

    // 初始化筛选器数据（完全按照 ImageView loadAlbums 的方式）
    this.updateFilterData()
    
    // 注意：不需要在这里注册全局事件监听器
    // ResourceView.vue 已经注册了全局事件监听器，并且会调用这个组件的 handleFilterEvent 方法
    // 这与 GameView.vue 和 ImageView.vue 的实现方式一致
  },
  beforeUnmount() {
    // 注意：不需要清理筛选事件监听器
    // 因为事件监听器是由 ResourceView.vue 注册的，它会负责清理
  }
})
</script>

<style scoped lang="scss">
.generic-resource-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}

// resource-content 本身就是 fun-drop-zone，需要直接覆盖样式
.resource-content {
  flex: 1;
  overflow-y: auto;
  
  // 覆盖 FunDropZone 的默认样式（resource-content 本身就是 fun-drop-zone）
  // 布局相关：使用 block 布局，不居中对齐
  display: block !important;
  align-items: unset !important;
  justify-content: unset !important;
  min-height: auto !important;
  height: 100%;
  
  // 移除默认边框和背景
  border: none !important;
  background: transparent !important;
  padding: var(--spacing-xl);
  cursor: default !important;
  
  // 移除默认 hover 效果
  &:hover {
    background: transparent !important;
    border-color: transparent !important;
  }
  
  // 拖拽时才显示边框和背景
  &.drag-over {
    background: rgba(59, 130, 246, 0.1) !important;
    border: 2px dashed var(--accent-color) !important;
    border-radius: var(--radius-xl);
    position: relative;
    
    // 添加拖拽提示遮罩层
    &::before {
      content: '';
      position: absolute;
      inset: 0;
      background: rgba(59, 130, 246, 0.2);
      border-radius: var(--radius-xl);
      z-index: 1;
      pointer-events: none;
    }
    
    // 添加拖拽提示文字
    &::after {
      content: '松开鼠标添加资源';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(59, 130, 246, 0.9);
      color: white;
      padding: 12px 24px;
      border-radius: var(--radius-md);
      font-size: 16px;
      font-weight: 600;
      z-index: 2;
      pointer-events: none;
      white-space: nowrap;
    }
  }
}

// FunGrid 拖拽状态样式
:deep(.fun-grid.is-dragging) {
  opacity: 0.5;
  pointer-events: none;
}

// 空网格占位
.empty-grid {
  min-height: 200px;
  
  &.is-dragging {
    opacity: 0.5;
  }
}

/* 小说阅读器样式 */
.novel-reader-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.novel-reader-content {
  width: 90%;
  height: 90%;
  background: var(--bg-primary);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.reader-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.reader-title h3 {
  margin: 0;
  font-size: 1.2rem;
  color: var(--text-primary);
}

.reader-author {
  margin: 4px 0 0 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
}

.reader-controls {
  display: flex;
  gap: 8px;
}

.btn-close-reader {
  background: transparent;
  border: none;
  color: var(--text-primary);
  cursor: pointer;
  padding: 8px;
  border-radius: 4px;
  transition: background 0.2s;
}

.btn-close-reader:hover {
  background: var(--bg-tertiary);
}

.btn-icon {
  font-size: 1.2rem;
}

.reader-content {
  flex: 1;
  overflow: auto;
  padding: 24px;
}

.reader-content-wrapper {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.ebook-reader-v2-content {
  display: flex;
  height: 100%;
}

.chapter-navigation-sidebar {
  width: 250px;
  border-right: 1px solid var(--border-color);
  overflow-y: auto;
  background: var(--bg-secondary);
}

.chapter-nav-header {
  padding: 16px;
  border-bottom: 1px solid var(--border-color);
}

.chapter-nav-header h4 {
  margin: 0;
  font-size: 1rem;
  color: var(--text-primary);
}

.reader-content-main {
  flex: 1;
  overflow: hidden;
}

/* 强制结束程序确认对话框样式 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal-backdrop);
}

.modal-content {
  background: var(--bg-secondary);
  border-radius: var(--radius-xl);
  width: 500px;
  max-width: 90vw;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 40px var(--shadow-medium);
  transition: background-color var(--transition-base);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-xl);
  border-bottom: 1px solid var(--border-color);

  h3 {
    color: var(--text-primary);
    margin: 0;
    transition: color var(--transition-base);
  }
}

.btn-close {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  transition: all var(--transition-base);

  &:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
}

.modal-body {
  padding: var(--spacing-xl);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-md);
  padding: var(--spacing-xl);
  border-top: 1px solid var(--border-color);
}

.btn-cancel {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  padding: var(--spacing-md) var(--spacing-xl);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-base);

  &:hover {
    background: var(--bg-secondary);
  }
}

.btn-confirm {
  background: var(--accent-color);
  color: white;
  border: none;
  padding: var(--spacing-md) var(--spacing-xl);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-weight: 600;
  transition: background var(--transition-base);

  &:hover:not(:disabled) {
    background: var(--accent-hover);
  }
}

/* 响应式设计 */
@media (max-width: 768px) {
  .modal-content {
    width: 95vw;
    margin: var(--spacing-xl);
  }
}

/* ========================================================================== */
/* 视频页：面包屑 + 文件夹卡片                                                 */
/* ========================================================================== */

.video-path-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 20px 4px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.video-breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
  font-size: 0.88rem;
}

.video-crumb-home {
  opacity: 0.7;
}

.video-crumb {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  color: var(--accent-color, #66c0f4);
  padding: 2px 4px;
  border-radius: 4px;
  transition: background 0.15s;

  &:hover {
    background: var(--bg-tertiary);
  }

  &.is-current {
    color: var(--text-primary);
    cursor: default;

    &:hover {
      background: transparent;
    }
  }
}

.video-crumb-sep {
  color: var(--text-tertiary);
  opacity: 0.6;
}

.video-path-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.video-status {
  font-size: 0.78rem;
  padding: 2px 8px;
  border-radius: 10px;

  &.is-scanning {
    color: var(--accent-color, #66c0f4);
    background: rgba(102, 192, 244, 0.12);
  }

  &.is-warn {
    color: #f59e0b;
    background: rgba(245, 158, 11, 0.12);
  }

  &.is-hint {
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
  }
}

.video-mini-btn {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: var(--bg-primary);
  }

  /* 清空回收站这类"不可撤销"的操作给个红色提示 */
  &.is-danger {
    color: #ef4444;
    border-color: rgba(239, 68, 68, 0.45);

    &:hover {
      background: rgba(239, 68, 68, 0.12);
    }
  }
}

/* 文件夹卡片：与 MediaCard 同宽，行高由同一行的视频卡片决定 */
.video-folder-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  /* ⚠️ 这里**不能**用 aspect-ratio：
     FunGrid 是 display:grid 且默认 align-items:stretch，行高取「该行最高的项」。
     一旦文件夹卡片用 aspect-ratio 定高（3/4 会远高于视频卡片），
     整行就被顶高，同行的视频卡片下方会空出一大片 —— 主人 2026-10-04 指出的就是这个。
     只给 min-height：单独成行时撑出卡片感，与视频卡片同行时跟随行高。 */
  min-height: 200px;
  padding: 14px;
  border: 1px dashed var(--border-color);
  border-radius: 10px;
  background: var(--bg-secondary);
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.15s, border-color 0.15s, background 0.15s;

  &:hover {
    transform: translateY(-2px);
    border-color: var(--accent-color, #66c0f4);
    background: var(--bg-tertiary);
  }

  &.is-root {
    border-style: solid;
    border-color: var(--accent-color, #66c0f4);
  }

  /* 回收站里的"原目录"：磁盘上已经不存在了，用虚线 + 暖色提示 */
  &.is-missing {
    border-color: rgba(245, 158, 11, 0.55);

    .folder-icon {
      filter: saturate(0.6);
      opacity: 0.85;
    }

    &:hover {
      border-color: #f59e0b;
    }
  }
}

/* 回收站面包屑的计数提示 */
.video-recycle-count {
  margin-left: 6px;
  font-size: 0.76rem;
  color: var(--text-tertiary);
}

.folder-hint {
  font-size: 0.7rem;
  color: rgba(245, 158, 11, 0.9);
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: 8px;
  padding: 0 6px;
  cursor: help;
}

.folder-icon {
  font-size: 2.6rem;
  line-height: 1;
  filter: saturate(0.9);
}

.folder-name {
  max-width: 100%;
  text-align: center;
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-all;
}

/* 文件夹直接包含的视频标签并集（筛选下靠它判断这个夹子要不要显示） */
.folder-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
  max-width: 100%;
}

.folder-tag {
  font-size: 0.68rem;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-tag-more {
  font-size: 0.68rem;
  color: var(--text-tertiary);
}

/* 「显示文件夹」开关处于关闭态时给个视觉反馈 */
.video-mini-btn.is-off {
  opacity: 0.55;
  text-decoration: line-through;
}

.folder-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.folder-open {
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 0.9rem;
  padding: 0 4px;
  border-radius: 4px;

  &:hover {
    color: var(--accent-color, #66c0f4);
    background: var(--bg-primary);
  }
}

.folder-unbind {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  font-size: 0.72rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background: #ef4444;
  }
}

.video-folder-card:hover .folder-unbind {
  opacity: 1;
}
</style>
