<!--
  主页全局标签筛选：下拉 + 搜索 + 多选（包含/排除）
  交互与游戏管理页左侧标签栏同语义：
    - 包含（✓）：必须命中全部选中标签（AND）
    - 排除（∅）：命中任意一个排除标签即淘汰（NOT ANY）
  点击标签循环切换 无 → 包含 → 排除 → 无。
-->
<template>
  <div class="tag-filter" ref="root">
    <div class="tf-bar">
      <button
        type="button"
        class="tf-trigger"
        :class="{ 'is-active': hasActive }"
        @click="togglePanel"
      >
        <span class="tf-trigger-icon">🏷️</span>
        <span class="tf-trigger-text">{{ $t('home.tagFilterTitle') }}</span>
        <span v-if="selected.length" class="tf-badge is-include">+{{ selected.length }}</span>
        <span v-if="excluded.length" class="tf-badge is-exclude">−{{ excluded.length }}</span>
        <span class="tf-caret">{{ open ? '▲' : '▼' }}</span>
      </button>

      <!-- 已生效的筛选条件，收起面板也能看见并逐个摘掉 -->
      <div v-if="hasActive" class="tf-chips">
        <span
          v-for="tag in selected"
          :key="`in-${tag}`"
          class="tf-chip is-include"
          :title="$t('home.tagChipRemove')"
          @click="setState(tag, 'none')"
        >
          <span class="tf-chip-mark">✓</span>{{ tag }}<span class="tf-chip-x">×</span>
        </span>
        <span
          v-for="tag in excluded"
          :key="`ex-${tag}`"
          class="tf-chip is-exclude"
          :title="$t('home.tagChipRemove')"
          @click="setState(tag, 'none')"
        >
          <span class="tf-chip-mark">∅</span>{{ tag }}<span class="tf-chip-x">×</span>
        </span>
        <button type="button" class="tf-chip-clear" @click="clearAll">{{ $t('home.tagClearAll') }}</button>
      </div>
    </div>

    <!-- 下拉面板 -->
    <div v-if="open" class="tf-panel">
      <div class="tf-panel-head">
        <input
          ref="search"
          v-model="keyword"
          class="tf-search"
          type="text"
          :placeholder="$t('home.tagSearchPlaceholder')"
        />
      </div>

      <div class="tf-list">
        <div
          v-for="tag in visibleTags"
          :key="tag.name"
          class="tf-item"
          :class="`is-${stateOf(tag.name)}`"
          @click="cycle(tag.name)"
        >
          <span class="tf-item-mark">{{ markOf(tag.name) }}</span>
          <span class="tf-item-name">{{ tag.name }}</span>
          <span class="tf-item-count">{{ tag.count }}</span>
        </div>
        <div v-if="visibleTags.length === 0" class="tf-empty">
          {{ tags.length === 0 ? $t('home.tagEmptyLibrary') : $t('home.tagEmptySearch') }}
        </div>
      </div>

      <div class="tf-footer">{{ $t('home.tagCycleTip') }}</div>
    </div>
  </div>
</template>

<script lang="ts">
export default {
  name: 'TagFilterMenu',
  props: {
    /** 全库标签及出现次数：[{ name, count }] */
    tags: {
      type: Array as () => Array<{ name: string; count: number }>,
      default: () => []
    },
    /** 选中（包含）的标签 */
    selected: {
      type: Array as () => string[],
      default: () => []
    },
    /** 排除的标签 */
    excluded: {
      type: Array as () => string[],
      default: () => []
    }
  },
  emits: ['update'],
  data() {
    return {
      open: false,
      keyword: ''
    }
  },
  computed: {
    hasActive(): boolean {
      return this.selected.length > 0 || this.excluded.length > 0
    },
    visibleTags(): Array<{ name: string; count: number }> {
      const keyword = this.keyword.trim().toLowerCase()
      if (!keyword) return this.tags
      return this.tags.filter(tag => tag.name.toLowerCase().includes(keyword))
    }
  },
  methods: {
    togglePanel() {
      this.open = !this.open
      if (this.open) {
        this.$nextTick(() => {
          const input = this.$refs.search as HTMLInputElement | undefined
          if (input) input.focus()
        })
      }
    },
    closePanel() {
      this.open = false
    },
    stateOf(name: string): 'include' | 'exclude' | 'none' {
      if (this.selected.includes(name)) return 'include'
      if (this.excluded.includes(name)) return 'exclude'
      return 'none'
    },
    markOf(name: string): string {
      const state = this.stateOf(name)
      if (state === 'include') return '✓'
      if (state === 'exclude') return '∅'
      return ''
    },
    /** 无 → 包含 → 排除 → 无 */
    cycle(name: string) {
      const state = this.stateOf(name)
      const next = state === 'none' ? 'include' : state === 'include' ? 'exclude' : 'none'
      this.setState(name, next)
    },
    setState(name: string, state: 'include' | 'exclude' | 'none') {
      const selected = this.selected.filter(tag => tag !== name)
      const excluded = this.excluded.filter(tag => tag !== name)
      if (state === 'include') selected.push(name)
      if (state === 'exclude') excluded.push(name)
      this.emitUpdate(selected, excluded)
    },
    clearAll() {
      this.emitUpdate([], [])
    },
    emitUpdate(selected: string[], excluded: string[]) {
      this.$emit('update', { selected, excluded })
    },
    handleDocumentMouseDown(event: MouseEvent) {
      if (!this.open) return
      const root = this.$refs.root as HTMLElement | undefined
      if (root && event.target instanceof Node && root.contains(event.target)) return
      this.closePanel()
    }
  },
  mounted() {
    document.addEventListener('mousedown', this.handleDocumentMouseDown)
  },
  beforeUnmount() {
    document.removeEventListener('mousedown', this.handleDocumentMouseDown)
  }
}
</script>

