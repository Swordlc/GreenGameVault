/**
 * 通用资源右键菜单处理 Composable
 * 抽象所有资源页面的右键菜单逻辑
 */
import type { Ref } from 'vue'

export interface ContextMenuItem {
  key: string
  icon: string
  label: string
  class?: string
  children?: ContextMenuItem[]
}

export interface ContextMenuHandler {
  [key: string]: (item: any) => void | Promise<void>
}

/**
 * 通用右键菜单处理
 */
export function useResourceContextMenu(
  handlers: ContextMenuHandler
) {
  /**
   * 处理右键菜单点击
   */
  const handleContextMenuClick = async (data: { item: ContextMenuItem; selectedItem: any }) => {
    const { item, selectedItem } = data
    if (!selectedItem) return

    const handler = handlers[item.key]
    if (handler) {
      await handler(selectedItem)
    } else {
      console.warn(`未找到菜单项 "${item.key}" 的处理函数`)
    }
  }

  return {
    handleContextMenuClick
  }
}
