/**
 * 资源 Action Handler 注册系统
 * 将资源操作逻辑与页面解耦，通过资源类型的 handlerName 自动路由到对应的 handler
 */

import { BaseResources } from '@resources/base/ResourcesDataBase.ts'
import { isArchiveFile } from './ArchiveFileDetector'
import notify from './NotificationService.ts'
import saveManager from './SaveManager.ts'

/**
 * Action Handler 函数类型
 */
export type ActionHandler = (resource: any, context: ActionHandlerContext) => Promise<void> | void

/**
 * Action Handler 上下文
 * 提供 handler 执行时需要的上下文信息
 */
export interface ActionHandlerContext {
  // 是否为 Electron 环境
  isElectronEnvironment: boolean
  
  // 更新资源的方法
  updateResource: (id: string, updates: any) => Promise<void>
  
  // 检查资源是否正在运行（用于游戏等可执行资源）
  isResourceRunning?: (resource: any) => boolean
  
  // 添加运行资源的方法（用于游戏等可执行资源）
  addRunningResource?: (resourceInfo: any) => void
  
  // 移除运行资源的方法（用于游戏等可执行资源）
  removeRunningResource?: (resourceId: string) => void
  
  // 获取资源初始运行时长（用于游戏等可执行资源）
  getInitialPlayTime?: (resourceId: string) => number
  
  // 保存初始运行时长（用于游戏等可执行资源）
  saveInitialPlayTime?: (resourceId: string, playTime: number) => void
  
  // 关闭详情页面的方法
  closeDetail?: () => void
  
  // 显示终止确认对话框的方法（用于游戏等可执行资源）
  showTerminateConfirmDialog?: (resource: any) => void
}

/**
 * Action Handler 注册表
 */
const actionHandlers = new Map<string, ActionHandler>()

/**
 * 注册 Action Handler
 * @param handlerName Handler 名称（对应资源类的 actionConfig.handlerName）
 * @param handler Handler 函数
 */
export function registerActionHandler(handlerName: string, handler: ActionHandler) {
  actionHandlers.set(handlerName, handler)
  console.log(`[ResourceActionHandlers] 已注册 handler: ${handlerName}`)
}

/**
 * 获取 Action Handler
 * @param handlerName Handler 名称
 * @returns Handler 函数，如果不存在则返回 null
 */
export function getActionHandler(handlerName: string): ActionHandler | null {
  return actionHandlers.get(handlerName) || null
}

/**
 * 执行 Action Handler
 * @param resource 资源实例
 * @param context Handler 上下文
 * @returns 是否成功找到并执行了 handler
 */
export async function executeActionHandler(
  resource: any,
  context: ActionHandlerContext
): Promise<boolean> {
  console.log('[ResourceActionHandlers] executeActionHandler 被调用', {
    resource,
    resourceConstructor: resource?.constructor?.name,
    hasConstructor: !!resource?.constructor
  })
  
  // 通过 resource.constructor 获取运行时的实际构造函数
  if (!resource || !resource.constructor) {
    console.warn('[ResourceActionHandlers] 资源或构造函数不存在', {
      hasResource: !!resource,
      hasConstructor: !!resource?.constructor
    })
    return false
  }

  // 获取 handler 名称
  const hasGetActionHandlerName = typeof resource.constructor.getActionHandlerName === 'function'
  console.log('[ResourceActionHandlers] 检查 getActionHandlerName 方法', {
    hasMethod: hasGetActionHandlerName,
    actionConfig: resource.constructor.actionConfig
  })
  
  const handlerName = hasGetActionHandlerName ? resource.constructor.getActionHandlerName() : null
  console.log('[ResourceActionHandlers] 获取到的 handlerName', { handlerName })
  
  if (!handlerName) {
    console.warn('[ResourceActionHandlers] 资源类型未配置 action handler', {
      constructorName: resource.constructor.name,
      actionConfig: resource.constructor.actionConfig
    })
    return false
  }

  // 查找并执行 handler
  const handler = getActionHandler(handlerName)
  console.log('[ResourceActionHandlers] 查找 handler', {
    handlerName,
    found: !!handler,
    registeredHandlers: Array.from(actionHandlers.keys())
  })
  
  if (!handler) {
    console.warn(`[ResourceActionHandlers] 未找到 handler: ${handlerName}`, {
      availableHandlers: Array.from(actionHandlers.keys())
    })
    return false
  }

  try {
    console.log('[ResourceActionHandlers] 开始执行 handler', { handlerName })
    await handler(resource, context)
    console.log('[ResourceActionHandlers] handler 执行成功', { handlerName })
    return true
  } catch (error) {
    console.error(`[ResourceActionHandlers] 执行 handler ${handlerName} 失败:`, error)
    notify.toast('error', '操作失败', `执行操作失败: ${error.message}`)
    return false
  }
}

/**
 * 启动可执行文件的通用 Handler
 * 适用于所有可执行资源（Game, Software 等）
 */