<style scoped>
.tag-filter {
  position: relative;
}

.tf-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.tf-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.85rem;
  border: 1px solid #d8d8d8;
  border-radius: 6px;
  background: #fff;
  color: #333;
  font-size: 0.9rem;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
}

.tf-trigger:hover {
  border-color: #dc2626;
}

.tf-trigger.is-active {
  border-color: #dc2626;
  background: #fff5f5;
  color: #b91c1c;
  font-weight: 600;
}

.tf-badge {
  font-size: 0.75rem;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 10px;
  line-height: 1.4;
}

.tf-badge.is-include {
  background: #4caf50;
  color: #fff;
}

.tf-badge.is-exclude {
  background: #ff6b6b;
  color: #fff;
}

.tf-caret {
  font-size: 0.6rem;
  opacity: 0.65;
}

.tf-chips {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.tf-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 6px;
  border-radius: 12px;
  font-size: 0.78rem;
  cursor: pointer;
  user-select: none;
}

.tf-chip.is-include {
  background: #e8f5e9;
  color: #2e7d32;
  border: 1px solid #a5d6a7;
}

.tf-chip.is-exclude {
  background: #ffebee;
  color: #c62828;
  border: 1px solid #ef9a9a;
}

.tf-chip-mark {
  font-weight: 700;
}

.tf-chip-x {
  margin-left: 2px;
  opacity: 0.5;
}

.tf-chip:hover .tf-chip-x {
  opacity: 1;
}

.tf-chip-clear {
  background: none;
  border: none;
  color: #888;
  font-size: 0.78rem;
  cursor: pointer;
  text-decoration: underline;
  padding: 0 4px;
}

.tf-chip-clear:hover {
  color: #dc2626;
}

.tf-panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 40;
  width: 340px;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  overflow: hidden;
}

.tf-panel-head {
  padding: 0.6rem 0.7rem;
  border-bottom: 1px solid #f0f0f0;
}

.tf-search {
  width: 100%;
  box-sizing: border-box;
  padding: 0.4rem 0.6rem;
  border: 1px solid #ddd;
  border-radius: 5px;
  font-size: 0.85rem;
  outline: none;
}

.tf-search:focus {
  border-color: #dc2626;
}

.tf-list {
  max-height: 320px;
  overflow-y: auto;
  padding: 0.3rem 0;
}

.tf-item {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.35rem 0.75rem;
  font-size: 0.85rem;
  color: #333;
  cursor: pointer;
  border-left: 3px solid transparent;
}

.tf-item:hover {
  background: #f7f7f7;
}

.tf-item.is-include {
  background: #e8f5e9;
  color: #1b5e20;
  border-left-color: #4caf50;
  font-weight: 600;
}

.tf-item.is-exclude {
  background: #ffebee;
  color: #b71c1c;
  border-left-color: #ff6b6b;
  font-weight: 600;
}

.tf-item-mark {
  width: 0.9rem;
  text-align: center;
  font-weight: 700;
}

.tf-item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tf-item-count {
  font-size: 0.75rem;
  color: #999;
}

.tf-empty {
  padding: 1.5rem 1rem;
  text-align: center;
  color: #999;
  font-size: 0.83rem;
}

.tf-footer {
  padding: 0.45rem 0.75rem;
  border-top: 1px solid #f0f0f0;
  background: #fafafa;
  color: #888;
  font-size: 0.75rem;
}
</style>
