/**
 * 通用排序工具函数
 * 类似 lodash 的 sortBy，支持字段访问器和排序方向
 */

/**
 * 排序配置接口
 * @template T 资源类型
 */
export interface SortConfig<T> {
  /** 字段访问器函数，从资源对象中提取要排序的字段值 */
  fieldAccessor: (item: T) => any
  /** 排序方向：'asc' 升序，'desc' 降序 */
  order?: 'asc' | 'desc'
  /** 可选的比较函数，如果不提供则使用默认比较 */
  compareFn?: (a: any, b: any) => number
}

/**
 * 对数组进行排序
 * @param array 要排序的数组
 * @param config 排序配置
 * @returns 排序后的新数组（不修改原数组）
 */
export function sortBy<T>(array: T[], config: SortConfig<T>): T[] {
  const { fieldAccessor, order = 'asc', compareFn } = config
  
  return [...array].sort((a, b) => {
    // 使用字段访问器获取要比较的值
    const aValue = fieldAccessor(a)
    const bValue = fieldAccessor(b)
    
    // 处理 null/undefined 值：null 值始终排到最后
    if (aValue == null && bValue == null) {
      return 0
    }
    if (aValue == null) {
      return 1 // a 是 null，排到后面
    }
    if (bValue == null) {
      return -1 // b 是 null，排到后面
    }
    
    // 使用自定义比较函数或默认比较
    let result = 0
    if (compareFn) {
      result = compareFn(aValue, bValue)
    } else {
      // 默认比较逻辑
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        result = aValue.localeCompare(bValue)
      } else if (typeof aValue === 'number' && typeof bValue === 'number') {
        result = aValue - bValue
      } else {
        // 其他类型，转换为字符串比较
        result = String(aValue).localeCompare(String(bValue))
      }
    }
    
    // 如果是降序，反转结果
    if (order === 'desc') {
      result = -result
    }
    
    return result
  })
}
