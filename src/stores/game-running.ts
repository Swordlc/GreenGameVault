/**
 * 游戏运行状态 Store
 * 管理全局游戏运行状态，替代 App.vue 中的 runningGames Map
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface GameRuntimeInfo {
  id: string
  pid: number
  windowTitles: string[]
  gameName: string
  startTime: number // 游戏启动时间（不变）
}

interface SaveTask {
  id: string
  execute: () => Promise<void>
  resolve: () => void
  reject: (error: Error) => void
  timestamp: number
}

export const useGameRunningStore = defineStore('gameRunning', () => {
  // 状态
  const runningGames = ref(new Map<string, GameRuntimeInfo>())
  const saveQueue = ref<SaveTask[]>([])
  const isProcessingQueue = ref(false)

  // 计算属性
  const runningGameIds = computed(() => 
    Array.from(runningGames.value.keys())
  )

  const runningGamesCount = computed(() => 
    runningGames.value.size
  )

  // Actions - 游戏运行管理
  function addRunningGame(gameInfo: Omit<GameRuntimeInfo, 'startTime'>) {
    const now = Date.now()
    const runtimeInfo: GameRuntimeInfo = {
      ...gameInfo,
      startTime: now // 游戏启动时间（不变）
    }
    runningGames.value.set(gameInfo.id, runtimeInfo)
    console.log('✅ 添加运行游戏:', runtimeInfo)
  }
  
  // 计算当前会话时长（从启动到现在）
  function getSessionDuration(gameId: string): number {
    const runtimeInfo = runningGames.value.get(gameId)
    if (!runtimeInfo) {
      return 0
    }
    const now = Date.now()
    return Math.floor((now - runtimeInfo.startTime) / 1000) // 本次会话时长（秒）
  }
  
  // 计算当前总时长（需要传入初始 playTime）
  // initialPlayTime: 游戏启动时的初始 playTime（从 game.playTime 获取）
  function getCurrentPlayTime(gameId: string, initialPlayTime: number): number {
    const sessionDuration = getSessionDuration(gameId)
    return initialPlayTime + sessionDuration // 总时长 = 初始时长 + 本次会话时长
  }

  function removeRunningGame(gameId: string): number | null {
    const runtimeInfo = runningGames.value.get(gameId)
    if (!runtimeInfo) {
      console.warn(`⚠️ 未找到游戏运行信息: ${gameId}`)
      return null
    }

    const sessionDuration = Math.floor((Date.now() - runtimeInfo.startTime) / 1000)
    runningGames.value.delete(gameId)
    console.log(`✅ 移除运行游戏: ${gameId}, 会话时长: ${sessionDuration}秒`)
    
    return sessionDuration
  }

  function isGameRunning(gameId: string): boolean {
    return runningGames.value.has(gameId)
  }

  function getRunningGame(gameId: string): GameRuntimeInfo | undefined {
    return runningGames.value.get(gameId)
  }

  function getRunningGamesMap(): Map<string, GameRuntimeInfo> {
    return runningGames.value
  }

  function updateGameWindowTitles(gameId: string, titles: string[]) {
    const game = runningGames.value.get(gameId)
    if (game) {
      const oldTitles = game.windowTitles || []
      const allTitles = [...new Set([...oldTitles, ...titles])]
      
      if (allTitles.length !== oldTitles.length) {
        game.windowTitles = allTitles
        console.log(`✅ 更新游戏窗口标题: ${gameId}`, allTitles)
      }
    }
  }

  // Actions - 保存队列管理
  function enqueueSaveTask(task: Omit<SaveTask, 'id' | 'timestamp'>): Promise<void> {
    return new Promise((resolve, reject) => {
      const saveTask: SaveTask = {
        id: `task-${Date.now()}-${Math.random()}`,
        ...task,
        timestamp: Date.now()
      }
      
      saveQueue.value.push(saveTask)
      console.log(`📝 保存任务已加入队列，当前队列长度: ${saveQueue.value.length}`)
      
      // 如果队列处理程序没有运行，启动它
      if (!isProcessingQueue.value) {
        processSaveQueue()
      }
    })
  }

  async function processSaveQueue() {
    if (isProcessingQueue.value) {
      return
    }

    isProcessingQueue.value = true
    console.log('🔄 开始处理保存队列')

    while (saveQueue.value.length > 0) {
      const task = saveQueue.value.shift()
      
      if (!task) {
        continue
      }

      try {
        console.log(`💾 执行保存任务 (队列剩余: ${saveQueue.value.length})`)
        await task.execute()
        console.log('✅ 保存任务完成')
        task.resolve()
      } catch (error) {
        console.error('❌ 保存任务失败:', error)
        task.reject(error as Error)
      }

      // 任务之间稍作延迟，避免过于频繁的写入
      if (saveQueue.value.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }

    isProcessingQueue.value = false
    console.log('✅ 保存队列处理完成')
  }

  // 清理函数（如果需要）
  function cleanup() {
    // 清理保存队列
    saveQueue.value = []
    isProcessingQueue.value = false
  }

  return {
    // State
    runningGames,
    saveQueue,
    isProcessingQueue,
    // Computed
    runningGameIds,
    runningGamesCount,
    // Actions
    addRunningGame,
    removeRunningGame,
    isGameRunning,
    getRunningGame,
    getRunningGamesMap,
    updateGameWindowTitles,
    enqueueSaveTask,
    processSaveQueue,
    getCurrentPlayTime,
    getSessionDuration,
    cleanup
  }
})

