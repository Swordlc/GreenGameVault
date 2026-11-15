<!--
  标签编辑弹窗：重命名 / 合并 / 移除

  由页面视图（GenericResourceView）通过左栏筛选器的「编辑」图标唤起。
  这里只负责"问清楚要做什么"并 emit，真正的写库与界面同步都在页面视图里做。

  两个刻意设计的点（主人 2026-10-13 明确要求）：
  1. 重命名撞名 → 不执行，直接引导去用「合并标签」；
  2. 移除标签走**两层确认**，且两层的按钮左右位置**互换** ——
     第一层 [确认移除][取消]，第二层 [取消][确认移除]，
     这样连点两下时第二次落点会落在「取消」上，不会被自己的手速坑掉几百条记录。
-->
<template>
  <!-- 第一步：点编辑图标后贴着鼠标出现的小浮层，先问"要做什么" -->
  <div v-if="visible && !mode" class="action-layer" @mousedown="handleClose">
    <div class="action-popup" :style="popupStyle" @mousedown.stop>
      <div class="action-popup-title">{{ tagName }}</div>
      <button class="action-item" @click="chooseMode('rename')">✏️ 重命名</button>
      <button class="action-item" @click="chooseMode('merge')">🔗 合并标签…</button>
      <button class="action-item action-item-danger" @click="chooseMode('remove')">🗑️ 移除标签…</button>
    </div>
  </div>

  <div v-else-if="visible && mode" class="modal-overlay" @mousedown="handleOverlayMouseDown">
    <div class="modal-wrapper" :class="{ 'wrapper-wide': mode === 'merge' }">
      <div class="modal-content" @mousedown.stop>
        <div class="modal-header">
          <h3>{{ headerTitle }}</h3>
          <button class="btn-close" @click="handleClose">✕</button>
        </div>

        <div class="modal-body">
          <!-- 影响面：全库来自后端预览，括号里是当前页显示的数字 -->
          <div class="impact-box" :class="impactClass">
            <template v-if="previewLoading">
              <span class="impact-spinner">⏳</span> 正在按全库统计影响面…
            </template>
            <template v-else-if="previewError">
              <span class="impact-warn">⚠ {{ previewError }}</span>
            </template>
            <template v-else>
              <span class="impact-number">{{ globalAffected }}</span> 条记录将被修改（全库）
              <span v-if="pageAffected !== globalAffected" class="impact-note">
                · 当前页显示 {{ pageAffected }} 条
              </span>
            </template>
          </div>

          <!-- ============ 重命名 ============ -->
          <template v-if="mode === 'rename'">
            <div class="form-field-wrapper">
              <label class="form-label">把「{{ tagName }}」重命名为</label>
              <input
                ref="nameInput"
                v-model="targetName"
                class="text-input"
                type="text"
                placeholder="输入新的标签名"
                @keydown.enter="handleConfirm"
              >
            </div>
            <p v-if="duplicateName" class="hint hint-error">
              已存在名为「{{ targetName.trim() }}」的标签 —— 重命名会直接停下。
              如果本意是把两个标签并成一个，请用 <strong>合并标签</strong>。
            </p>
            <p v-else-if="isEmptyName" class="hint hint-error">新标签名不能为空。</p>
            <p v-else-if="isSameName" class="hint hint-error">新名字和原名一样。</p>
          </template>

          <!-- ============ 合并 ============ -->
          <template v-else-if="mode === 'merge'">
            <div class="form-field-wrapper">
              <label class="form-label">选择要合并到一起的标签（可多选）</label>
              <input
                v-model="mergeSearch"
                class="text-input"
                type="text"
                placeholder="搜索标签…"
              >
              <div class="tag-picker">
                <label
                  v-for="tag in filteredMergeTags"
                  :key="tag.name"
                  class="tag-picker-item"
                  :class="{ checked: mergeSelection.includes(tag.name) }"
                >
                  <input type="checkbox" :value="tag.name" v-model="mergeSelection">
                  <span class="tag-picker-name">{{ tag.name }}</span>
                  <span class="tag-picker-count">{{ tag.count }}</span>
                </label>
                <p v-if="filteredMergeTags.length === 0" class="tag-picker-empty">没有匹配的标签</p>
              </div>
            </div>
            <div class="form-field-wrapper">
              <label class="form-label">合并成的新标签名（可以直接填一个已有的标签名，表示并入它）</label>
              <input
                v-model="targetName"
                class="text-input"
                type="text"
                list="tag-ops-existing-names"
                placeholder="输入合并后的标签名"
                @keydown.enter="handleConfirm"
              >
              <datalist id="tag-ops-existing-names">
                <option v-for="tag in sortedAllTags" :key="tag.name" :value="tag.name" />
              </datalist>
            </div>
            <p v-if="mergeSelection.length < 1" class="hint hint-error">至少选一个标签。</p>
            <p v-else-if="isEmptyName" class="hint hint-error">合并后的标签名不能为空。</p>
            <p v-else class="hint">
              将把 {{ mergeSelection.map(n => `「${n}」`).join('、') }} 合并为「{{ targetName.trim() }}」
              <template v-if="targetAlreadyExists">（该标签已存在，等于并入它）</template>。
              同一条记录里同时挂了其中几个时，只会留下一个新标签。
              <br>当前页预估影响 {{ pageAffected }} 条；全库数量见上方。
            </p>
          </template>

          <!-- ============ 移除：第一层 ============ -->
          <template v-else-if="mode === 'remove' && confirmStep === 1">
            <p class="danger-text">
              即将把标签「{{ tagName }}」从所有记录里<strong>彻底移除</strong>。
            </p>
            <p class="hint">
              这是批量改动，不能靠"再点一次"还原 —— 但 GGV 会在动手前自动备份一份，
              事后可用左栏底部的「撤销」还原。
            </p>
          </template>

          <!-- ============ 移除：第二层（按钮左右互换） ============ -->
          <template v-else-if="mode === 'remove' && confirmStep === 2">
            <p class="danger-text danger-strong">
              ⚠ 再确认一次：真的要移除「{{ tagName }}」吗？
            </p>
            <p class="hint">
              将影响上方列出的记录条数。注意这一层的按钮位置和上一层<strong>故意颠倒</strong>，
              是为了防止连点两下直接确认掉。
            </p>
          </template>
        </div>

        <!-- 底部按钮：移除的第一层"确认在左取消在右"，第二层互换 -->
        <div class="modal-footer">
          <template v-if="mode === 'remove' && confirmStep === 1">
            <button class="btn-confirm btn-danger" @click="goSecondStep">确认移除</button>
            <button class="btn-cancel" @click="handleClose">取消</button>
          </template>
          <template v-else-if="mode === 'remove' && confirmStep === 2">
            <button class="btn-cancel" @click="handleClose">取消</button>
            <button class="btn-confirm btn-danger" @click="handleConfirm">确认移除</button>
          </template>
          <template v-else>
            <button class="btn-cancel" @click="handleClose">取消</button>
            <button class="btn-confirm" :disabled="!canSubmit" @click="handleConfirm">
              {{ mode === 'merge' ? '确认合并' : '确认重命名' }}
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

