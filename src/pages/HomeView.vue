<template>
  <div class="home-view">
    <div class="home-content">
      <!-- 全局标签筛选：作用于三条链路的所有推荐 -->
      <div class="home-toolbar">
        <TagFilterMenu
          :tags="tagOptions"
          :selected="tagFilter.include"
          :excluded="tagFilter.exclude"
          @update="onTagFilterUpdate"
        />
        <span v-if="!isLoading && allGames.length > 0" class="library-summary">
          {{ $t('home.librarySummary', { total: allGames.length, filtered: filteredGames.length }) }}
        </span>
      </div>

      <div v-if="isLoading" class="home-loading">
        <FunLoading :text="$t('home.loading')" />
      </div>

      <template v-else>
        <!-- 库是空的 -->
        <div v-if="allGames.length === 0" class="empty-state">
          <div class="empty-icon">🎮</div>
          <p>{{ $t('home.emptyLibrary') }}</p>
        </div>

        <!-- 有游戏但被标签筛选筛光了 -->
        <div v-else-if="filteredGames.length === 0" class="empty-state filter-empty">
          <div class="empty-icon">🔍</div>
          <p class="empty-title">{{ $t('home.filteredEmptyTitle') }}</p>
          <p class="empty-desc">{{ $t('home.filteredEmptyHint') }}</p>
          <button class="refresh-btn" @click="clearTagFilter">{{ $t('home.tagClearAll') }}</button>
        </div>

        <!-- 三条抓阄链路 -->
        <template v-else>
          <section v-for="row in rows" :key="row.id" class="chain-section">
            <div class="section-header">
              <div class="section-title-group">
                <h2 class="section-title">
                  <span class="chain-icon">{{ row.meta.icon }}</span>{{ $t(row.meta.titleKey) }}
                </h2>
                <span class="section-hint">{{ $t(row.meta.hintKey) }}</span>
              </div>
              <button
                class="refresh-btn"
                :disabled="row.cards.length === 0"
                :title="$t('home.rerollTitle')"
                @click="reroll(row.id)"
              >
                🎲 {{ $t('home.reroll') }}
              </button>
            </div>

            <div v-if="row.cards.length > 0" class="resources-grid">
              <ResourceCard
                v-for="card in row.cards"
                :key="card.id"
                class="chain-card"
                :class="{ 'is-pinned': card.pinned }"
                :resource="card.resource"
                :status-text="card.statusText"
                @click="handleResourceClick(card.id)"
              />
            </div>
            <div v-else class="row-empty">
              <p>{{ emptyTextFor(row.id) }}</p>
            </div>
          </section>
        </template>
      </template>
    </div>
  </div>
</template>

<script lang="ts">
import ResourceCard from '../components/home/ResourceCard.vue'
import TagFilterMenu from '../components/home/TagFilterMenu.vue'
import FunLoading from '../fun-ui/feedback/Loading/FunLoading.vue'
import {
  CHAINS,
  DEFAULT_PINNED_SIZE,
  DEFAULT_ROW_SIZE,
  collectTagOptions,
  describeGame,
  filterGamesByTags,
  pickChain,
  toHomeGame,
  type ChainId,
  type ChainMeta,
  type HomeGame,
  type TagFilterState
} from '../utils/recommendation'

const TAG_FILTER_STORAGE_KEY = 'ggv-home-tag-filter'

interface ChainCard {
  id: string
  pinned: boolean
  statusText: string
  resource: {
    id: string
    type: string
    name: string
    category: string
    thumbnail: string
    badge?: string
    metadata: Record<string, any>
  }
}

interface ChainRow {
  id: ChainId
  meta: ChainMeta
  cards: ChainCard[]
  randomIds: string[]
  poolSize: number
  eligibleCount: number
}

