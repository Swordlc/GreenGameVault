<template>
  <div class="layout-control">
    <span class="scale-label">{{ Math.round(scale) }}%</span>
    <input 
      type="range" 
      min="15" 
      max="150" 
      :value="scale" 
      @input="handleInput"
      @change="handleChange"
      class="scale-slider"
    >
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({
  name: 'LayoutControl',
  props: {
    scale: {
      type: Number,
      default: 80
    }
  },
  emits: ['update:scale', 'scale-changed'],
  setup(props, { emit }) {
    const handleInput = (event: Event) => {
      const value = Number((event.target as HTMLInputElement).value)
      // 拖动过程中只更新 UI，不保存
      emit('update:scale', value)
    }

    const handleChange = (event: Event) => {
      const value = Number((event.target as HTMLInputElement).value)
      // 拖动结束时触发保存事件
      emit('scale-changed', value)
    }

    return {
      handleInput,
      handleChange
    }
  }
})
</script>

<style scoped>
.layout-control {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-right: 16px;
}

.scale-label {
  font-size: 0.9rem;
  color: var(--text-secondary);
  min-width: 3em;
  text-align: right;
}

.scale-slider {
  width: 100px;
  cursor: pointer;
}
</style>