export interface TagOpTagItem { name: string; count: number }

export default {
  name: 'TagOpsDialog',
  props: {
    visible: { type: Boolean, default: false },
    /** 'rename' | 'merge' | 'remove' */
    mode: { type: String as () => 'rename' | 'merge' | 'remove' | null, default: null },
    /** 被点的那个标签名（= A） */
    tagName: { type: String, default: '' },
    /** 分区标题，如「标签筛选」 */
    fieldLabel: { type: String, default: '' },
    /** 该字段是否为数组字段（只用于文案） */
    isArray: { type: Boolean, default: true },
    /** 点编辑图标时的鼠标位置（浮层贴着它出现） */
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    /** 同一字段的全部标签（合并列表与撞名判断用） */
    allTags: { type: Array as () => TagOpTagItem[], default: () => [] },
    /** 当前页里受影响的条数（界面侧预估） */
    pageAffected: { type: Number, default: 0 },
    /** 后端预览：全库影响条数（null 表示还没算出来） */
    globalAffected: { type: Number, default: null },
    previewLoading: { type: Boolean, default: false },
    previewError: { type: String, default: '' }
  },
  emits: ['confirm', 'cancel', 'choose-mode', 'preview-request'],
  setup(props: any, { emit }: any) {
    const targetName = ref('')
    const mergeSelection = ref<string[]>([])
    const mergeSearch = ref('')
    const confirmStep = ref(1)
    const nameInput = ref<HTMLInputElement | null>(null)

    /** 每次打开都按当前模式初始化 */
    watch(() => [props.visible, props.mode, props.tagName], () => {
      if (!props.visible) return
      targetName.value = props.mode === 'merge' ? '' : (props.tagName || '')
      mergeSelection.value = props.tagName ? [props.tagName] : []
      mergeSearch.value = ''
      confirmStep.value = 1
      nextTick(() => {
        if (props.mode === 'rename') nameInput.value?.focus()
      })
    }, { immediate: true })

    const headerTitle = computed(() => {
      if (props.mode === 'rename') return `重命名标签 · ${props.fieldLabel || ''}`.trim()
      if (props.mode === 'merge') return `合并标签 · ${props.fieldLabel || ''}`.trim()
      if (props.mode === 'remove') return `移除标签 · ${props.fieldLabel || ''}`.trim()
      return '标签编辑'
    })

    const trimmedName = computed(() => String(targetName.value || '').trim())
    const isEmptyName = computed(() => trimmedName.value === '')
    const isSameName = computed(() => props.mode === 'rename' && trimmedName.value === String(props.tagName || ''))
    /** 撞名：字段里已经存在这个名字（且不是自己） */
    const duplicateName = computed(() => {
      if (isEmptyName.value) return false
      if (trimmedName.value === String(props.tagName || '')) return false
      return (props.allTags || []).some((tag: TagOpTagItem) => tag.name === trimmedName.value)
    })
    /** 合并目标已存在（合法，等于并入） */
    const targetAlreadyExists = computed(() => {
      if (isEmptyName.value) return false
      return (props.allTags || []).some((tag: TagOpTagItem) => tag.name === trimmedName.value)
    })

    const sortedAllTags = computed(() => {
      const list = [...(props.allTags || [])]
      return list.sort((a, b) => (b.count || 0) - (a.count || 0) || a.name.localeCompare(b.name, 'zh-CN'))
    })

    const filteredMergeTags = computed(() => {
      const query = String(mergeSearch.value || '').trim().toLowerCase()
      if (!query) return sortedAllTags.value
      return sortedAllTags.value.filter(tag => tag.name.toLowerCase().includes(query))
    })

    const canSubmit = computed(() => {
      if (props.mode === 'rename') return !isEmptyName.value && !isSameName.value && !duplicateName.value
      if (props.mode === 'merge') return !isEmptyName.value && mergeSelection.value.length >= 1
      return true
    })

    const impactClass = computed(() => {
      if (props.previewError) return 'impact-error'
      if (props.mode === 'remove') return 'impact-danger'
      return ''
    })

    const handleClose = () => emit('cancel')
    const handleOverlayMouseDown = () => handleClose()

    /** 浮层位置：贴着鼠标，但不越出窗口 */
    const popupStyle = computed(() => {
      const width = 190
      const height = 150
      const maxX = Math.max(8, (typeof window !== 'undefined' ? window.innerWidth : 1280) - width - 8)
      const maxY = Math.max(8, (typeof window !== 'undefined' ? window.innerHeight : 800) - height - 8)
      const left = Math.min(Math.max(8, Number(props.x) || 0), maxX)
      const top = Math.min(Math.max(8, Number(props.y) || 0), maxY)
      return { left: `${left}px`, top: `${top}px` }
    })

    const chooseMode = (mode: 'rename' | 'merge' | 'remove') => emit('choose-mode', mode)

    // 合并：勾选变了就请页面重新按全库统计一次影响面（防抖，别每点一下都去扫全库）
    let previewTimer: ReturnType<typeof setTimeout> | null = null
    watch(
      () => [props.mode, [...mergeSelection.value]],
      () => {
        if (!props.visible || props.mode !== 'merge') return
        if (previewTimer) clearTimeout(previewTimer)
        previewTimer = setTimeout(() => {
          emit('preview-request', { action: 'merge', from: [...mergeSelection.value] })
        }, 600)
      }
    )
    onBeforeUnmount(() => { if (previewTimer) clearTimeout(previewTimer) })

    const goSecondStep = () => { confirmStep.value = 2 }

    const handleConfirm = () => {
      if (props.mode === 'remove') {
        // 第一层点"确认移除"只是进入第二层，不执行
        if (confirmStep.value === 1) return goSecondStep()
        emit('confirm', { action: 'remove', from: [props.tagName], to: null })
        return
      }
      if (!canSubmit.value) return
      if (props.mode === 'rename') {
        emit('confirm', { action: 'rename', from: [props.tagName], to: trimmedName.value })
        return
      }
      emit('confirm', { action: 'merge', from: [...mergeSelection.value], to: trimmedName.value })
    }

    return {
      targetName,
      mergeSelection,
      mergeSearch,
      confirmStep,
      nameInput,
      headerTitle,
      trimmedName,
      isEmptyName,
      isSameName,
      duplicateName,
      targetAlreadyExists,
      sortedAllTags,
      filteredMergeTags,
      canSubmit,
      impactClass,
      popupStyle,
      chooseMode,
      handleClose,
      handleOverlayMouseDown,
      goSecondStep,
      handleConfirm
    }
  }
}
</script>

