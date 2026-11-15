<!-- 页面左侧的筛选栏，支持任意数量的筛选器 -->
<template>
  <div class="filter-sidebar">
    <!-- 加载状态 -->
    <FunLoading v-if="isLoading" text="正在加载筛选器..." />
    
    <!-- 动态筛选器列表 -->
    <div 
      v-else-if="filters.length > 0"
      v-for="filter in filters" 
      :key="filter.key"
      class="filter-section"
    >
      <div class="filter-header">
        <h3>{{ filter.title }}</h3>
        <button 
          class="btn-clear-filter" 
          @click="clearFilter(filter.key)" 
          v-if="(filter.selected && filter.selected.length > 0) || (filter.excluded && filter.excluded.length > 0)"
        >
          ✕ 清除筛选
        </button>
      </div>

      <!-- 条目多的时候给个模糊搜索框（标签/作者动辄几十上百个，翻起来太累） -->
      <div v-if="needsSearchBox(filter)" class="filter-search">
        <input
          v-model="searchQueries[filter.key]"
          class="filter-search-input"
          type="text"
          :placeholder="`筛选${filter.title.replace('筛选', '')}…（空格分词）`"
        >
        <span v-if="searchQueries[filter.key]" class="filter-search-clear" @click="clearSearch(filter.key)">✕</span>
      </div>

      <div class="filter-list">
        <div 
          v-for="item in visibleItems(filter)" 
          :key="item.name"
          class="filter-item"
          :class="{ 
            active: filter.selected && filter.selected.includes(item.name),
            excluded: filter.excluded && filter.excluded.includes(item.name)
          }"
          @click="selectFilter(filter.key, item.name)"
          @contextmenu.prevent="excludeFilter(filter.key, item.name)"
        >
          <!-- 悬停才出现的编辑入口：重命名 / 合并 / 移除（只有真实入库的字段才有） -->
          <button
            v-if="filter.editable"
            class="filter-edit-btn"
            :title="`编辑标签「${item.name}」：重命名 / 合并 / 移除`"
            @click.stop="openTagEdit(filter, item, $event)"
          >✏️</button>
          <span v-if="filter.selected && filter.selected.includes(item.name)" class="include-indicator">✓</span>
          <span v-if="filter.excluded && filter.excluded.includes(item.name)" class="exclude-indicator">∅</span>
          <span class="filter-name">{{ getDisplayName(item.name) }}</span>
          <span class="filter-count">({{ item.count }})</span>
        </div>
        <div v-if="filter.items.length === 0" class="no-filters">
          暂无{{ filter.title.replace('筛选', '') }}
        </div>
        <div v-else-if="visibleItems(filter).length === 0" class="no-filters">
          没有匹配的{{ filter.title.replace('筛选', '') }}
        </div>
      </div>
    </div>
    
    <!-- 空状态 -->
    <div v-else class="empty-state">
      <div class="empty-icon">🔍</div>
      <p class="empty-text">暂无筛选器数据</p>
    </div>

    <!-- 撤销上一次标签操作（重命名/合并/移除都能撤，备份存在才有这一条） -->
    <div v-if="undoLabel" class="tag-undo-bar">
      <button class="btn-tag-undo" :disabled="undoing" @click="$emit('tag-op-undo')">
        ↩ {{ undoLabel }}
      </button>
    </div>
  </div>
</template>

<script>
import disguiseManager from '../utils/DisguiseManager'
import { isDisguiseModeEnabled } from '../utils/disguiseMode'
import FunLoading from '../fun-ui/feedback/Loading/FunLoading.vue'
import { matchesFuzzy } from '../utils/fuzzySearch'
import { formatUndoLabel } from '../utils/tagOps'

/** 条目超过这个数量才给搜索框（少量条目没必要占地方） */
const SEARCH_BOX_THRESHOLD = 8

