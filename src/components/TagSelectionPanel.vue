<template>
  <div
    v-if="visible"
    class="tag-selection-panel"
    @mousedown.stop
  >
    <div class="tag-panel-header">
      <h4>{{ title || '标签选择' }}</h4>
      <!-- 分类一多时，一键全折叠/全展开（状态与单个分类一起记在本地） -->
      <button
        v-if="hasSections"
        class="tag-panel-toggle-all"
        :title="allCollapsed ? '展开全部分类' : '折叠全部分类'"
        @click="toggleAllSections"
      >{{ allCollapsed ? '展开全部' : '折叠全部' }}</button>
    </div>
    <div class="tag-panel-body">
      <!-- 搜索框（可选） -->
      <div v-if="showSearch" class="tag-search">
        <input
          type="text"
          v-model="searchQuery"
          :placeholder="searchPlaceholder || '搜索标签...'"
          class="tag-search-input"
        />
      </div>

      <!-- 多区块：每个 FormField_Tags 一个区块，用各自 availableTags 数据源，点击填入对应字段 -->
      <template v-if="tagFields && tagFields.length > 0">
        <div
          v-for="field in tagFields"
          :key="field.key"
          class="tag-list-section"
        >
          <div class="tag-list-title">
            <span class="tag-list-label">{{ field.label }}</span>
            <span class="tag-count-badge">{{ getFilteredAvailableTagsForField(field).length }}</span>
            <!-- 折叠 / 展开这个分类（作者 / 开发商 / 引擎 / 标签… 各自独立） -->
            <button
              class="tag-section-toggle"
              :class="{ collapsed: isSectionCollapsed(field.key) }"
              :title="isSectionCollapsed(field.key) ? `展开「${field.label}」` : `折叠「${field.label}」`"
              @click="toggleSection(field.key)"
            >{{ isSectionCollapsed(field.key) ? '▸' : '▾' }}</button>
          </div>
          <template v-if="!isSectionCollapsed(field.key)">
            <div v-if="getFilteredAvailableTagsForField(field).length > 0" class="tag-list">
              <button
                v-for="tagItem in getFilteredAvailableTagsForField(field)"
                :key="field.key + '-' + getTagName(tagItem)"
                class="tag-item-btn"
                :class="{ 'tag-item-selected': isTagSelectedInField(tagItem, field.currentTags) }"
                @click="handleTagClickForField(tagItem, field.key)"
              >
                <span class="tag-name">{{ getTagName(tagItem) }}</span>
                <span v-if="getTagCount(tagItem)" class="tag-count">{{ getTagCount(tagItem) }}</span>
                <span v-if="isTagSelectedInField(tagItem, field.currentTags)" class="tag-check">✓</span>
              </button>
            </div>
            <div v-else class="tag-empty-state tag-empty-inline">
              <p>{{ emptyMessage || '暂无可用标签' }}</p>
            </div>
          </template>
        </div>
      </template>

      <!-- 单区块（兼容旧用法：只传 currentTags + availableTags） -->
      <template v-else>
        <div v-if="filteredAvailableTags && filteredAvailableTags.length > 0" class="tag-list-section">
          <div class="tag-list-title">
            <span class="tag-list-label">{{ title || '标签选择' }}</span>
            <span class="tag-count-badge">{{ filteredAvailableTags.length }}</span>
            <button
              class="tag-section-toggle"
              :class="{ collapsed: isSectionCollapsed(SINGLE_SECTION_KEY) }"
              :title="isSectionCollapsed(SINGLE_SECTION_KEY) ? '展开' : '折叠'"
              @click="toggleSection(SINGLE_SECTION_KEY)"
            >{{ isSectionCollapsed(SINGLE_SECTION_KEY) ? '▸' : '▾' }}</button>
          </div>
          <div v-if="!isSectionCollapsed(SINGLE_SECTION_KEY)" class="tag-list">
            <button
              v-for="tagItem in filteredAvailableTags"
              :key="getTagName(tagItem)"
              class="tag-item-btn"
              :class="{ 'tag-item-selected': isTagSelected(tagItem) }"
              @click="handleTagClick(tagItem)"
            >
              <span class="tag-name">{{ getTagName(tagItem) }}</span>
              <span v-if="getTagCount(tagItem)" class="tag-count">{{ getTagCount(tagItem) }}</span>
              <span v-if="isTagSelected(tagItem)" class="tag-check">✓</span>
            </button>
          </div>
        </div>

        <div v-else class="tag-empty-state">
          <p>{{ emptyMessage || '暂无可用标签' }}</p>
          <p v-if="availableTags && availableTags.length === 0" class="debug-info" style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 8px;">
            调试：availableTags 为空数组
          </p>
          <p v-else-if="!availableTags" class="debug-info" style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 8px;">
            调试：availableTags 未定义
          </p>
        </div>
      </template>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, ref } from 'vue'

