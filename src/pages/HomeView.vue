<template>
  <div class="home-view">
    <div class="home-content">
      <div class="recommended-section">
        <div class="section-header">
          <h2 class="section-title">{{ $t('home.recommended') }}</h2>
          <button class="refresh-btn" @click="refreshRecommendations">{{ $t('home.refreshBatch') }}</button>
        </div>
        <div class="resources-grid" v-if="recommendedResources.length > 0">
          <ResourceCard
            v-for="resource in recommendedResources"
            :key="`${resource.type}-${resource.id}`"
            :resource="resource"
            @click="handleResourceClick(resource)"
          />
        </div>
        <div v-else class="empty-state">
          <p>{{ $t('home.noRecommendations') }}</p>
        </div>
      </div>

      <div class="recent-section">
        <div class="section-header">
          <h2 class="section-title">{{ $t('home.recentBrowsing') }}</h2>
          <a href="#" class="view-more-link" @click.prevent="navigateToRecent">{{ $t('home.viewAll') }}</a>
        </div>
        <div class="resources-grid" v-if="recentResources.length > 0">
          <ResourceCard
            v-for="resource in recentResources"
            :key="`${resource.type}-${resource.id}`"
            :resource="resource"
            @click="handleResourceClick(resource)"
          />
        </div>
        <div v-else class="empty-state">
          <p>{{ $t('home.noRecentBrowsing') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import saveManager from '../utils/SaveManager.ts'
import ResourceCard from '../components/home/ResourceCard.vue'
import type { UnifiedResourceType } from '../types/page.ts'

interface UnifiedResource {
  id: string
  type: UnifiedResourceType
  name: string
  category?: string
  description?: string
  thumbnail?: string
  image?: string
  cover?: string
  lastAccessed?: string | null
  badge?: string
  metadata?: {
    [key: string]: any
  }
}

export default {
  name: 'HomeView',
  components: {
    ResourceCard
  },
  data() {
    return {
      recommendedResources: [] as UnifiedResource[],
      recentResources: [] as UnifiedResource[],
      isLoading: false
    }
  },
  methods: {
    navigateTo(viewId: string) {
      this.$router.push({ name: viewId }).catch(err => {
        if (err.name !== 'NavigationDuplicated') {
          console.error('导航失败:', err)
        }
      })
    },
    async refreshRecommendations() {
      // 刷新推荐内容（统一从 SQLite 加载）
      try {
        this.isLoading = true
        const api = (window as any).electronAPI
        if (!api?.sqliteGetPageData) {
          this.isLoading = false
          return
        }
        // 仅游戏库：只读取 games 页面数据
        const pageIds = ['games'] as const
        const results = await Promise.all(pageIds.map((id) => api.sqliteGetPageData(id)))
        const [games] = results.map((r: any) => (r?.ok ? (r.data ?? []) : []))

        const allResources: UnifiedResource[] = [
          ...games.map((g: any) => this.normalizeGame(g))
        ]

        // 生成新的随机推荐（只显示6个）
        this.recommendedResources = this.generateRandomRecommendations(allResources, 6)
        
        this.isLoading = false
      } catch (error) {
        console.error('刷新推荐失败:', error)
        this.isLoading = false
      }
    },
    navigateToRecent() {
      // 导航到最近浏览页面
      this.navigateTo('recent')
    },
    async loadAllResources() {
      try {
        this.isLoading = true
        const api = (window as any).electronAPI
        if (!api?.sqliteGetPageData) {
          this.isLoading = false
          return
        }
        // 仅游戏库：只读取 games 页面数据
        const pageIds = ['games'] as const
        const results = await Promise.all(pageIds.map((id) => api.sqliteGetPageData(id)))
        const [games] = results.map((r: any) => (r?.ok ? (r.data ?? []) : []))

        const allResources: UnifiedResource[] = [
          ...games.map((g: any) => this.normalizeGame(g))
        ]

        // 生成随机推荐（只显示6个）
        this.recommendedResources = this.generateRandomRecommendations(allResources, 6)
        
        // 获取最近访问的资源（至少6个）
        this.recentResources = this.getRecentResources(allResources, 6)
        
        this.isLoading = false
      } catch (error) {
        console.error('加载资源失败:', error)
        this.isLoading = false
      }
    },
    getLastAccessedFromItem(item: any, ...fields: string[]): string | null | undefined {
      for (const f of fields) {
        if (item && item[f]) return item[f]
      }
      const arr = item?.visitedSessions
      if (Array.isArray(arr) && arr.length > 0) return arr[arr.length - 1]
      return undefined
    },
    normalizeGame(game: any): UnifiedResource {
      return {
        id: game.id,
        type: 'game',
        name: game.name,
        category: game.developer || '游戏',
        description: game.description,
        thumbnail: game.coverPath || (game as any).image,
        lastAccessed: this.getLastAccessedFromItem(game, 'lastPlayed'),
        badge: game.playTime ? undefined : '未通关',
        metadata: {
          developer: game.developer,
          publisher: game.publisher,
          tags: game.tags,
          playTime: game.playTime,
          playCount: game.playCount
        }
      }
    },
    generateRandomRecommendations(resources: UnifiedResource[], count: number): UnifiedResource[] {
      if (resources.length === 0) return []
      if (resources.length <= count) return [...resources].sort(() => Math.random() - 0.5)
      
      // 随机选择资源
      const shuffled = [...resources].sort(() => Math.random() - 0.5)
      return shuffled.slice(0, count)
    },
    getRecentResources(resources: UnifiedResource[], count: number): UnifiedResource[] {
      // 过滤出有访问时间的资源并按时间排序
      const withAccessTime = resources
        .filter(r => r.lastAccessed)
        .sort((a, b) => {
          const timeA = new Date(a.lastAccessed!).getTime()
          const timeB = new Date(b.lastAccessed!).getTime()
          return timeB - timeA // 降序，最新的在前
        })
      
      return withAccessTime.slice(0, count)
    },
    handleResourceClick(resource: UnifiedResource) {
      // 仅游戏库：资源类型到页面的映射只保留 game
      const viewMap: { [key: string]: string } = {
        'game': 'games'
      }

      const viewId = viewMap[resource.type]
      if (viewId) {
        this.navigateTo(viewId)
      }
    }
  },
  async mounted() {
    await this.loadAllResources()
  }
}
</script>

<style scoped>
.home-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.home-content {
  flex: 1;
  padding: 2rem;
  overflow-y: auto;
  background: #f5f5f5;
}

/* 推荐区域和最近浏览区域 */
.recommended-section,
.recent-section {
  margin-bottom: 3rem;
  background: white;
  border-radius: 8px;
  padding: 1.5rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.section-title {
  font-size: 1.5rem;
  font-weight: 600;
  margin: 0;
  color: #333;
}

.view-more-link {
  color: #666;
  text-decoration: none;
  font-size: 0.9rem;
  transition: color 0.2s;
}

.view-more-link:hover {
  color: #dc2626;
}

.refresh-btn {
  background: #dc2626;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  font-size: 0.9rem;
  cursor: pointer;
  transition: background 0.2s;
}

.refresh-btn:hover {
  background: #b91c1c;
}

.refresh-btn:active {
  background: #991b1b;
}

/* 资源网格 */
.resources-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 1rem;
  overflow-x: auto;
}

/* 为您推荐区域 - 只显示一行 */
.recommended-section .resources-grid {
  grid-template-columns: repeat(6, 1fr);
  grid-template-rows: 1fr;
}

.empty-state {
  text-align: center;
  padding: 3rem;
  color: #999;
}

/* 响应式设计 */
@media (max-width: 1200px) {
  .resources-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .resources-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .recommended-section .resources-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  
  .home-content {
    padding: 1rem;
  }
}
</style>