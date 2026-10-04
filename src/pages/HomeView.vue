<template>
  <div class="home-view">
    <div class="home-content">
      <!-- 顶部：游戏 / 视频 胶囊切换 + 全局标签筛选 -->
      <div class="home-toolbar">
        <div class="toolbar-left">
          <div class="mode-capsule" role="tablist">
            <button
              class="capsule-btn"
              :class="{ 'is-active': mode === 'game' }"
              role="tab"
              :aria-selected="mode === 'game'"
              @click="setMode('game')"
            >🎮 {{ $t('home.modeGame') }}</button>
            <button
              class="capsule-btn"
              :class="{ 'is-active': mode === 'video' }"
              role="tab"
              :aria-selected="mode === 'video'"
              @click="setMode('video')"
            >🎬 {{ $t('home.modeVideo') }}</button>
          </div>
          <TagFilterMenu
            :tags="tagOptions"
            :selected="tagFilter.include"
            :excluded="tagFilter.exclude"
            @update="onTagFilterUpdate"
          />
        </div>
        <span v-if="!isLoading && currentItems.length > 0" class="library-summary">
          {{ isVideoMode
            ? $t('home.videoLibrarySummary', { total: currentItems.length, filtered: filteredItems.length })
            : $t('home.librarySummary', { total: currentItems.length, filtered: filteredItems.length }) }}
        </span>
      </div>

      <div v-if="isLoading" class="home-loading">
        <FunLoading :text="$t('home.loading')" />
      </div>

      <template v-else>
        <!-- 库是空的 -->
        <div v-if="currentItems.length === 0" class="empty-state">
          <div class="empty-icon">{{ isVideoMode ? '🎬' : '🎮' }}</div>
          <p>{{ isVideoMode ? $t('home.videoEmptyLibrary') : $t('home.emptyLibrary') }}</p>
        </div>

        <!-- 有内容但被标签筛选筛光了 -->
        <div v-else-if="filteredItems.length === 0" class="empty-state filter-empty">
          <div class="empty-icon">🔍</div>
          <p class="empty-title">{{ isVideoMode ? $t('home.videoFilteredEmptyTitle') : $t('home.filteredEmptyTitle') }}</p>
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
// 视频版推荐：打分口径不同，抽签数学完全复用
import {
  VIDEO_CHAINS,
  describeVideo,
  filterVideosByTags,
  pickVideoChain,
  toHomeVideo,
  type HomeVideo,
  type VideoChainId,
  type VideoChainMeta
} from '../utils/videoRecommendation'

/** 当前选的是游戏还是视频 */
type HomeMode = 'game' | 'video'

const MODE_STORAGE_KEY = 'ggv-home-mode'
/** 两种模式的标签筛选各自独立（标签集合完全不同，混用只会互相污染） */
const TAG_FILTER_STORAGE_KEYS: Record<HomeMode, string> = {
  game: 'ggv-home-tag-filter',
  video: 'ggv-home-video-tag-filter'
}