<style scoped lang="scss">
/* 第一步的三动作浮层（fixed 定位：必须逃出左栏的滚动裁剪） */
.action-layer {
  position: fixed;
  inset: 0;
  z-index: 10060;
}

.action-popup {
  position: fixed;
  min-width: 180px;
  padding: 6px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.action-popup-title {
  padding: 4px 8px 6px;
  font-size: 0.78rem;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 4px;
  word-break: break-all;
}

.action-item {
  padding: 7px 10px;
  text-align: left;
  font-size: 0.88rem;
  color: var(--text-primary);
  background: transparent;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: var(--bg-tertiary);
  }
}

.action-item-danger {
  color: #e5484d;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10050;
}

.modal-wrapper {
  width: 100%;
  max-width: 520px;
  padding: 20px;

  &.wrapper-wide {
    max-width: 640px;
  }
}

.modal-content {
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  max-height: 88vh;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);

  h3 {
    margin: 0;
    font-size: 1.05rem;
    color: var(--text-primary);
  }

  .btn-close {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    transition: background 0.2s;

    &:hover {
      background: var(--bg-tertiary);
      color: var(--text-primary);
    }
  }
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
}

/* 影响面提示条 */
.impact-box {
  padding: 10px 12px;
  margin-bottom: 16px;
  border-radius: var(--radius-md);
  background: var(--bg-tertiary);
  border-left: 3px solid var(--accent-color);
  font-size: 0.9rem;
  color: var(--text-primary);

  &.impact-danger {
    border-left-color: #e5484d;
  }

  &.impact-error {
    border-left-color: #e5a000;
  }
}

