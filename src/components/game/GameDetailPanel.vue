<template>
  <DetailPanel 
    :visible="visible" 
    :item="game" 
    type="game" 
    :is-running="isRunning"
    @close="handleClose"
    @action="handleAction"
    @update-rating="handleUpdateRating"
    @update-comment="handleUpdateComment"
    @toggle-favorite="handleToggleFavorite"
  />
</template>

<script lang="ts">
import DetailPanel from '../DetailPanel.vue'

export default {
  name: 'GameDetailPanel',
  components: {
    DetailPanel
  },
  props: {
    visible: {
      type: Boolean,
      default: false
    },
    game: {
      type: Object,
      default: null
    },
    isRunning: {
      type: Boolean,
      default: false
    }
  },
  emits: ['close', 'action', 'update-rating', 'update-comment', 'toggle-favorite'],
  methods: {
    handleClose() {
      this.$emit('close')
    },
    handleAction(actionKey, game) {
      this.$emit('action', actionKey, game)
    },
    handleUpdateRating(rating, game) {
      this.$emit('update-rating', rating, game)
    },
    handleUpdateComment(comment, game) {
      this.$emit('update-comment', comment, game)
    },
    handleToggleFavorite(game) {
      this.$emit('toggle-favorite', game)
    }
  }
}
</script>

<style scoped>
/* 样式由 DetailPanel 组件提供 */
</style>

