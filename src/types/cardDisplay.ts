/**
 * 卡片显示配置类型定义
 */

/**
 * 统计项类型
 */
export type StatItemType = 'text' | 'progress' | 'count' | 'time' | 'date' | 'custom'

/**
 * 统计项配置
 */
export interface StatItemConfig {
  /** 统计项类型 */
  type: StatItemType
  /** 字段名（支持嵌套，如 'developers.0'） */
  field: string
  /** 显示标签 */
  label?: string
  /** 格式化函数名（如 'formatPlayTime', 'formatLastPlayed'） */
  formatter?: string
  /** 自定义渲染函数（可选，优先级高于 formatter） */
  render?: (value: any, item: any) => string
  /** 是否显示运行状态（仅用于游戏等可执行资源） */
  showRunningStatus?: boolean
  /** 进度条配置（当 type 为 'progress' 时） */
  progressConfig?: {
    /** 进度值字段 */
    valueField: string
    /** 显示文本字段 */
    textField?: string
    /** 单位（如 '%', '页'） */
    unit?: string
  }
}

/**
 * 卡片显示配置
 */
export interface CardDisplayConfig {
  /** 标题字段（可以是 name、description 等任意字段） */
  title?: string
  /** 副标题字段（可以是任意字段，没有值则不显示） */
  subtitle?: string
  /** 额外信息字段（可以是任意字段，没有值则不显示） */
  extra?: string
  /** 标签字段名（可以是 tags 或其他字段） */
  tags?: string
  /** 标签最大显示数量 */
  maxTags?: number
  /** 统计信息配置列表 */
  stats?: StatItemConfig[]
  /** 进度条配置（如果有） */
  progress?: {
    /** 进度值字段 */
    field: string
    /** 显示文本字段（可选） */
    textField?: string
    /** 单位（如 '%'） */
    unit?: string
  }
  /** 特殊显示项（如演员列表、视频数量等） */
  specialItems?: Array<{
    /** 字段名 */
    field: string
    /** 显示标签 */
    label: string
    /** 是否为数组 */
    isArray?: boolean
    /** 数组最大显示数量 */
    maxArrayItems?: number
    /** 数组连接符 */
    arrayJoin?: string
  }>
  /** 是否显示 EXE 图标（仅用于游戏） */
  showExeIcon?: boolean
  /** 右下角徽章配置 */
  badge?: {
    /** 字段名 */
    field: string
    /** 格式化函数名（如 'formatFolderSize', 'formatDuration'） */
    formatter?: string
    /** 自定义渲染函数（可选，优先级高于 formatter） */
    render?: (value: any, item: any) => string
  }
}