.impact-number {
  font-weight: 700;
  font-size: 1.05rem;
  color: var(--accent-color);
}

.impact-note {
  color: var(--text-secondary);
  font-size: 0.82rem;
}

.impact-warn {
  color: #e5a000;
}

.form-field-wrapper {
  margin-bottom: 16px;

  &:last-child {
    margin-bottom: 0;
  }

  .form-label {
    display: block;
    margin-bottom: 8px;
    font-size: 0.9rem;
    color: var(--text-primary);
    font-weight: 500;
  }
}

.text-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.9rem;

  &:focus {
    outline: none;
    border-color: var(--accent-color);
  }
}

/* 合并：标签勾选列表 */
.tag-picker {
  margin-top: 10px;
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
}

.tag-picker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 0.88rem;
  color: var(--text-primary);

  &:hover {
    background: var(--bg-tertiary);
  }

  &.checked {
    background: var(--bg-tertiary);
    font-weight: 600;
  }

  .tag-picker-name {
    flex: 1;
  }

  .tag-picker-count {
    font-size: 0.78rem;
    color: var(--text-secondary);
  }
}

.tag-picker-empty {
  margin: 0;
  padding: 12px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.hint {
  margin: 0 0 8px 0;
  font-size: 0.85rem;
  line-height: 1.5;
  color: var(--text-secondary);
}

.hint-error {
  color: #e5484d;
}

.danger-text {
  margin: 0 0 10px 0;
  font-size: 0.95rem;
  line-height: 1.6;
  color: var(--text-primary);
}

.danger-strong {
  color: #e5484d;
  font-weight: 600;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color);
}

.btn-cancel,
.btn-confirm {
  padding: 8px 20px;
  border-radius: var(--radius-md);
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
}

.btn-cancel {
  background: var(--bg-tertiary);
  color: var(--text-primary);

  &:hover {
    background: var(--bg-hover);
  }
}

.btn-confirm {
  background: var(--accent-color);
  color: white;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.btn-danger {
  background: #e5484d;
}
</style>
