import { computed, type Ref } from 'vue'
import { Game as GameClass } from '@resources/game.ts'

// Game 类型就是 GameClass 的实例类型
type Game = InstanceType<typeof GameClass>

/**
 * 游戏运行状态管理的 composable
 * 注意：运行状态由 App.vue 全局管理，此 composable 提供访问接口
 */
export function useGameRunning(
  games: Ref<Game[]>,
  getRunningGamesMap: () => Map<string, any>, // 获取运行中游戏 Map 的函数
  addRunningGameFn: (gameInfo: { id: string; pid: number; windowTitles?: string[]; gameName?: string }) => void,
  removeRunningGameFn: (gameId: string) => void
) {
  /**
   * 检查游戏是否正在运行
   */
  function isGameRunning(game: Game | string): boolean {
    const gameId = typeof game === 'string' ? game : game.id
    const runningGamesMap = getRunningGamesMap()
    return runningGamesMap.has(gameId)
  }

  /**
   * 获取运行中的游戏信息
   */
  function getRunningGameInfo(gameId: string) {
    const runningGamesMap = getRunningGamesMap()
    return runningGamesMap.get(gameId) || null
  }

  /**
   * 获取所有运行中的游戏 ID 列表
   */
  function getRunningGameIds(): string[] {
    const runningGamesMap = getRunningGamesMap()
    return Array.from(runningGamesMap.keys())
  }

  /**
   * 获取运行中的游戏数量
   */
  const runningGameCount = computed(() => {
    return getRunningGamesMap().size
  })

  /**
   * 添加运行中的游戏
   */
  function addRunningGame(gameInfo: { id: string; pid: number; windowTitles?: string[]; gameName?: string }) {
    addRunningGameFn(gameInfo)
  }

  /**
   * 移除运行中的游戏
   */
  function removeRunningGame(gameId: string) {
    removeRunningGameFn(gameId)
  }

  /**
   * 获取运行中游戏的详细信息（包含游戏对象）
   */
  function getRunningGamesWithDetails() {
    const runningGamesMap = getRunningGamesMap()
    const runningGames: Array<{ game: Game; runtimeData: any }> = []

    for (const [gameId, runtimeData] of runningGamesMap) {
      const game = games.value.find(g => g.id === gameId)
      if (game) {
        runningGames.push({ game, runtimeData })
      }
    }

    return runningGames
  }

  return {
    isGameRunning,
    getRunningGameInfo,
    getRunningGameIds,
    runningGameCount,
    addRunningGame,
    removeRunningGame,
    getRunningGamesWithDetails
  }
}

