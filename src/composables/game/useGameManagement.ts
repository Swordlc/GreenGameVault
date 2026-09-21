import { ref, type Ref } from 'vue'
import saveManager from '../../utils/SaveManager.ts'
import notify from '../../utils/NotificationService.ts'
import { Game as GameClass } from '@resources/game.ts'
import { BaseResources } from '@resources/base/ResourcesDataBase.ts'
import { ResourceField } from '@resources/base/ResourceField.ts'

// 游戏数据类型
type Game = InstanceType<typeof GameClass> & Record<string, any>

/**
 * 游戏管理的 composable
 */
export function useGameManagement(
  games: Ref<Game[]>,
  extractAllFilters: () => void,
  isElectronEnvironment: Ref<boolean>,
  pageId: string = 'games'
) {
  /**
   * 加载游戏列表
   * 将 JSON 对象转换为 Game 类实例
   */
  async function loadGames() {
    const jsonData = await saveManager.loadPageData(pageId)
    games.value = jsonData.map((data: any) => GameClass.fromJSON(data))
    extractAllFilters()
  }

  /**
   * 保存游戏列表
   * 使用 getSaveData 过滤数据，只保存定义的字段
   */
  async function saveGames() {
    // 使用 getSaveData 提取需要保存的字段
    const saveableGames = games.value.map(game => 
      game.getSaveData()
    )
    return await saveManager.savePageData(pageId, saveableGames)
  }

  /**
   * 添加游戏
   * 如果传入的是普通对象，会转换为 Game 实例
   */
  async function addGame(game: Game | any) {
    // 如果传入的不是 Game 实例（没有 ResourceField），使用 fromJSON 转换
    let gameInstance: Game
    if (game instanceof GameClass) {
      gameInstance = game
    } else {
      // 普通对象，使用 fromJSON 转换为 Game 实例
      // 如果没有 id，构造函数会自动生成
      gameInstance = GameClass.fromJSON(game)
    }
    
    games.value.push(gameInstance)
    await saveGames()
    
    extractAllFilters()
    return gameInstance
  }

  /**
   * 更新游戏
   */
  async function updateGame(gameId: string, updates: Partial<Game>) {
    console.log('[updateGame] 开始更新游戏:', {
      gameId,
      gameIdType: typeof gameId,
      gameIdValue: gameId,
      gamesCount: games.value.length,
      allGameIds: games.value.map(g => {
        const id = g.id instanceof ResourceField ? g.id.value : (g as any).id
        return { id, idType: typeof id, idValue: String(id) }
      })
    })
    
    const index = games.value.findIndex(g => {
      const id = g.id instanceof ResourceField ? g.id.value : (g as any).id
      const matches = String(id) === String(gameId)
      if (!matches) {
        console.log('[updateGame] ID 不匹配:', {
          gameId: String(gameId),
          gameIdType: typeof gameId,
          currentId: String(id),
          currentIdType: typeof id,
          strictEqual: id === gameId,
          stringEqual: String(id) === String(gameId)
        })
      }
      return matches
    })
    
    if (index === -1) {
      console.error('[updateGame] 未找到要更新的游戏:', {
        gameId,
        gameIdType: typeof gameId,
        gameIdString: String(gameId),
        availableIds: games.value.map(g => {
          const id = g.id instanceof ResourceField ? g.id.value : (g as any).id
          return String(id)
        })
      })
      throw new Error('未找到要更新的游戏')
    }
    
    console.log('[updateGame] 找到游戏，索引:', index)

    const target = games.value[index]
    
    // 将 updates 中的值赋给对应的 ResourceField.value
    for (const key in updates) {
      const field = (target as any)[key]
      if (field && field instanceof ResourceField) {
        field.value = BaseResources.extractPrimitiveValue((updates as any)[key])
      } else {
        // 如果不是 ResourceField，直接赋值（如 folderSize, playTime 等额外字段）
        (target as any)[key] = (updates as any)[key]
      }
    }

    // 如果资源路径发生变化，重新计算文件夹大小
    const newPath = updates.resourcePath || (updates as any).resourcePath || (updates as any).executablePath
    if (newPath !== undefined) {
      const oldPath = target.resourcePath instanceof ResourceField ? target.resourcePath.value : (target as any).resourcePath
      if (newPath && typeof newPath === 'string' && newPath.trim() !== oldPath) {
        let folderSize = 0
        if (isElectronEnvironment.value && window.electronAPI && window.electronAPI.getFolderSize) {
          try {
            const result = await window.electronAPI.getFolderSize(newPath.trim())
            if (result.success) {
              folderSize = result.size
            }
          } catch (error) {
            console.error('获取文件夹大小失败:', error)
          }
        }
        (target as any).folderSize = folderSize
      }
    }

    await saveGames()
    extractAllFilters()
  }

  /**
   * 删除游戏
   */
  async function removeGame(gameId: string) {
    const index = games.value.findIndex(g => g.id?.value === gameId)
    if (index === -1) {
      throw new Error('未找到要删除的游戏')
    }

    const game = games.value[index]
    games.value.splice(index, 1)
    await saveGames()

    const gameName = game.name?.value || (game as any).name || '未知游戏'
    notify.toast('success', '删除成功', `已成功删除游戏 "${gameName}"`)
  }

  /**
   * 更新游戏游玩时长
   */
  async function updateGamePlayTime(executablePath: string, playTime: number) {
    const game = games.value.find(g => {
      const path = g.resourcePath?.value || (g as any).executablePath
      return path === executablePath
    })
    if (game) {
      const currentPlayTimeValue: number = (game as any).playTime || 0
      ;(game as any).playTime = currentPlayTimeValue + playTime
      await saveGames()
    }
  }

  /**
   * 更新游戏文件夹大小
   */
  async function updateGameFolderSize(gameId: string) {
    const game = games.value.find(g => g.id?.value === gameId)
    if (!game) {
      throw new Error('未找到游戏')
    }
    
    const resourcePath = game.resourcePath?.value || (game as any).executablePath
    if (!resourcePath) {
      throw new Error('游戏文件路径不存在')
    }

    if (isElectronEnvironment.value && window.electronAPI && window.electronAPI.getFolderSize) {
      try {
        const result = await window.electronAPI.getFolderSize(resourcePath)
        if (result.success) {
          const oldSize = (game as any).folderSize || 0
          ;(game as any).folderSize = result.size
          await saveGames()

          const oldSizeMB = ((oldSize as number) / 1024 / 1024).toFixed(2)
          const newSizeMB = ((result.size as number) / 1024 / 1024).toFixed(2)
          const gameName = game.name?.value || (game as any).name || '未知游戏'

          notify.toast(
            'success',
            '更新成功',
            `"${gameName}" 文件夹大小已更新\n旧大小: ${oldSizeMB} MB\n新大小: ${newSizeMB} MB`
          )
        } else {
          throw new Error(result.error || '获取文件夹大小失败')
        }
      } catch (error: any) {
        console.error('获取文件夹大小失败:', error)
        const gameName = game.name?.value || (game as any).name || '未知游戏'
        notify.toast('error', '更新失败', `无法获取 "${gameName}" 的文件夹大小: ${error.message}`)
        throw error
      }
    } else {
      throw new Error('当前环境不支持文件夹大小计算功能')
    }
  }


  /**
   * 检查文件存在性
   */
  async function checkFileExistence() {
    if (!isElectronEnvironment.value || !window.electronAPI || !window.electronAPI.checkFileExists) {
      // 如果API不可用，默认设置为存在
      games.value.forEach(game => {
        if (game.fileExists instanceof ResourceField) {
          game.fileExists.value = true
        } else {
          (game as any).fileExists = true
        }
      })
      return
    }

    for (const game of games.value) {
      const resourcePath = game.resourcePath?.value || (game as any).executablePath
      if (!resourcePath) {
        if (game.fileExists instanceof ResourceField) {
          game.fileExists.value = false
        } else {
          (game as any).fileExists = false
        }
        continue
      }

      try {
        const result = await window.electronAPI.checkFileExists(resourcePath)
        if (game.fileExists instanceof ResourceField) {
          game.fileExists.value = result.exists
        } else {
          (game as any).fileExists = result.exists
        }
      } catch (error) {
        const gameName = game.name?.value || (game as any).name || '未知游戏'
        console.error(`检测游戏文件存在性失败: ${gameName}`, error)
        if (game.fileExists instanceof ResourceField) {
          game.fileExists.value = false
        } else {
          (game as any).fileExists = false
        }
      }
    }

    await saveGames()
  }

  /**
   * 为现有游戏计算文件夹大小（如果还没有的话）
   */
  async function updateExistingGamesFolderSize() {
    const gamesNeedingUpdate = games.value.filter(game => {
      const resourcePath = game.resourcePath?.value || (game as any).executablePath
      const folderSize = (game as any).folderSize
      return resourcePath && (folderSize === undefined || folderSize === null || folderSize === 0)
    })

    if (gamesNeedingUpdate.length === 0) {
      return
    }

    if (!isElectronEnvironment.value || !window.electronAPI || !window.electronAPI.getFolderSize) {
      return
    }

    let updatedCount = 0
    for (const game of gamesNeedingUpdate) {
      try {
        const resourcePath = game.resourcePath?.value || (game as any).executablePath
        if (!resourcePath) continue
        
        const result = await window.electronAPI.getFolderSize(resourcePath)
        if (result.success) {
          (game as any).folderSize = result.size
          updatedCount++
        }
      } catch (error) {
        const gameName = game.name?.value || (game as any).name || '未知游戏'
        console.error(`计算游戏 ${gameName} 文件夹大小失败:`, error)
      }
    }

    if (updatedCount > 0) {
      await saveGames()
    }
  }

  return {
    // 方法
    loadGames,
    saveGames,
    addGame,
    updateGame,
    removeGame,
    updateGamePlayTime,
    updateGameFolderSize,
    checkFileExistence,
    updateExistingGamesFolderSize
  }
}