/** 链路 id 的并集（两个引擎各自的 id 不重叠：游戏是 most-played/recent/up-next，视频是 most-watched/recent/up-next） */
type AnyChainId = ChainId | VideoChainId

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
  id: AnyChainId
  meta: { id: string, icon: string, titleKey: string, hintKey: string }
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
      /** 当前模式：游戏 / 视频 */
      mode: 'game' as HomeMode,
      allGames: [] as HomeGame[],
      allVideos: [] as HomeVideo[],
      /** 视频库是否已经加载过（切到视频模式才加载，避免白等 6000+ 条） */
      videosLoaded: false,
      tagFilter: { include: [], exclude: [] } as TagFilterState,
      rows: [] as ChainRow[]
    }
  },
  computed: {
    isVideoMode(): boolean {
      return this.mode === 'video'
    },
    /** 当前模式下参与推荐的全部条目（游戏或视频） */
    currentItems(): Array<HomeGame | HomeVideo> {
      return this.isVideoMode ? this.allVideos : this.allGames
    },
    tagOptions(): Array<{ name: string; count: number }> {
      return collectTagOptions(this.currentItems as Array<{ tags: string[] }>)
    },
    /** 经过全局标签筛选后的候选（视频走视频版筛选，语义与游戏页一致） */
    filteredItems(): Array<HomeGame | HomeVideo> {
      if (this.isVideoMode) {
        return filterVideosByTags(this.allVideos, this.tagFilter)
      }
      return filterGamesByTags(this.allGames, this.tagFilter)
    },
    /** 当前模式的链路元信息 */
    chainMetas(): Array<ChainMeta | VideoChainMeta> {
      return this.isVideoMode ? VIDEO_CHAINS : CHAINS
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

    /** 加载视频库（切到视频模式时才加载；主人库里 6000+ 条，不该让游戏模式白等） */
    async loadVideos() {
      this.isLoading = true
      try {
        const api = (window as any).electronAPI
        if (!api?.sqliteGetPageData) {
          this.isLoading = false
          return
        }
        const result = await api.sqliteGetPageData('videos')
        const rawVideos: any[] = result?.ok ? (result.data ?? []) : []
        this.allVideos = rawVideos.map(raw => toHomeVideo(raw))
        this.videosLoaded = true
        this.rebuildAllRows()
      } catch (error) {
        console.error('[HomeView] 加载视频库失败:', error)
      } finally {
        this.isLoading = false
      }
    },

    /** 切到视频模式时按需加载一次 */
    async ensureVideosLoaded() {
      if (this.videosLoaded) return
      await this.loadVideos()
    },

    /** 切换「游戏 / 视频」推荐 */
    async setMode(next: HomeMode) {
      if (next === this.mode) return
      this.mode = next
      try {
        localStorage.setItem(MODE_STORAGE_KEY, next)
      } catch (error) {
        console.warn('[HomeView] 保存主页模式失败:', error)
      }
      // 两种库的标签集合完全不同：切模式时换回它自己那份筛选
      this.loadTagFilter()
      await this.ensureVideosLoaded()
      this.rebuildAllRows()
    },

    /* ---------------------------- 链路抽签 ---------------------------- */

    /**
     * 抽一条链路（游戏 / 视频两套口径，抽签规则一致）。
     * @param chainId 链路 id
     * @param avoidIds 上一次该链路抽中的随机位（重新推荐时避开同一批）
     */
    buildRow(chainId: AnyChainId, avoidIds: string[] = []): ChainRow {
      const now = Date.now()
      return this.isVideoMode
        ? this.buildVideoRow(chainId as VideoChainId, avoidIds, now)
        : this.buildGameRow(chainId as ChainId, avoidIds, now)
    },

    buildGameRow(chainId: ChainId, avoidIds: string[], now: number): ChainRow {
      const meta = CHAINS.find(chain => chain.id === chainId) as ChainMeta
      const pick = pickChain(this.filteredItems as HomeGame[], chainId, {
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

    buildVideoRow(chainId: VideoChainId, avoidIds: string[], now: number): ChainRow {
      const meta = VIDEO_CHAINS.find(chain => chain.id === chainId) as VideoChainMeta
      const pick = pickVideoChain(this.filteredItems as HomeVideo[], chainId, {
        count: DEFAULT_ROW_SIZE,
        pinnedCount: DEFAULT_PINNED_SIZE,
        avoidIds
      })
      const pinnedIds = new Set(pick.pinnedIds)

      const cards: ChainCard[] = pick.items.map(video => {
        const caption = describeVideo(chainId, video, now)
        const pinned = pinnedIds.has(video.id)
        return {
          id: video.id,
          pinned,
          statusText: this.$t(caption.key, caption.params) as string,
          resource: {
            id: video.id,
            type: 'video',
            name: video.name,
            // 「作者」顶上游戏页「开发商」的位置
            category: video.author || this.$t('home.videoCategory'),
            thumbnail: video.coverPath,
            badge: pinned ? `#${pick.rankOf[video.id]}` : undefined,
            metadata: {
              watchCount: video.watchCount,
              lastOpened: video.lastOpened,
              durationSec: video.durationSec,
              relPath: video.relPath,
              tags: video.tags,
              author: video.author,
              fileExists: video.fileExists
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
      this.rows = this.chainMetas.map(chain => this.buildRow(chain.id as AnyChainId))
    },

    /** 只重刷某一行 */
    reroll(chainId: AnyChainId) {
      const previous = this.rows.find(row => row.id === chainId)
      const rebuilt = this.buildRow(chainId, previous?.randomIds ?? [])
      const index = this.rows.findIndex(row => row.id === chainId)
      if (index === -1) {
        this.rows = [...this.rows, rebuilt]
      } else {
        this.rows.splice(index, 1, rebuilt)
      }
    },

    emptyTextFor(chainId: AnyChainId): string {
      if (this.isVideoMode) {
        if (chainId === 'most-watched') return this.$t('home.rowEmptyVideoMostWatched') as string
        if (chainId === 'recent') return this.$t('home.rowEmptyVideoRecent') as string
        return this.$t('home.rowEmptyVideoUpNext') as string
      }
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
        // 两种模式各存一份：标签集合完全不同，混用只会互相污染
        const raw = localStorage.getItem(TAG_FILTER_STORAGE_KEYS[this.mode])
        if (!raw) {
          this.tagFilter = { include: [], exclude: [] }
          return
        }
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
        localStorage.setItem(TAG_FILTER_STORAGE_KEYS[this.mode], JSON.stringify(this.tagFilter))
      } catch (error) {
        console.warn('[HomeView] 保存主页标签筛选失败:', error)
      }
    },

    /* ---------------------------- 交互 ---------------------------- */

    /**
     * 点卡片：按当前模式跳到对应页面，并带上 id 让那一页直接弹详情面板。
     * 游戏 → ?gameId=，视频 → ?videoId=（GenericResourceView 里对称处理）
     */
    handleResourceClick(resourceId: string) {
      const target = this.isVideoMode
        ? { name: 'videos', query: resourceId ? { videoId: resourceId } : {} }
        : { name: 'games', query: resourceId ? { gameId: resourceId } : {} }

      this.$router
        .push(target)
        .catch((err: any) => {
          if (err?.name !== 'NavigationDuplicated') {
            console.error('[HomeView] 导航失败:', err)
          }
        })
    }
  },
  async mounted() {
    // 记住上次停在游戏还是视频
    try {
      const saved = localStorage.getItem(MODE_STORAGE_KEY)
      if (saved === 'video' || saved === 'game') this.mode = saved
    } catch (error) {
      console.warn('[HomeView] 读取主页模式失败:', error)
    }

    this.loadTagFilter()
    await this.loadGames()
    if (this.isVideoMode) {
      await this.ensureVideosLoaded()
      this.rebuildAllRows()
    }
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

/* 顶部工具栏：模式胶囊 + 全局标签筛选 */
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

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  min-width: 0;
}

/* 游戏 / 视频 胶囊切换 */
.mode-capsule {
  display: inline-flex;
  align-items: center;
  padding: 3px;
  gap: 2px;
  background: #f0f0f2;
  border-radius: 999px;
  flex-shrink: 0;
}

.capsule-btn {
  border: none;
  background: transparent;
  color: #666;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 0.32rem 0.9rem;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
  white-space: nowrap;
}

.capsule-btn:hover {
  color: #333;
}

.capsule-btn.is-active {
  background: #fff;
  color: #dc2626;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.16);
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