export default {
  name: 'HomeView',
  components: {
    ResourceCard,
    TagFilterMenu,
    FunLoading
  },
  data() {
    return {
      isLoading: true,
      allGames: [] as HomeGame[],
      tagFilter: { include: [], exclude: [] } as TagFilterState,
      rows: [] as ChainRow[]
    }
  },
  computed: {
    tagOptions(): Array<{ name: string; count: number }> {
      return collectTagOptions(this.allGames)
    },
    /** 经过全局标签筛选后的候选游戏 */
    filteredGames(): HomeGame[] {
      return filterGamesByTags(this.allGames, this.tagFilter)
    }
  },
  methods: {
    /* ---------------------------- 数据加载 ---------------------------- */

    async loadGames() {
      this.isLoading = true
      try {
        const api = (window as any).electronAPI
        if (!api?.sqliteGetPageData) {
          this.isLoading = false
          return
        }
        const result = await api.sqliteGetPageData('games')
        const rawGames: any[] = result?.ok ? (result.data ?? []) : []
        this.allGames = rawGames.map(raw => toHomeGame(raw))
        this.rebuildAllRows()
      } catch (error) {
        console.error('[HomeView] 加载游戏库失败:', error)
      } finally {
        this.isLoading = false
      }
    },

    /* ---------------------------- 链路抽签 ---------------------------- */

    /**
     * 抽一条链路。
     * @param chainId 链路 id
     * @param avoidIds 上一次该链路抽中的随机位（重新推荐时避开同一批）
     */
    buildRow(chainId: ChainId, avoidIds: string[] = []): ChainRow {
      const meta = CHAINS.find(chain => chain.id === chainId) as ChainMeta
      const now = Date.now()
      const pick = pickChain(this.filteredGames, chainId, {
        count: DEFAULT_ROW_SIZE,
        pinnedCount: DEFAULT_PINNED_SIZE,
        avoidIds
      })
      const pinnedIds = new Set(pick.pinnedIds)

      const cards: ChainCard[] = pick.games.map(game => {
        const caption = describeGame(chainId, game, now)
        const pinned = pinnedIds.has(game.id)
        return {
          id: game.id,
          pinned,
          statusText: this.$t(caption.key, caption.params) as string,
          resource: {
            id: game.id,
            type: 'game',
            name: game.name,
            category: game.developer || this.$t('home.gameCategory'),
            thumbnail: game.coverPath,
            badge: pinned ? `#${pick.rankOf[game.id]}` : undefined,
            metadata: {
              playTime: game.playTime,
              playCount: game.playCount,
              tags: game.tags,
              developer: game.developer
            }
          }
        }
      })

      return {
        id: chainId,
        meta,
        cards,
        randomIds: pick.randomIds,
        poolSize: pick.poolSize,
        eligibleCount: pick.eligibleCount
      }
    },

    rebuildAllRows() {
      this.rows = CHAINS.map(chain => this.buildRow(chain.id))
    },

    /** 只重刷某一行 */
    reroll(chainId: ChainId) {
      const previous = this.rows.find(row => row.id === chainId)
      const rebuilt = this.buildRow(chainId, previous?.randomIds ?? [])
      const index = this.rows.findIndex(row => row.id === chainId)
      if (index === -1) {
        this.rows = [...this.rows, rebuilt]
      } else {
        this.rows.splice(index, 1, rebuilt)
      }
    },

    emptyTextFor(chainId: ChainId): string {
      if (chainId === 'most-played') return this.$t('home.rowEmptyMostPlayed') as string
      if (chainId === 'recent') return this.$t('home.rowEmptyRecent') as string
      return this.$t('home.rowEmptyUpNext') as string
    },

    /* ---------------------------- 标签筛选 ---------------------------- */

    onTagFilterUpdate(payload: { selected: string[]; excluded: string[] }) {
      this.tagFilter = {
        include: [...payload.selected],
        exclude: [...payload.excluded]
      }
      this.saveTagFilter()
      this.rebuildAllRows()
    },

    clearTagFilter() {
      this.tagFilter = { include: [], exclude: [] }
      this.saveTagFilter()
      this.rebuildAllRows()
    },

    loadTagFilter() {
      try {
        const raw = localStorage.getItem(TAG_FILTER_STORAGE_KEY)
        if (!raw) return
        const parsed = JSON.parse(raw)
        this.tagFilter = {
          include: Array.isArray(parsed?.include) ? parsed.include.filter((t: unknown) => typeof t === 'string') : [],
          exclude: Array.isArray(parsed?.exclude) ? parsed.exclude.filter((t: unknown) => typeof t === 'string') : []
        }
      } catch (error) {
        console.warn('[HomeView] 读取主页标签筛选失败，已忽略:', error)
      }
    },

    saveTagFilter() {
      try {
        localStorage.setItem(TAG_FILTER_STORAGE_KEY, JSON.stringify(this.tagFilter))
      } catch (error) {
        console.warn('[HomeView] 保存主页标签筛选失败:', error)
      }
    },

    /* ---------------------------- 交互 ---------------------------- */

    /** 目前只保留了游戏库：点卡片进「游戏」页，并带上 gameId 让那一页直接弹详情面板 */
    handleResourceClick(gameId: string) {
      this.$router
        .push({ name: 'games', query: gameId ? { gameId } : {} })
        .catch((err: any) => {
          if (err?.name !== 'NavigationDuplicated') {
            console.error('[HomeView] 导航失败:', err)
          }
        })
    }
  },
  mounted() {
    this.loadTagFilter()
    this.loadGames()
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
  padding: 1.25rem 1.5rem 3rem;
  overflow-y: auto;
  background: #f5f5f5;
}

/* 顶部工具栏：全局标签筛选 */
.home-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
  padding: 0.75rem 1rem;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
}