export default {
  name: 'FilterSidebar',
  components: {
    FunLoading
  },
  props: {
    filters: {
      type: Array,
      default: () => [],
      validator: (filters) => {
        // 验证筛选器数组的格式
        return filters.every(filter => 
          filter.key && 
          filter.title && 
          Array.isArray(filter.items) &&
          (Array.isArray(filter.selected) || filter.selected === null) &&
          (Array.isArray(filter.excluded) || filter.excluded === null)
        )
      }
    },
    isLoading: {
      type: Boolean,
      default: false
    },
    /** 最近一次可撤销的标签操作（null = 没得撤，这时不显示底部按钮） */
    undoInfo: {
      type: Object,
      default: null
    },
    /** 撤销请求进行中（防连点） */
    undoing: {
      type: Boolean,
      default: false
    }
  },
  emits: ['filter-select', 'filter-exclude', 'filter-clear', 'tag-edit', 'tag-op-undo'],
  computed: {
    /** 底部「撤销」按钮的文案；没有可撤销的操作时返回 null */
    undoLabel() {
      try {
        return formatUndoLabel(this.undoInfo)
      } catch (error) {
        console.warn('[FilterSidebar] 生成撤销文案失败:', error)
        return null
      }
    }
  },
  data() {
    return {
      disguiseModeState: false, // 伪装模式状态
      disguiseNameCache: {}, // 伪装名称缓存
      // 每个筛选器分区各自的搜索词（key → 关键词）
      searchQueries: {}
    }
  },
  methods: {
    /** 条目够多才需要搜索框 */
    needsSearchBox(filter) {
      return Array.isArray(filter?.items) && filter.items.length > SEARCH_BOX_THRESHOLD
    },
    /**
     * 分区内做模糊筛选：
     *  - 命中规则与页面搜索一致（空格分词 / 忽略分隔符 / 子序列）
     *  - **已选中/已排除的条目永远显示**，否则筛完之后想取消都找不到它
     */
    visibleItems(filter) {
      const query = String(this.searchQueries[filter.key] || '').trim()
      const items = Array.isArray(filter?.items) ? filter.items : []
      if (!query) return items

      const pinned = new Set([...(filter.selected || []), ...(filter.excluded || [])])
      return items.filter(item => pinned.has(item.name) || matchesFuzzy([String(item.name)], query))
    },
    clearSearch(filterKey) {
      this.searchQueries = { ...this.searchQueries, [filterKey]: '' }
    },
    selectFilter(filterKey, itemName) {
      console.log('FilterSidebar selectFilter:', filterKey, itemName)
      this.$emit('filter-select', { filterKey, itemName })
    },
    excludeFilter(filterKey, itemName) {
      console.log('FilterSidebar excludeFilter:', filterKey, itemName)
      this.$emit('filter-exclude', { filterKey, itemName })
    },
    clearFilter(filterKey) {
      this.$emit('filter-clear', filterKey)
    },
    /**
     * 点标签上的编辑图标：把「哪个分区、哪个标签」交给页面处理
     * （具体的重命名/合并/移除弹窗与写库都在页面视图里，因为只有它知道当前页的资源类型）
     */
    openTagEdit(filter, item, event) {
      console.log('[FilterSidebar] 请求编辑标签:', filter?.key, filter?.field, item?.name)
      this.$emit('tag-edit', {
        filterKey: filter?.key,
        field: filter?.field || null,
        resourceType: filter?.resourceType || null,
        isArray: filter?.isArray === true,
        filterTitle: filter?.title || '',
        itemName: item?.name,
        items: Array.isArray(filter?.items) ? filter.items : [],
        // 三个动作的小浮层要贴着鼠标出现（侧栏有滚动裁剪，浮层用 fixed 定位）
        x: event ? event.clientX : 0,
        y: event ? event.clientY : 0
      })
    },
    /**
     * 获取显示名称（支持伪装模式）
     */
    getDisplayName(originalName) {
      if (this.disguiseModeState) {
        // 检查缓存
        if (this.disguiseNameCache && this.disguiseNameCache[originalName]) {
          return this.disguiseNameCache[originalName]
        }
        
        // 异步加载（不阻塞渲染）
        this.loadDisguiseName(originalName)
        return originalName // 先返回原始名称，等异步加载完成后再更新
      }
      return originalName
    },
    
    /**
     * 异步加载名称伪装
     * @param {string} originalName - 原始名称
     */
    async loadDisguiseName(originalName) {
      try {
        const disguiseName = await disguiseManager.getDisguiseTag(originalName)
        // 初始化缓存对象（如果不存在）
        if (!this.disguiseNameCache) {
          this.disguiseNameCache = {}
        }
        // 使用Vue的响应式更新
        this.$set ? this.$set(this.disguiseNameCache, originalName, disguiseName) : (this.disguiseNameCache[originalName] = disguiseName)
        // 强制更新组件
        this.$forceUpdate()
        console.log(`[FilterSidebar] 标签伪装已加载: "${originalName}" -> "${disguiseName}"`)
      } catch (error) {
        console.error('[FilterSidebar] 加载名称伪装失败:', error)
      }
    },
    /**
     * 更新伪装模式状态
     */
    updateDisguiseModeState() {
      const newState = isDisguiseModeEnabled()
      if (this.disguiseModeState !== newState) {
        console.log('[FilterSidebar] 伪装模式状态变化:', this.disguiseModeState, '->', newState)
        this.disguiseModeState = newState
        // 强制组件重新渲染
        this.$forceUpdate()
      }
    },
    /**
     * 监听 localStorage 变化
     */
    handleStorageChange(event) {
      if (event.key === 'butter-manager-settings') {
        console.log('[FilterSidebar] 检测到设置变化，更新伪装模式状态')
        this.updateDisguiseModeState()
      }
    }
  },
  mounted() {
    // 初始化伪装模式状态
    this.disguiseModeState = isDisguiseModeEnabled()
    console.log('[FilterSidebar] mounted: 初始伪装模式状态:', this.disguiseModeState)
    
    // 监听 storage 事件以响应设置变化
    window.addEventListener('storage', this.handleStorageChange)
    
    // 监听自定义事件
    window.addEventListener('disguise-mode-changed', this.updateDisguiseModeState)
  },
  beforeUnmount() {
    // 清理事件监听器
    window.removeEventListener('storage', this.handleStorageChange)
    window.removeEventListener('disguise-mode-changed', this.updateDisguiseModeState)
  }
}
</script>

