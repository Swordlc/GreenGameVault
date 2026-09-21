<template>
  <FunGrid
    v-if="games.length > 0"
    mode="auto-fill"
    :scale="scale"
    :baseWidth="baseWidth"
    :minScaledWidth="100"
    gap="20px"
    padding="10px 20px"
    :singleColumnOnMobile="true"
    :customStyle="customLayoutStyle"
  >
    <MediaCard 
      v-for="game in games" 
      :key="getFieldValue(game.id)" 
      :item="game" 
      type="game"
      :scale="scale"
      :is-running="isGameRunning(game)" 
      :is-electron-environment="isElectronEnvironment"
      :file-exists="getFileExistsValue(game)" 
      @click="$emit('game-click', game)"
      @contextmenu="$emit('game-contextmenu', $event, game)" 
      @action="$emit('game-action', game)" 
    />
  </FunGrid>
</template>

<script lang="ts">
import { defineComponent, type PropType, computed } from 'vue'
import MediaCard from '../MediaCard.vue'
import FunGrid from '../../fun-ui/layout/Grid/FunGrid.vue'
import { Game as GameClass } from '@resources/game.ts'
import { ResourceField } from '@resources/base/ResourceField.ts'

// Game 类型就是 GameClass 的实例类型
type Game = InstanceType<typeof GameClass>

/**
 * 从 ResourceField 或普通值中提取值
 */
function getFieldValue(field: any): any {
  // console.log('[GameGrid.getFieldValue] 输入:', {
  //   field,
  //   fieldType: typeof field,
  //   isResourceField: field instanceof ResourceField,
  //   isNull: field === null,
  //   isUndefined: field === undefined,
  //   hasValue: field && 'value' in field,
  //   value: field instanceof ResourceField ? field.value : undefined
  // })
  
  if (field instanceof ResourceField) {
    let result = field.value
    console.log('[GameGrid.getFieldValue] ResourceField 提取值:', {
      result,
      resultType: typeof result,
      isNull: result === null,
      isUndefined: result === undefined,
      isResourceField: result instanceof ResourceField
    })
    
    // 如果提取的值仍然是 ResourceField 对象，递归提取（处理嵌套情况）
    if (result instanceof ResourceField) {
      console.warn('[GameGrid.getFieldValue] 检测到嵌套 ResourceField，递归提取:', {
        originalResult: result,
        nestedValue: result.value
      })
      result = getFieldValue(result)
    }
    
    console.log('[GameGrid.getFieldValue] 最终返回:', {
      result,
      resultType: typeof result
    })
    return result
  }
  
  console.log('[GameGrid.getFieldValue] 直接返回:', {
    result: field,
    resultType: typeof field
  })
  return field
}

export default defineComponent({
  name: 'GameGrid',
  components: {
    MediaCard,
    FunGrid
  },
  props: {
    games: {
      type: Array as PropType<Game[]>,
      required: true,
      default: () => []
    },
    isGameRunning: {
      type: Function,
      required: true
    },
    isElectronEnvironment: {
      type: Boolean,
      default: false
    },
    scale: {
      type: Number,
      default: 100
    },
    layoutStyles: {
      type: Object,
      required: false
    },
    baseWidth: {
      type: Number,
      default: 400
    }
  },
  emits: ['game-click', 'game-contextmenu', 'game-action'],
  setup(props) {
    // 从 layoutStyles 中提取额外的样式（如 justifyContent）
    const customLayoutStyle = computed(() => {
      if (!props.layoutStyles) return undefined
      
      const custom: Record<string, string> = {}
      if (props.layoutStyles.justifyContent) {
        custom.justifyContent = props.layoutStyles.justifyContent
      }
      return Object.keys(custom).length > 0 ? custom : undefined
    })
    
    // 获取 fileExists 值的辅助函数（带日志）
    const getFileExistsValue = (game: any) => {
      // 首先检查 resourcePath 是否存在
      const resourcePath = getFieldValue(game.resourcePath) || getFieldValue((game as any).executablePath)
      
      // 如果 resourcePath 不存在，直接返回 false（文件丢失）
      if (!resourcePath || (typeof resourcePath === 'string' && resourcePath.trim() === '')) {
        console.log('[GameGrid] resourcePath 缺失，返回 false:', {
          gameName: getFieldValue(game.name),
          resourcePath,
          resourcePathType: typeof resourcePath
        })
        return false
      }
      
      // 如果 resourcePath 存在，检查 fileExists 的值
      const fileExistsValue = getFieldValue(game.fileExists)
      console.log('[GameGrid] 传递 fileExists prop:', {
        game,
        gameFileExists: game.fileExists,
        gameFileExistsType: typeof game.fileExists,
        isResourceField: game.fileExists instanceof ResourceField,
        fileExistsValue,
        fileExistsValueType: typeof fileExistsValue,
        isBoolean: typeof fileExistsValue === 'boolean',
        resourcePath
      })
      
      // 如果 fileExists 是 undefined 或 null，但 resourcePath 存在，返回 undefined（让 MediaCard 使用默认行为）
      // 如果 fileExists 是明确的 boolean 值，返回该值
      return fileExistsValue
    }
    
    return {
      customLayoutStyle,
      getFieldValue,
      getFileExistsValue
    }
  }
})
</script>

<style scoped>
/* 样式已迁移到 FunGrid 组件 */
</style>