.library-summary {
  color: #888;
  font-size: 0.83rem;
}

.home-loading {
  padding: 4rem 0;
}

/* 链路区块 */
.chain-section {
  margin-bottom: 1.5rem;
  background: #fff;
  border-radius: 8px;
  padding: 1rem 1.25rem 1.25rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.section-title-group {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  flex-wrap: wrap;
  min-width: 0;
}

.section-title {
  font-size: 1.2rem;
  font-weight: 600;
  margin: 0;
  color: #333;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  white-space: nowrap;
}

.chain-icon {
  font-size: 1.1rem;
}

.section-hint {
  color: #999;
  font-size: 0.78rem;
}

.refresh-btn {
  flex-shrink: 0;
  background: #dc2626;
  color: #fff;
  border: none;
  padding: 0.42rem 0.9rem;
  border-radius: 4px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.2s, opacity 0.2s;
}

.refresh-btn:hover:not(:disabled) {
  background: #b91c1c;
}

.refresh-btn:active:not(:disabled) {
  background: #991b1b;
}

.refresh-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 一行 8 张卡（3 固定 + 5 随机） */
.resources-grid {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 0.75rem;
}

/* 固定席位（绝对值最大的前 3 名）加一圈高亮 */
.chain-card.is-pinned {
  box-shadow: 0 0 0 2px #dc2626, 0 2px 6px rgba(220, 38, 38, 0.25);
}

.row-empty {
  padding: 2rem;
  text-align: center;
  color: #aaa;
  font-size: 0.88rem;
  background: #fafafa;
  border-radius: 6px;
}

.empty-state {
  text-align: center;
  padding: 4rem 2rem;
  color: #999;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.empty-icon {
  font-size: 2.5rem;
  margin-bottom: 0.75rem;
  opacity: 0.6;
}

.empty-title {
  font-size: 1.05rem;
  color: #666;
  margin: 0 0 0.35rem;
}

.empty-desc {
  margin: 0 0 1rem;
  font-size: 0.85rem;
}

/* 响应式：窗口变窄时逐级减列 */
@media (max-width: 1400px) {
  .resources-grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}

@media (max-width: 1080px) {
  .resources-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .resources-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .home-content {
    padding: 1rem;
  }
}
</style>