export default {
  name: 'TagSelectionPanel',
  props: {
    visible: {
      type: Boolean,
      default: false
    },
    title: {
      type: String,
      default: '标签选择'
    },
    /** 多区块模式：每个 FormField_Tags 一个区块，点击填入对应 key 的字段；每项可带 availableTags 使用各自数据源 */
    tagFields: {
      type: Array as () => { key: string; label: string; currentTags: string[]; availableTags?: (string | { name: string; count?: number })[] }[],
      default: () => []
    },
    /** 单区块模式（与 tagFields 二选一） */
    currentTags: {
      type: Array as () => string[],
      default: () => []
    },
    availableTags: {
      type: Array as () => (string | { name: string; count?: number })[],
      default: () => []
    },
    showSearch: {
      type: Boolean,
      default: true
    },
    searchPlaceholder: {
      type: String,
      default: '搜索标签...'
    },
    emptyMessage: {
      type: String,
      default: '暂无可用标签'
    }
  },
  emits: ['select-tag'],
  setup(props, { emit }) {
    const searchQuery = ref('')

    // ===== 分类折叠（2026-10-13，1.5.0）=====
    // 作者 / 开发商 / 引擎 / 标签 各自独立折叠，状态记在本地，下次打开还是这个样子。
    const SINGLE_SECTION_KEY = '__single__'
    const COLLAPSE_STORAGE_KEY = 'ggv-tag-panel-collapsed'
    const collapsedSections = ref<Record<string, boolean>>({})

    try {
      const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY)
      if (raw) collapsedSections.value = JSON.parse(raw) || {}
    } catch (error) {
      console.warn('[TagSelectionPanel] 读取折叠状态失败:', error)
    }

    const persistCollapsed = () => {
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(collapsedSections.value))
      } catch (error) {
        console.warn('[TagSelectionPanel] 保存折叠状态失败:', error)
      }
    }

    const isSectionCollapsed = (key: string): boolean => collapsedSections.value[key] === true

    const toggleSection = (key: string) => {
      collapsedSections.value = { ...collapsedSections.value, [key]: !isSectionCollapsed(key) }
      persistCollapsed()
    }

    /** 当前面板里所有分类的 key（多区块用字段 key，单区块用保留 key） */
    const sectionKeys = computed<string[]>(() => {
      if (props.tagFields && props.tagFields.length > 0) return props.tagFields.map(field => field.key)
      return [SINGLE_SECTION_KEY]
    })

    const hasSections = computed(() => sectionKeys.value.length > 1)
    const allCollapsed = computed(() => sectionKeys.value.every(key => isSectionCollapsed(key)))

    const toggleAllSections = () => {
      const next: Record<string, boolean> = { ...collapsedSections.value }
      const target = !allCollapsed.value
      for (const key of sectionKeys.value) next[key] = target
      collapsedSections.value = next
      persistCollapsed()
    }

    // 过滤可用标签
    const filteredAvailableTags = computed(() => {
      if (!props.availableTags || props.availableTags.length === 0) {
        return []
      }
      if (!searchQuery.value.trim()) {
        return props.availableTags
      }
      const query = searchQuery.value.toLowerCase().trim()
      return props.availableTags.filter((tag: string | { name: string; count?: number }) => {
        const tagName = typeof tag === 'string' ? tag : tag.name
        return tagName.toLowerCase().includes(query)
      })
    })

    // 获取标签名称
    const getTagName = (tag: string | { name: string; count?: number }): string => {
      return typeof tag === 'string' ? tag : tag.name
    }

    // 获取标签数量
    const getTagCount = (tag: string | { name: string; count?: number }): number | null => {
      return typeof tag === 'object' && tag.count !== undefined ? tag.count : null
    }

    // 检查标签是否已选中（单区块）
    const isTagSelected = (tag: string | { name: string; count?: number }): boolean => {
      const tagName = getTagName(tag)
      return props.currentTags.includes(tagName)
    }

    // 检查标签在指定字段的 currentTags 中是否已选中（多区块）
    const isTagSelectedInField = (tag: string | { name: string; count?: number }, currentTags: string[]): boolean => {
      const tagName = getTagName(tag)
      return Array.isArray(currentTags) && currentTags.includes(tagName)
    }

    // 处理标签点击（单区块）
    const handleTagClick = (tag: string | { name: string; count?: number }) => {
      emit('select-tag', getTagName(tag))
    }

    // 处理标签点击（多区块）：带上 fieldKey，填入对应区域
    const handleTagClickForField = (tag: string | { name: string; count?: number }, fieldKey: string) => {
      emit('select-tag', { fieldKey, tag: getTagName(tag) })
    }

    // 多区块时每个区块用各自数据源，再按搜索过滤
    const getFilteredAvailableTagsForField = (field: { availableTags?: (string | { name: string; count?: number })[] }) => {
      const source = (field.availableTags != null && Array.isArray(field.availableTags)) ? field.availableTags : props.availableTags
      if (!source || source.length === 0) return []
      if (!searchQuery.value.trim()) return source
      const query = searchQuery.value.toLowerCase().trim()
      return source.filter((tag: string | { name: string; count?: number }) => {
        const tagName = typeof tag === 'string' ? tag : tag.name
        return tagName.toLowerCase().includes(query)
      })
    }

    return {
      searchQuery,
      SINGLE_SECTION_KEY,
      collapsedSections,
      isSectionCollapsed,
      toggleSection,
      hasSections,
      allCollapsed,
      toggleAllSections,
      filteredAvailableTags,
      getFilteredAvailableTagsForField,
      getTagName,
      getTagCount,
      isTagSelected,
      isTagSelectedInField,
      handleTagClick,
      handleTagClickForField
    }
  }
}
</script>

