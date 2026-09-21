<template>
  <div class="fun-shortcut-input">
    <div class="shortcut-display" v-if="modelValue && modelValue.trim() !== '' && !editingShortcut">
      <template v-for="(part, index) in modelValue.split('+')" :key="index">
        <kbd class="kbd">{{ part.trim() }}</kbd>
        <kbd class="kbd-separator" v-if="index < (modelValue.split('+').length - 1)">+</kbd>
      </template>
      <button class="btn-edit-shortcut" @click="onEditClick">✏️</button>
    </div>
    <input
        v-else
        type="text"
        class="setting-input"
        :value="modelValue"
        :placeholder="defaultShortcut"
        @input="onInput"
        @blur="onBlur"
        @keydown.enter="onBlur"
        ref="shortcutInput"
      />
  </div>
</template>

<script lang="ts">
export default {
  name: 'FunShortcutInput',
  props: {
    modelValue: {
      type: String,
      default: ''
    },
    defaultShortcut: {
      type: String,
      required: true
    }
  },
  emits: ['update:modelValue'],
  data() {
    return {
      editingShortcut: false
    }
  },
  methods: {
    onEditClick() {
      this.editingShortcut = true
      // 等待DOM更新后聚焦输入框
      this.$nextTick(() => {
        if (this.$refs.shortcutInput) {
          (this.$refs.shortcutInput as HTMLInputElement).focus()
        }
      })
    },
    onInput(event: Event) {
      const value = (event.target as HTMLInputElement).value
      this.$emit('update:modelValue', value)
    },
    onBlur() {
      // 当输入框为空时，自动设置为默认的快捷键
      if (!this.modelValue || this.modelValue.trim() === '') {
        this.$emit('update:modelValue', this.defaultShortcut)
      }
      this.editingShortcut = false
    }
  }
}
</script>

<style scoped>
.fun-shortcut-input {
  display: flex;
  align-items: center;
}

.shortcut-display {
  display: flex;
  align-items: center;
  gap: 5px;
}

.kbd {
  background-color: hsl(0deg, 0%, 99%);
  border-radius: 6px;
  border: 2px solid hsl(0deg, 0%, 80%);
  padding: 6px 8px;
  font-weight: bold;
  font-size: 0.95rem;
  min-width: 25px;
  text-align: center;
  display: inline-block;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  transition: all 0.3s ease;
}

.kbd:hover {
  border-color: var(--accent-color);
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.kbd-separator {
  margin: 0 5px;
  font-weight: bold;
  color: hsl(0deg, 0%, 50%);
  background: none;
  border: none;
  padding: 0;
}

.btn-edit-shortcut {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 1.1rem;
  margin-left: 12px;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.3s ease;
}

.btn-edit-shortcut:hover {
  background: var(--hover-bg);
  color: var(--accent-color);
  transform: translateY(-1px);
}

.setting-input {
  padding: 10px 14px;
  border: 2px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 1rem;
  min-width: 220px;
  transition: all 0.3s ease;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
}

.setting-input:focus {
  outline: none;
  border-color: var(--accent-color);
  box-shadow: 0 0 0 4px rgba(102, 192, 244, 0.2);
  transform: translateY(-1px);
}
</style>