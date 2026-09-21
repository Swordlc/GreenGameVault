/**
 * @deprecated 此文件已废弃，请使用 useResourceFilter
 * 为了向后兼容，保留此导出
 */
import { useResourceFilter, type PageConfigWithFilter } from '../useResourceFilter'
import type { Ref } from 'vue'

/**
 * @deprecated 请使用 useResourceFilter
 * 为了向后兼容，保留此导出
 */
export { type PageConfigWithFilter }

/**
 * @deprecated 请使用 useResourceFilter
 * 为了向后兼容，保留此函数作为别名
 */
export function useGameFilter<T = any>(
  games: Ref<T[]>, 
  searchQuery: Ref<string>, 
  sortBy: Ref<string>,
  pageConfig: PageConfigWithFilter,
  additionalData?: any
) {
  // 直接调用 useResourceFilter，保持向后兼容
  const result = useResourceFilter(games, searchQuery, sortBy, pageConfig, additionalData)
  
  // 为了向后兼容，确保返回 filteredGames（即使 useResourceFilter 返回 filteredItems）
  return {
    ...result,
    filteredGames: result.filteredItems || result.filteredGames
  }
}