<style scoped>
.tag-selection-panel {
  background: var(--bg-secondary);
  border-radius: 12px;
  /* 默认宽度给个兜底；实际宽度由编辑对话框按"窗口比例 + 主人拖过的宽度"用行内样式覆盖 */
  width: 300px;
  max-width: 90vw;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 40px var(--shadow-medium);
  flex-shrink: 0;
  animation: slideInRight 0.3s ease;
  /* 注意：这里不要写 transition: all —— 拖拽调宽时会被 0.3s 动画拖成"橡皮筋"手感 */
}

@keyframes slideInRight {
  from {
    opacity: 0;
    transform: translateX(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.tag-panel-header {
  padding: 20px;
  border-bottom: 1px solid var(--border-color);
  position: sticky;
  top: 0;
  background: var(--bg-secondary);
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.tag-panel-toggle-all {
  padding: 3px 8px;
  font-size: 0.75rem;
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tag-panel-toggle-all:hover {
  color: var(--text-primary);
  border-color: var(--accent-color);
}

/* 分类标题行：名称 + 数量徽章 + 折叠箭头 */
.tag-list-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.tag-list-label {
  font-weight: 500;
}

.tag-section-toggle {
  margin-left: auto;
  width: 20px;
  height: 20px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  line-height: 1;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tag-section-toggle:hover {
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border-color: var(--border-color);
}

.tag-section-toggle.collapsed {
  color: var(--accent-color);
}

.tag-panel-header h4 {
  color: var(--text-primary);
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  transition: color 0.3s ease;
}

.tag-panel-body {
  padding: 20px;
}

.tag-search {
  margin-bottom: 16px;
}

.tag-search-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.875rem;
  transition: all 0.3s ease;
}

.tag-search-input:focus {
  outline: none;
  border-color: var(--accent-color);
  box-shadow: 0 0 0 2px rgba(var(--accent-color-rgb, 59, 130, 246), 0.1);
}

.tag-list-section {
  margin-bottom: 16px;
}

.tag-list-title {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-bottom: 12px;
  font-weight: 500;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-list-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.tag-count-badge {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 12px;
  font-weight: 500;
}

.tag-item-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tag-name {
  flex: 1;
}

.tag-item-btn:hover {
  background: var(--bg-secondary);
  border-color: var(--accent-color);
  transform: translateY(-1px);
}

.tag-item-selected {
  background: var(--accent-color);
  color: white;
  border-color: var(--accent-color);
}

.tag-item-selected:hover {
  background: var(--accent-hover);
}

.tag-count {
  background: rgba(0, 0, 0, 0.1);
  color: var(--text-secondary);
  font-size: 0.75rem;
  padding: 2px 6px;
  border-radius: 10px;
  font-weight: 500;
}

.tag-item-selected .tag-count {
  background: rgba(255, 255, 255, 0.2);
  color: white;
}

.tag-check {
  font-size: 0.75rem;
  font-weight: bold;
  margin-left: 4px;
}

.tag-empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-secondary);
}

.tag-empty-state p {
  margin: 0;
  font-size: 0.875rem;
}

.tag-empty-inline {
  padding: 12px 0;
}
.tag-empty-inline p {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

/* 响应式设计 */
@media (max-width: 768px) {
  .tag-selection-panel {
    width: 100%;
    max-width: 100%;
    margin: 0;
  }
}
</style>