export const launchExecutableHandler: ActionHandler = async (resource, context) => {
  try {
    // 获取资源属性值（支持 ResourceField 和普通属性）
    const executablePath = BaseResources.extractPrimitiveValue(
      resource.resourcePath?.value || resource.executablePath?.value || resource.resourcePath || resource.executablePath
    )
    const resourceName = BaseResources.extractPrimitiveValue(resource.name?.value || resource.name)
    const resourceId = BaseResources.extractPrimitiveValue(resource.id?.value || resource.id)
    const isArchiveValue = BaseResources.extractPrimitiveValue(resource.isArchive?.value ?? resource.isArchive)
    const visitedSessionsValue = BaseResources.extractPrimitiveValue(resource.visitedSessions?.value || resource.visitedSessions)
    const visitedSessions = Array.isArray(visitedSessionsValue) ? visitedSessionsValue : []
    const playCountValue = BaseResources.extractPrimitiveValue(resource.playCount?.value || resource.playCount) || 0
    const playTimeValue = BaseResources.extractPrimitiveValue(resource.playTime?.value || resource.playTime) || 0
    
    // 检查是否为压缩包，压缩包不能运行
    const isArchive = Boolean(isArchiveValue) || (executablePath && isArchiveFile(executablePath))
    if (isArchive) {
      notify.toast('warning', '无法运行', `压缩包文件无法直接运行。请先解压后再运行。`)
      return
    }

    // 检查资源是否正在运行
    if (context.isResourceRunning && context.isResourceRunning(resource)) {
      // 如果资源正在运行，显示确认对话框
      if (context.showTerminateConfirmDialog) {
        context.showTerminateConfirmDialog(resource)
      }
      return
    }

    console.log('启动资源:', resourceName, executablePath)
    console.log('更新前 - visitedSessions 数量:', visitedSessions.length)
    console.log('更新前 - playCount:', playCountValue)

    // 更新资源统计（每次启动记录到 visitedSessions）
    const launchTime = new Date().toISOString()
    const updates: any = {
      visitedSessions: [...visitedSessions, launchTime],
      playCount: playCountValue + 1
    }

    await context.updateResource(resourceId, updates)
    console.log('更新后 - 本次启动时间:', launchTime)
    console.log('更新后 - playCount:', updates.playCount)
    console.log('资源数据已保存')

    if (context.isElectronEnvironment && window.electronAPI && window.electronAPI.launchGame) {
      console.log('使用 Electron API 启动资源')
      const result = await window.electronAPI.launchGame(executablePath, resourceName)

      if (result.success) {
        console.log('------------------------------')
        console.log('资源启动成功，进程ID:', result.pid)
        console.log('资源窗口标题列表:', result.windowTitles)
        console.log('------------------------------')

        // 将资源添加到全局运行列表中（包含完整信息）
        if (context.addRunningResource) {
          context.addRunningResource({
            id: resourceId,
            pid: result.pid,
            windowTitles: result.windowTitles || [],
            gameName: resourceName
          })
        }
        
        // 保存资源启动时的初始 playTime
        if (context.saveInitialPlayTime) {
          context.saveInitialPlayTime(resourceId, playTimeValue)
        }

        // 显示成功提示
        notify.toast('success', '启动成功', `${resourceName} 已启动`)
      } else {
        console.error('资源启动失败:', result.error)
        notify.toast('error', '启动失败', `启动失败: ${result.error}`)
        return
      }
    } else {
      // 提供更详细的错误信息
      let errorMessage = `无法启动: ${resourceName}\n\n`
      if (!context.isElectronEnvironment) {
        errorMessage += `❌ 错误：未检测到 Electron 环境\n`
        errorMessage += `当前环境：${navigator.userAgent.includes('Electron') ? 'Electron 但 API 未加载' : '浏览器环境'}\n\n`
        errorMessage += `解决方案：\n`
        errorMessage += `1. 确保在打包后的应用中运行\n`
        errorMessage += `2. 检查 preload.js 是否正确加载\n`
        errorMessage += `3. 重新构建应用\n\n`
      } else {
        errorMessage += `❌ 错误：Electron API 不可用\n`
        errorMessage += `请检查应用是否正确打包\n\n`
      }
      errorMessage += `资源路径: ${executablePath}`
      notify.toast('error', '启动失败', errorMessage)
      return
    }

    // 关闭详情页面
    if (context.closeDetail) {
      context.closeDetail()
    }
  } catch (error) {
    console.error('启动资源失败:', error)
    notify.toast('error', '启动失败', `启动失败: ${error.message}`)
  }
}

/**
 * 使用转区工具（如 Locale Emulator）启动可执行文件。
 * 需在设置中配置 game.localeEmulatorPath（LEProc.exe 路径），调用方式：LEProc.exe -run <目标路径>。
 */
