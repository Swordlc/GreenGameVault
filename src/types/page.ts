// 资源类型常量数组（单一数据源）
export const RESOURCE_TYPES = ['Game', 'Software', 'Image', 'SingleImage', 'Video', 'Anime', 'Novel', 'Website', 'Audio', 'Other'] as const;

// 从常量数组生成类型
export type ResourceType = typeof RESOURCE_TYPES[number];

// 统一资源类型（小写，用于 UnifiedResource）
export const UNIFIED_RESOURCE_TYPES = ['game', 'image', 'singleimage', 'video', 'anime', 'novel', 'website', 'audio', 'software', 'other'] as const;

// 从常量数组生成统一资源类型
export type UnifiedResourceType = typeof UNIFIED_RESOURCE_TYPES[number];

export interface PageConfig {
  id: string;
  name: string;
  icon: string;
  type: ResourceType;  // 从 resourceTypes[0] 自动推导
  description?: string;
  isDefault?: boolean;
  isHidden?: boolean;
  filters?: {
    tags?: string[];
    excludeTags?: string[];
    [key: string]: any;
  };
  order: number;
  createdAt?: number;
  updatedAt?: number;
}