<style scoped>
.filter-sidebar {
  width: 250px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  transition: background-color 0.3s ease;
}

/* 筛选器样式 */
.filter-section {
  border-top: 1px solid var(--border-color);
  margin-top: 10px;
  padding: 20px 0 0 0;
}

.filter-section:first-child {
  border-top: none;
  margin-top: 0;
  padding-top: 20px;
}

.filter-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 20px 10px 20px;
}

.filter-header h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 1.1rem;
  font-weight: 600;
  transition: color 0.3s ease;
}

.btn-clear-filter {
  background: var(--accent-color);
  color: white;
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: background 0.3s ease;
}

.btn-clear-filter:hover {
  background: var(--accent-hover);
}

/* 分区内的模糊搜索框（条目多时才出现） */
.filter-search {
  position: relative;
  display: flex;
  align-items: center;
  padding: 0 20px 8px 20px;
}

.filter-search-input {
  width: 100%;
  padding: 5px 24px 5px 8px;
  font-size: 0.8rem;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.filter-search-input:focus {
  outline: none;
  border-color: var(--accent-color);
}

.filter-search-clear {
  position: absolute;
  right: 28px;
  cursor: pointer;
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

.filter-search-clear:hover {
  color: var(--text-primary);
}

.filter-list {
  padding: 0;
  max-height: 800px; /* 限制最大高度 */
  overflow-y: auto; /* 添加独立滚动条 */
  overflow-x: hidden;
  /* 美化滚动条样式已移至全局 reset.scss */
}

.filter-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 20px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.3s ease;
  border-left: 3px solid transparent;
}

.filter-item:hover {
  background: var(--bg-tertiary);
}

.filter-item.active {
  background: #4caf50;
  color: white;
  border-left-color: #45a049;
}

.filter-item.active .filter-count {
  color: rgba(255, 255, 255, 0.8);
}

.filter-item.excluded {
  background: #ff6b6b;
  color: white;
  border-left-color: #ff5252;
}

.filter-item.excluded .filter-count {
  color: rgba(255, 255, 255, 0.8);
}

/* 确保文字不居中 */
.filter-item {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  position: relative; /* 编辑图标绝对定位用，避免挤动既有排版 */
}

/* 悬停才浮现的编辑图标（放在最左侧，不占位、不挤压文字） */
.filter-edit-btn {
  position: absolute;
  left: 1px;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  line-height: 1;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  opacity: 0;
  cursor: pointer;
  transition: opacity 0.15s ease, background 0.15s ease;
}

.filter-item:hover .filter-edit-btn {
  opacity: 0.75;
}

.filter-edit-btn:hover {
  opacity: 1;
  background: rgba(127, 127, 127, 0.25);
}

/* 底部「撤销上一次标签操作」 */
.tag-undo-bar {
  margin-top: auto;
  padding: 12px 16px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
  position: sticky;
  bottom: 0;
}

.btn-tag-undo {
  width: 100%;
  padding: 8px 10px;
  font-size: 0.78rem;
  line-height: 1.3;
  text-align: left;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-tag-undo:hover:not(:disabled) {
  border-color: var(--accent-color);
  background: var(--bg-primary);
}

.btn-tag-undo:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.include-indicator {
  margin-right: 8px;
  font-size: 1rem;
  font-weight: bold;
  color: white;
}

.exclude-indicator {
  margin-right: 8px;
  font-size: 1rem;
  font-weight: bold;
  color: white;
}

.filter-name {
  font-weight: 500;
  transition: color 0.3s ease;
}

.filter-count {
  font-size: 0.8rem;
  color: var(--text-tertiary);
  transition: color 0.3s ease;
}

.no-filters {
  padding: 20px;
  text-align: center;
  color: var(--text-tertiary);
  font-style: italic;
}

/* 空状态样式 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
}

.empty-icon {
  font-size: 2rem;
  margin-bottom: 12px;
  opacity: 0.6;
}

.empty-text {
  color: var(--text-tertiary);
  font-size: 0.9rem;
  margin: 0;
  transition: color 0.3s ease;
}
</style>