export const launchWithLocaleHandler: ActionHandler = async (resource, context) => {
  try {
    const executablePath = BaseResources.extractPrimitiveValue(
      resource.resourcePath?.value || resource.executablePath?.value || resource.resourcePath || resource.executablePath
    )
    const resourceName = BaseResources.extractPrimitiveValue(resource.name?.value || resource.name)
    const resourceId = BaseResources.extractPrimitiveValue(resource.id?.value || resource.id)
    const isArchiveValue = BaseResources.extractPrimitiveValue(resource.isArchive?.value ?? resource.isArchive)
    const visitedSessionsValue = BaseResources.extractPrimitiveValue(resource.visitedSessions?.value || resource.visitedSessions)
    const visitedSessions = Array.isArray(visitedSessionsValue) ? visitedSessionsValue : []
    const playCountValue = BaseResources.extractPrimitiveValue(resource.playCount?.value || resource.playCount) || 0
    const playTimeValue = BaseResources.extractPrimitiveValue(resource.playTime?.value || resource.playTime) || 0

    const isArchive = Boolean(isArchiveValue) || (executablePath && isArchiveFile(executablePath))
    if (isArchive) {
      notify.toast('warning', '无法运行', '压缩包文件无法直接运行。请先解压后再运行。')
      return
    }

    if (context.isResourceRunning?.(resource) && context.showTerminateConfirmDialog) {
      context.showTerminateConfirmDialog(resource)
      return
    }

    const settings = await saveManager.loadSettings()
    const localeEmulatorPath = (settings?.game?.localeEmulatorPath || '').trim()
    if (!localeEmulatorPath) {
      notify.toast('warning', '转区启动', '请先在设置 → 游戏中指定转区工具路径（如 Locale Emulator 的 LEProc.exe）。')
      return
    }

    const launchTime = new Date().toISOString()
    const updates: any = {
      visitedSessions: [...visitedSessions, launchTime],
      playCount: playCountValue + 1
    }
    await context.updateResource(resourceId, updates)

    if (context.isElectronEnvironment && window.electronAPI?.launchGameWithLocale) {
      const result = await window.electronAPI.launchGameWithLocale(localeEmulatorPath, executablePath, resourceName)
      if (result.success) {
        if (context.addRunningResource) {
          context.addRunningResource({
            id: resourceId,
            pid: result.pid,
            windowTitles: result.windowTitles || [],
            gameName: resourceName
          })
        }
        if (context.saveInitialPlayTime) {
          context.saveInitialPlayTime(resourceId, playTimeValue)
        }
        notify.toast('success', '启动成功', `已使用转区启动: ${resourceName}`)
      } else {
        notify.toast('error', '启动失败', result.error || '未知错误')
      }
    } else {
      notify.toast('error', '启动失败', '当前环境不支持转区启动或未配置转区工具。')
    }
  } catch (error: any) {
    console.error('转区启动失败:', error)
    notify.toast('error', '启动失败', error.message || '未知错误')
  }
}

/**
 * 用系统默认应用打开资源
 * 适用于 Other 等任意文件类型，调用 shell.openPath / openExternal 用系统默认程序打开
 */
export const launchDefaultHandler: ActionHandler = async (resource, context) => {
  try {
    const resourceId = BaseResources.extractPrimitiveValue(resource.id?.value || resource.id)
    const resourceName = BaseResources.extractPrimitiveValue(resource.name?.value || resource.name)
    const filePath = BaseResources.extractPrimitiveValue(
      resource.resourcePath?.value || resource.resourcePath || resource.filePath?.value || resource.filePath
    )
    if (!filePath || !filePath.trim()) {
      notify.toast('error', '打开失败', `资源 "${resourceName}" 没有配置文件路径`)
      return
    }
    if (resourceId && context.updateResource && resource.visitedSessions) {
      const visitedSessionsValue = BaseResources.extractPrimitiveValue(resource.visitedSessions?.value || resource.visitedSessions)
      const visitedSessions = Array.isArray(visitedSessionsValue) ? visitedSessionsValue : []
      try {
        await context.updateResource(resourceId, { visitedSessions: [...visitedSessions, new Date().toISOString()] })
      } catch (e) {
        console.warn('[ResourceActionHandlers] 更新访问记录失败:', e)
      }
    }
    if (context.isElectronEnvironment && window.electronAPI?.openExternal) {
      await window.electronAPI.openExternal(filePath)
      if (context.closeDetail) context.closeDetail()
    } else {
      notify.toast('warning', '打开失败', '当前环境无法用系统默认应用打开文件')
    }
  } catch (error: any) {
    console.error('[ResourceActionHandlers] 用默认应用打开失败:', error)
    const resourceName = BaseResources.extractPrimitiveValue(resource.name?.value || resource.name)
    notify.toast('error', '打开失败', `${resourceName}: ${error?.message || '未知错误'}`)
  }
}

// 注册默认的 handlers（GreenGameVault 仅保留游戏相关 handler）
registerActionHandler('launchExecutable', launchExecutableHandler)
registerActionHandler('launchDefault', launchDefaultHandler)
registerActionHandler('launchWithLocale', launchWithLocaleHandler)
