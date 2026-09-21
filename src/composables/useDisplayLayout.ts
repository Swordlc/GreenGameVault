import { ref, computed } from 'vue'

export function useDisplayLayout(initialScale = 80, baseWidth = 200) {
  const scale = ref(initialScale)

  const updateScale = (newScale: number) => {
    scale.value = newScale
  }

  const layoutStyles = computed(() => {
    const scaledWidth = Math.max(100, Math.round(baseWidth * (scale.value / 100)))
    return {
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fill, minmax(${scaledWidth}px, 1fr))`,
      justifyContent: 'stretch'
    }
  })

  return {
    scale,
    updateScale,
    layoutStyles
  }
}
