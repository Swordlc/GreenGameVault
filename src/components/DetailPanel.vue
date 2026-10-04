<template>
  <div v-if="visible" class="detail-overlay" @mousedown="handleOverlayMouseDown">
    <div class="detail-content" @mousedown.stop>
      <div class="detail-header">
        <button 
          class="detail-favorite" 
          :class="{ 'favorited': item?.isFavorite?.value ?? item?.isFavorite }"
          @click="handleFavoriteClick"
          :title="(item?.isFavorite?.value ?? item?.isFavorite) ? '取消收藏' : '收藏'"
        >
          {{ (item?.isFavorite?.value ?? item?.isFavorite) ? '⭐' : '☆' }}
        </button>
        <button class="detail-close" @click="close">✕</button>
      </div>
      <div class="detail-body" v-if="item">
        <div class="detail-left">
          <div class="detail-image">
            <img 
              :src="resolveImage((item.coverPath?.value ?? item.coverPath) || (item.image?.value ?? item.image) || (item.cover?.value ?? item.cover) || (item.thumbnail?.value ?? item.thumbnail) || (item.favicon?.value ?? item.favicon))" 
              :alt="item.name?.value ?? item.name"
              @error="handleImageError"
            >
            <!-- 文件不存在错误图标 -->
            <div v-if="showFileError" class="file-error-icon" title="本地文件不存在">
              ⚠️
            </div>
          </div>
          
          <!-- 玩家评价区域 -->
          <div class="detail-rating">
            <h4 class="rating-title">玩家评价</h4>
            <fun-rate
              :model-value="getFieldValue(item.rating) || 0"
              :comment="getFieldValue(item.comment) || getFieldValue(item.notes) || ''"
              show-comment
              @update:model-value="handleRatingChange"
              @update:comment="handleCommentChange"
            />
          </div>
        </div>
        <div class="detail-info">
          <!-- 主标题（根据配置动态生成） -->
          <h2 class="detail-title">
            {{ computedTitle }}
            <span class="resource-type-badge">{{ resourceTypeLabel }}</span>
          </h2>
          
          <!-- 客观信息区（根据配置动态生成） -->
          <template v-for="(info, index) in computedObjectiveInfo" :key="index">
            <p 
              v-if="info.value" 
              :class="getObjectiveInfoClass(info.field)"
              :title="info.value"
            >
              <span v-if="info.label" class="info-label">{{ info.label }}：</span><span>{{ infoDisplayValue(info) }}</span><button
                v-if="isInfoTruncatable(info)"
                type="button"
                class="info-toggle"
                @click.stop="toggleInfoExpanded(info.field)"
              >{{ isInfoExpanded(info.field) ? '收起' : `展开全部 (${info.items.length})` }}</button>
            </p>
          </template>
          
          <!-- 描述信息 -->
          <div class="detail-description" v-if="item.description?.value ?? item.description">
            <h4 class="description-title">{{ descriptionTitle }}</h4>
            <p class="description-content">{{ item.description?.value ?? item.description }}</p>
          </div>
          
          <!-- 标签信息 -->
          <div class="detail-tags" v-if="(item.tags?.value ?? item.tags) && (item.tags?.value ?? item.tags).length > 0">
            <h4 class="tags-title">{{ tagsTitle }}</h4>
            <div class="tags-container">
              <fun-tag 
                v-for="tag in (item.tags?.value ?? item.tags)" 
                :key="tag" 
                :text="tag"
              />
            </div>
          </div>
          
          <!-- 数据记录区（根据配置动态生成） -->
          <div class="detail-stats" v-if="computedStats.length > 0">
            <div 
              v-for="stat in computedStats" 
              :key="stat.label" 
              class="stat-item"
            >
              <span class="stat-label">{{ stat.label }}</span>
              <span class="stat-value">{{ stat.value }}</span>
            </div>
          </div>
          
          <!-- 操作按钮（根据配置动态生成） -->
          <div class="detail-actions">
            <button 
              v-for="action in computedActions" 
              :key="action.key"
              :class="action.class"
              @click="(e) => {
                console.log('📋 [DetailPanel] 按钮被点击:', {
                  actionKey: action.key,
                  actionLabel: action.label,
                  event: e,
                  target: e.target,
                  currentTarget: e.currentTarget,
                  timestamp: new Date().toISOString()
                })
                handleAction(action.key)
              }"
            >
              <span class="btn-icon">{{ action.icon }}</span>
              {{ action.label }}
            </button>
          </div>
        </div>
      </div>
      
      <!-- 额外的内容区域（如图片分页等） -->
      <div v-if="$slots.extra" class="extra-section">
        <slot name="extra"></slot>
      </div>
    </div>
  </div>
</template>

<script>
// 详情页左侧封面：相对 SaveData 的路径要先经主进程拼成绝对路径，再读成 data:URL
// （做法与 MediaCard 保持一致，见 resolveImage 的注释）
import coverManager from '../utils/CoverManager.ts'

export default {
  name: 'DetailPanel',
  props: {
    visible: {
      type: Boolean,
      default: false
    },
    item: {
      type: Object,
      default: null
    },
    type: {
      type: String,
      required: true,
      validator: value => ['game', 'software', 'image', 'album', 'video', 'audio', 'novel', 'website', 'file', 'folder'].includes(value)
    },
    isRunning: {
      type: Boolean,
      default: false
    },
    stats: {
      type: Array,
      default: () => []
    },
    actions: {
      type: Array,
      default: () => []
    },
    // 统一的更新函数（如果提供，组件内部会自动处理评分、评论和收藏）
    onUpdateResource: {
      type: Function,
      default: null
    }
  },
  emits: ['close', 'action', 'update-rating', 'update-comment', 'toggle-favorite'],
  data() {
    return {
      // 已展开的「可折叠客观信息」字段名（如 developers）。默认全部折叠。
      expandedInfoFields: {},
      // 相对 SaveData 的封面（games/covers/x.png、videos/covers/x.jpg）→ 可直接显示的 data:/file: URL
      imageCache: {},
      // 正在解析中的相对路径（防止同一张图并发请求多次）
      resolvingImages: {}
    }
  },
  watch: {
    // 换一个资源就恢复默认折叠状态，避免上次的展开状态串到下一个游戏
    item() {
      this.expandedInfoFields = {}
    },
    // 封面被重刷（视频页是固定文件名覆盖写）→ 丢掉缓存，否则左侧一直显示旧图
    // ⚠️ 必须监听 computed（返回原始值）：直接写 'item.coverUpdatedAt' 监听的是
    //    ResourceField **对象身份**，而抽帧只改它的 .value，watcher 根本不会触发。
    coverRevision: {
      handler() {
        this.invalidateCoverCache()
      }
    }
  },
  computed: {
    descriptionTitle() {
      // 从配置中读取，如果没有配置返回默认值
      const config = this.detailPanelConfig
      return config?.descriptionTitle || '简介'
    },
    tagsTitle() {
      // 从配置中读取，如果没有配置返回默认值
      const config = this.detailPanelConfig
      return config?.tagsTitle || '标签'
    },
    // 获取资源的详情页配置
    detailPanelConfig() {
      if (!this.item) return null
      // 从资源的构造函数获取配置
      const ResourceClass = this.item.constructor
      return ResourceClass?.detailPanelConfig || null
    },
    /**
     * 封面版本号（视频每次抽帧/删封面都会变）。
     * 必须是**原始值**的 computed，watcher 才真的会触发 —— 见 watch.coverRevision 的注释。
     */
    coverRevision() {
      const raw = this.item?.coverUpdatedAt
      return Number(raw?.value ?? raw ?? 0) || 0
    },
    // 根据配置生成主标题
    computedTitle() {
      if (!this.item) return ''
      const config = this.detailPanelConfig
      if (config?.title) {
        const fieldValue = this.getFieldValueFromItem(this.item, config.title.field)
        if (config.title.formatter) {
          return this.applyFormatter(fieldValue, config.title.formatter)
        }
        return fieldValue || ''
      }
      // 如果没有配置，使用默认的 name 字段
      return this.item.name?.value ?? this.item.name ?? ''
    },
    // 资源类型标签
    resourceTypeLabel() {
      // 优先从 item.resourceType 获取，直接返回原始类型
      return this.item?.resourceType?.value ?? this.item?.resourceType ?? this.type
    },
    // 根据配置生成客观信息区
    computedObjectiveInfo() {
      if (!this.item) return []
      const config = this.detailPanelConfig
      if (!config?.objectiveInfo || !Array.isArray(config.objectiveInfo)) {
        return []
      }
      
      return config.objectiveInfo.map(infoConfig => {
        let fieldValue = this.getFieldValueFromItem(this.item, infoConfig.field)
        
        // 如果字段值为空且有 fallbackFields，尝试使用 fallback 字段
        if (!fieldValue && infoConfig.fallbackFields && Array.isArray(infoConfig.fallbackFields)) {
          for (const fallbackField of infoConfig.fallbackFields) {
            const fallbackValue = this.getFieldValueFromItem(this.item, fallbackField)
            if (fallbackValue) {
              fieldValue = fallbackValue
              break
            }
          }
        }
        
        // 数组字段：先留一份原始条目（折叠时只显示前 N 个），再按连接符拼成显示文本
        let items = null
        if (Array.isArray(fieldValue)) {
          const joinChar = infoConfig.arrayJoin || '、'
          items = fieldValue.filter(v => v !== null && v !== undefined && String(v).trim() !== '')
          fieldValue = items.join(joinChar)
        }
        
        // 应用格式化函数
        if (fieldValue && infoConfig.formatter) {
          fieldValue = this.applyFormatter(fieldValue, infoConfig.formatter)
        }
        
        return {
          field: infoConfig.field,
          label: infoConfig.label,
          value: fieldValue || '',
          // 折叠相关（如开发商动辄几十个，会把下方的标签挤到看不见）
          collapsible: infoConfig.collapsible === true,
          collapsedLimit: typeof infoConfig.collapsedLimit === 'number' ? infoConfig.collapsedLimit : 3,
          items
        }
      }).filter(info => info.value) // 只返回有值的项
    },
    // 根据配置生成数据记录区
    computedDataRecords() {
      if (!this.item) return []
      const config = this.detailPanelConfig
      if (!config?.dataRecords || !Array.isArray(config.dataRecords)) {
        return [] // 如果没有配置，返回空数组，由 computedStats 处理
      }
      
      // 如果资源正在运行，在最前面显示运行状态（从配置中判断）
      const records = []
      if (this.isRunning && config?.showRunningStatus !== false) {
        records.push({ label: '运行状态', value: '▶️ 运行中' })
      }
      
      config.dataRecords.forEach(recordConfig => {
        let fieldValue = this.getFieldValueFromItem(this.item, recordConfig.field)
        
        // 如果是数组，使用连接符连接
        if (Array.isArray(fieldValue)) {
          const joinChar = recordConfig.arrayJoin || '、'
          fieldValue = fieldValue.join(joinChar)
        }
        
        // 应用格式化函数
        if (fieldValue !== undefined && fieldValue !== null && recordConfig.formatter) {
          fieldValue = this.applyFormatter(fieldValue, recordConfig.formatter)
        }
        
        // 如果值为空，使用默认值
        if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
          fieldValue = recordConfig.defaultValue || ''
        }
        
        records.push({
          label: recordConfig.label,
          value: fieldValue
        })
      })
      
      return records.filter(record => record.value !== undefined && record.value !== null && record.value !== '')
    },
    // 统计信息：优先使用配置，如果没有配置返回空数组
    computedStats() {
      if (this.stats.length > 0) {
        return this.stats
      }
      
      // 如果有配置的数据记录，使用配置生成的数据记录
      const configRecords = this.computedDataRecords
      if (configRecords.length > 0) {
        return configRecords
      }
      
      // 如果没有配置，返回空数组（不再提供向后兼容的默认值）
      return []
    },
    computedActions() {
      console.log('📋 [DetailPanel] computedActions 被调用:', {
        type: this.type,
        actions: this.actions,
        actionsIsArray: Array.isArray(this.actions),
        actionsLength: this.actions ? this.actions.length : 0,
        timestamp: new Date().toISOString()
      })
      
      // 如果传递了 actions prop 且不为空，使用传递的 actions
      if (this.actions && Array.isArray(this.actions) && this.actions.length > 0) {
        console.log('📋 [DetailPanel] 使用传递的 actions:', this.actions)
        return this.actions
      }
      
      // 尝试从配置中获取按钮组
      const config = this.detailPanelConfig
      console.log('📋 [DetailPanel] 检查配置:', {
        hasConfig: !!config,
        hasActions: !!(config?.actions),
        actionsIsArray: Array.isArray(config?.actions),
        actionsLength: config?.actions?.length || 0,
        actions: config?.actions
      })
      if (config?.actions && Array.isArray(config.actions)) {
        const generatedActions = this.generateActionsFromConfig(config.actions)
        console.log('📋 [DetailPanel] 从配置生成的按钮:', generatedActions)
        return generatedActions
      }
      
      // 如果没有配置，返回空数组（不再提供向后兼容的默认值）
      console.log('📋 [DetailPanel] 没有配置的 actions，返回空数组')
      return []
    },
    hasRating() {
      // 判断是否有评价数据（有星级或评论）
      const rating = this.item?.rating?.value ?? this.item?.rating
      const comment = this.item?.comment?.value ?? this.item?.comment
      const notes = this.item?.notes?.value ?? this.item?.notes
      return (rating && rating > 0) || comment || notes
    },
    showFileError() {
      // 从配置中判断是否需要检查文件存在性
      const config = this.detailPanelConfig
      if (config?.checkFileExists === false) {
        return false
      }
      // 检查 fileExists 属性，如果明确为 false 则显示错误
      const fileExists = this.item?.fileExists?.value ?? this.item?.fileExists
      if (fileExists === false) {
        return true
      }
      return false
    }
  },
  methods: {
    close() {
      this.$emit('close')
    },
    /**
     * 安全获取字段值
     * 如果字段是 ResourceField，返回其 value；否则直接返回字段值
     * 如果值是对象（非原始类型），返回 undefined，避免显示 JSON
     */
    getFieldValue(field) {
      if (!field) return undefined
      // 如果是 ResourceField，提取 value
      if (field && typeof field === 'object' && 'value' in field) {
        const value = field.value
        // 如果 value 是原始类型（字符串、数字、布尔值），返回它
        if (value !== undefined && value !== null && 
            (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value))) {
          return value
        }
        // 如果 value 是对象，返回 undefined（不显示）
        return undefined
      }
      // 如果字段本身就是原始类型，直接返回
      if (typeof field === 'string' || typeof field === 'number' || typeof field === 'boolean' || Array.isArray(field)) {
        return field
      }
      // 如果是对象，返回 undefined（不显示）
      return undefined
    },
    /**
     * 获取开发商显示文本
     * 支持 developers（数组）和 developer（字符串）两种格式
     */
    getDevelopersDisplay(item) {
      // 优先检查 developers（数组）
      const developers = item?.developers?.value ?? item?.developers
      if (developers && Array.isArray(developers) && developers.length > 0) {
        return developers.join('、')
      }
      // 兼容 developer（字符串）
      const developer = item?.developer?.value ?? item?.developer
      if (developer && typeof developer === 'string') {
        return developer
      }
      return ''
    },
    async handleFavoriteClick() {
      // 检查 item 是否存在，避免在面板关闭时触发更新
      const itemId = this.item?.id?.value ?? this.item?.id
      if (!this.item || !itemId) {
        return
      }
      
      // 如果提供了统一的更新函数，直接调用
      if (this.onUpdateResource && typeof this.onUpdateResource === 'function') {
        try {
          const currentFavorite = this.item.isFavorite?.value ?? this.item.isFavorite
          const newFavoriteStatus = !currentFavorite
          await this.onUpdateResource(itemId, { isFavorite: newFavoriteStatus })
          // 立即更新UI
          if (this.item.isFavorite?.value !== undefined) {
            this.item.isFavorite.value = newFavoriteStatus
          } else {
            this.item.isFavorite = newFavoriteStatus
          }
        } catch (error) {
          console.error('切换收藏状态失败:', error)
        }
      } else {
        // 否则 emit 事件（向后兼容）
        this.$emit('toggle-favorite', this.item)
      }
    },
    /**
     * 处理 overlay 区域的 mousedown 事件
     * 使用 mousedown 而不是 click，避免在复制文字时（鼠标在外部区域释放）误关闭
     * 这样只有在外部区域按下鼠标时才会关闭，符合常见软件的交互习惯
     */
    handleOverlayMouseDown(event) {
      // 只在 overlay 背景上按下鼠标时才关闭（不是 content 区域）
      // event.target 是 overlay 本身，而不是 content
      if (event.target === event.currentTarget) {
        this.close()
      }
    },
    handleAction(actionKey) {
      const itemId = this.item?.id?.value ?? this.item?.id
      const itemName = this.item?.name?.value ?? this.item?.name
      console.log('📋 [DetailPanel] handleAction 被调用:', {
        actionKey,
        type: this.type,
        item: this.item ? { id: itemId, name: itemName } : null,
        actions: this.actions,
        computedActions: this.computedActions,
        timestamp: new Date().toISOString()
      })
      this.$emit('action', actionKey, this.item)
      console.log('📋 [DetailPanel] action 事件已发出:', actionKey)
    },
    async handleRatingChange(rating) {
      // 检查 item 是否存在，避免在面板关闭时触发更新
      const itemId = this.item?.id?.value ?? this.item?.id
      if (!this.item || !itemId) {
        return
      }
      
      // 如果提供了统一的更新函数，直接调用
      if (this.onUpdateResource && typeof this.onUpdateResource === 'function') {
        try {
          await this.onUpdateResource(itemId, { rating })
          // 立即更新UI
          if (this.item.rating?.value !== undefined) {
            this.item.rating.value = rating
          } else {
            this.item.rating = rating
          }
        } catch (error) {
          console.error('更新评分失败:', error)
        }
      } else {
        // 否则 emit 事件（向后兼容）
        this.$emit('update-rating', rating, this.item)
      }
    },
    async handleCommentChange(comment) {
      // 检查 item 是否存在，避免在面板关闭时触发更新
      const itemId = this.item?.id?.value ?? this.item?.id
      if (!this.item || !itemId) {
        return
      }
      
      // 如果提供了统一的更新函数，直接调用
      if (this.onUpdateResource && typeof this.onUpdateResource === 'function') {
        try {
          await this.onUpdateResource(itemId, { comment })
          // 立即更新UI
          if (this.item.comment?.value !== undefined) {
            this.item.comment.value = comment
          } else {
            this.item.comment = comment
          }
        } catch (error) {
          console.error('更新评论失败:', error)
        }
      } else {
        // 否则 emit 事件（向后兼容）
        this.$emit('update-comment', comment, this.item)
      }
    },
    isArchiveFile(filePath) {
      if (!filePath) return false
      const fileName = filePath.toLowerCase()
      const archiveExtensions = ['.zip', '.rar', '.7z', '.tar', '.gz', '.tar.gz', '.bz2', '.tar.bz2', '.xz', '.tar.xz']
      return archiveExtensions.some(ext => fileName.endsWith(ext))
    },
    /**
     * 详情页左侧封面图的解析
     *
     * 历史 bug（2026-10-04 主人指出「左侧截图位置始终为空」，游戏页同样中招）：
     * 旧实现把**相对 SaveData 的**封面路径直接拼成 `file://games/covers/x.png` ——
     * 这既没有盘符也不是合法的 file URL，必然加载失败；`@error` 又回退到并不存在的
     * `./default-image.png`，于是左侧永远是一块空白。
     *
     * 现在的规则：
     *   1. 已经是 data:/http(s)/file:/archive: → 直接用
     *   2. 绝对磁盘路径（D:\…）→ 转 file:/// 并用
     *   3. 相对 SaveData 的路径 → 交给主进程拼出完整路径，再读成 data:URL
     *      （http(s) 源下直接加载 file:// 会被拦，这跟 MediaCard 是同一套做法）
     *   4. 空值 → 资源类自己的默认图标
     */
    resolveImage(imagePath) {
      if (imagePath?.value !== undefined) {
        imagePath = imagePath.value
      }

      const config = this.detailPanelConfig

      // 空值返回默认图片
      if (!imagePath || (typeof imagePath === 'string' && imagePath.trim() === '')) {
        return this.defaultImage()
      }

      const pathText = String(imagePath)

      // 已经是可直接显示的 URL
      if (/^(https?:|data:|file:|archive:)/i.test(pathText)) {
        return pathText
      }

      // 绝对磁盘路径（Windows：D:\… / D:/…）
      if (/^[A-Za-z]:[\\/]/.test(pathText)) {
        return this.toFileUrl(pathText)
      }

      // 相对 SaveData 的路径 → 必须异步解析成 data:URL
      if (this.imageCache[pathText]) {
        return this.imageCache[pathText]
      }
      this.loadRelativeImage(pathText)
      return this.defaultImage()
    },
    /** 丢掉当前封面的缓存（重刷/删除封面后调用），让 resolveImage 重新读一次 */
    invalidateCoverCache() {
      const coverPath = this.item?.coverPath?.value ?? this.item?.coverPath
      if (typeof coverPath === 'string' && coverPath && this.imageCache) {
        delete this.imageCache[coverPath]
      } else if (this.imageCache) {
        // 封面被删掉了：整份缓存清掉最省事（详情页至多几张大图）
        this.imageCache = {}
      }
    },
    /** 资源类自己的默认图标优先（Game → default-game.png，Video → default-video.png） */
    defaultImage() {
      try {
        const fromClass = this.item?.constructor?.getDefaultIcon?.()
        if (fromClass) return fromClass
      } catch (_) {
        // 忽略
      }
      return this.detailPanelConfig?.defaultImage || './default-game.png'
    },
    /** 把磁盘绝对路径转成可用的 file:// URL（正确处理中文与空格） */
    toFileUrl(imagePath) {
      try {
        const normalized = String(imagePath).replace(/\\/g, '/').replace(/^([A-Za-z]:)/, '/$1')
        const encoded = normalized.split('/').map(seg => {
          if (seg.includes(':')) return seg
          return encodeURIComponent(seg)
        }).join('/')
        return `file://${encoded}`
      } catch (error) {
        console.error('构建文件URL失败:', error)
        return `file:///${String(imagePath).replace(/\\/g, '/')}`
      }
    },
    /** 异步把「相对 SaveData 的封面路径」读成 data:URL 并缓存 */
    async loadRelativeImage(relPath) {      if (this.resolvingImages[relPath]) return
      this.resolvingImages[relPath] = true
      try {
        let resolved = ''
        if (window.electronAPI?.getCoverFullPath) {
          resolved = await coverManager.getCoverUrl(relPath)
        }
        let url = resolved || relPath
        // http(s) 源下 file:// 会被拦，统一读成 data:URL
        if (!/^(data:|https?:)/i.test(url) && window.electronAPI?.readFileAsDataUrl) {
          const dataUrl = await window.electronAPI.readFileAsDataUrl(url)
          if (dataUrl) url = dataUrl
        }
        this.imageCache[relPath] = url
      } catch (error) {
        console.warn('[DetailPanel] 解析封面路径失败:', relPath, error)
      } finally {
        delete this.resolvingImages[relPath]
      }
    },
    resolveVideoThumbnail(thumbnail) {
      // 处理视频缩略图路径，参考VideoView.vue的逻辑
      if (!thumbnail) {
        return './default-video.png'
      }
      
      // 相对路径处理（以 SaveData 开头）
      if (thumbnail.startsWith('SaveData/')) {
        const normalized = thumbnail.replace(/\\/g, '/')
        // 对相对路径也进行编码，处理中文和特殊字符
        const encoded = normalized.split('/').map(seg => {
          return encodeURIComponent(seg)
        }).join('/')
        return `file:///${encoded}`
      }
      
      // 绝对路径处理
      if (thumbnail.includes(':')) {
        const normalized = thumbnail.replace(/\\/g, '/').replace(/^([A-Za-z]:)/, '/$1')
        const encoded = normalized.split('/').map(seg => {
          if (seg.includes(':')) return seg
          return encodeURIComponent(seg)
        }).join('/')
        return `file://${encoded}`
      }
      
      // 其他情况直接返回
      return thumbnail
    },
    handleImageError(event) {
      // 默认图本身也可能不存在：加个标记，避免「坏图 → 设默认 → 又坏 → 再设」的死循环
      const target = event?.target
      if (!target) return
      if (target.dataset && target.dataset.fallbackApplied === '1') return
      if (target.dataset) target.dataset.fallbackApplied = '1'
      target.src = this.defaultImage()
    },
    formatDate(date) {
      if (!date) return '未知'
      try {
        return new Date(date).toLocaleDateString('zh-CN')
      } catch {
        return '未知'
      }
    },
    formatPlayTime(seconds) {
      if (!seconds || seconds === 0) return '0 分钟'
      const hours = Math.floor(seconds / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      if (hours > 0) {
        return `${hours} 小时 ${minutes} 分钟`
      }
      return `${minutes} 分钟`
    },
    formatLastPlayed(date) {
      if (!date) return '从未游玩'
      try {
        return new Date(date).toLocaleDateString('zh-CN')
      } catch {
        return '未知'
      }
    },
    formatFirstPlayed(date) {
      if (!date) return '从未游玩'
      try {
        return new Date(date).toLocaleDateString('zh-CN')
      } catch {
        return '未知'
      }
    },
    // ===== 视频页专用的展示口径（视频不计时，只统计打开次数）=====
    /** 最后打开时间（视频语境：从未观看） */
    formatLastOpened(date) {
      if (!date) return '从未观看'
      try {
        return new Date(date).toLocaleDateString('zh-CN')
      } catch {
        return '未知'
      }
    },
    /** 第一次打开时间（视频语境：从未观看） */
    formatFirstOpened(date) {
      if (!date) return '从未观看'
      try {
        return new Date(date).toLocaleDateString('zh-CN')
      } catch {
        return '未知'
      }
    },
    /** 视频时长（秒 → 人话） */
    formatVideoLength(seconds) {
      const total = Number(seconds) || 0
      if (total <= 0) return '未知'
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const secs = Math.floor(total % 60)
      if (hours > 0) return `${hours} 小时 ${minutes} 分钟`
      if (minutes > 0) return `${minutes} 分 ${secs} 秒`
      return `${secs} 秒`
    },
    /** 文件大小（字节 → 人话） */
    formatFolderSize(bytes) {
      const size = Number(bytes) || 0
      if (size <= 0) return '未知'
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      let value = size
      let index = 0
      while (value >= 1024 && index < units.length - 1) {
        value /= 1024
        index++
      }
      return `${Math.round(value * 100) / 100} ${units[index]}`
    },
    /**
     * 从 item 中获取字段值（支持 ResourceField 和普通值）
     */
    getFieldValueFromItem(item, fieldName) {
      if (!item || !fieldName) return undefined
      const field = item[fieldName]
      return this.getFieldValue(field)
    },
    /**
     * 应用格式化函数
     */
    applyFormatter(value, formatterName) {
      if (!formatterName || !value) return value
      
      // 格式化函数映射
      const formatters = {
        formatPlayTime: this.formatPlayTime,
        formatLastPlayed: this.formatLastPlayed,
        formatFirstPlayed: this.formatFirstPlayed,
        formatDate: this.formatDate,
        // 视频页
        formatLastOpened: this.formatLastOpened,
        formatFirstOpened: this.formatFirstOpened,
        formatVideoLength: this.formatVideoLength,
        formatFolderSize: this.formatFolderSize
      }
      
      const formatter = formatters[formatterName]
      if (formatter && typeof formatter === 'function') {
        return formatter(value)
      }
      
      return value
    },
    /**
     * 获取客观信息区的 CSS 类名（根据字段名）
     */
    getObjectiveInfoClass(fieldName) {
      // 根据字段名返回对应的 CSS 类
      const classMap = {
        'author': 'detail-author',
        'developers': 'detail-developer',
        'developer': 'detail-developer',
        'publisher': 'detail-publisher',
        'engine': 'detail-engine',
        'resourcePath': 'detail-folder',
        'executablePath': 'detail-folder',
        'filePath': 'detail-folder',
        'folderPath': 'detail-folder',
        'url': 'detail-folder'
      }
      return classMap[fieldName] || 'detail-info-item'
    },
    /**
     * 该字段是否「值得折叠」——只有配置了 collapsible 且条目数超过阈值时才需要
     */
    isInfoTruncatable(info) {
      return !!(info && info.collapsible && Array.isArray(info.items) && info.items.length > info.collapsedLimit)
    },
    /** 该字段当前是否处于展开状态 */
    isInfoExpanded(field) {
      return !!(field && this.expandedInfoFields[field])
    },
    /** 切换某个字段的展开/折叠 */
    toggleInfoExpanded(field) {
      if (!field) return
      this.expandedInfoFields = {
        ...this.expandedInfoFields,
        [field]: !this.expandedInfoFields[field]
      }
    },
    /**
     * 客观信息区实际显示的文本：折叠时只显示前 N 个条目 + 省略号
     * （完整内容仍在 title 属性里，鼠标悬停可看）
     */
    infoDisplayValue(info) {
      if (!this.isInfoTruncatable(info) || this.isInfoExpanded(info.field)) {
        return info.value
      }
      return `${info.items.slice(0, info.collapsedLimit).join('、')} …`
    },
    /**
     * 根据配置生成按钮组
     */
    generateActionsFromConfig(actionsConfig) {
      if (!this.item) return []
      
      const actions = []
      
      actionsConfig.forEach(actionConfig => {
        // 检查显示条件
        if (actionConfig.showCondition) {
          const condition = actionConfig.showCondition
          
          // 检查是否为压缩包
          if (condition.notArchive) {
            const resourcePath = this.item?.resourcePath?.value ?? this.item?.resourcePath ?? 
                                this.item?.executablePath?.value ?? this.item?.executablePath
            const itemIsArchive = this.item?.isArchive?.value ?? this.item?.isArchive
            const isArchive = itemIsArchive || (resourcePath && this.isArchiveFile(resourcePath))
            if (isArchive) {
              return // 跳过这个按钮
            }
          }
          
          // 检查运行状态替代按钮
          if (condition.runningAlternative && this.isRunning) {
            actions.push(condition.runningAlternative)
            return
          }
        }
        
        // 添加按钮
        actions.push({
          key: actionConfig.key,
          icon: actionConfig.icon,
          label: actionConfig.label,
          class: actionConfig.class
        })
      })
      
      return actions
    }
  }
}
</script>

<style scoped>
/* 详情面板样式 */
.detail-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.detail-content {
  background: var(--bg-secondary);
  border-radius: 12px;
  width: 800px;
  max-width: 90vw;
  max-height: 90vh;
  overflow-y: auto;
  overflow-x: hidden; /* 防止横向滚动 */
  box-shadow: 0 20px 40px var(--shadow-medium);
  transition: background-color 0.3s ease;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 20px;
  border-bottom: 1px solid var(--border-color);
}

.detail-favorite {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.3s ease;
  padding: 5px;
  line-height: 1;
}

.detail-favorite:hover {
  color: #fbbf24;
  transform: scale(1.1);
}

.detail-favorite.favorited {
  color: #fbbf24;
}

.detail-close {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: var(--text-secondary);
  transition: color 0.3s ease;
}

.detail-close:hover {
  color: var(--text-primary);
}

.detail-body {
  display: flex;
  gap: 30px;
  padding: 30px;
}

.detail-left {
  flex-shrink: 0;
  width: 300px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.detail-image {
  width: 100%;
  height: 400px;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 8px 25px var(--shadow-medium);
  position: relative;
}

.detail-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.file-error-icon {
  position: absolute;
  top: 10px;
  left: 10px;
  background: #ef4444;
  color: white;
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: bold;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  z-index: 10;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.8;
    transform: scale(1.05);
  }
}

.detail-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0; /* 防止 flex 子元素溢出 */
  overflow-wrap: break-word; /* 允许在单词内部换行 */
}

.detail-title {
  color: var(--text-primary);
  font-size: 2rem;
  font-weight: 700;
  margin: 0;
  transition: color 0.3s ease;
  word-break: break-all;
  overflow-wrap: break-word; /* 允许在单词内部换行 */
  word-wrap: break-word; /* 兼容旧浏览器 */
  max-width: 100%; /* 确保不超过容器宽度 */
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.resource-type-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  font-size: 0.75rem;
  font-weight: 500;
  background: var(--accent-color);
  color: white;
  border-radius: var(--radius-md);
  white-space: nowrap;
  flex-shrink: 0;
}

.detail-author,
.detail-developer {
  color: var(--text-secondary);
  font-size: 1.1rem;
  margin: 0 0 8px 0;
  transition: color 0.3s ease;
}

.detail-info-item {
  color: var(--text-secondary);
  font-size: 1rem;
  margin: 0 0 8px 0;
  transition: color 0.3s ease;
}

.info-label {
  font-weight: 600;
  color: var(--text-primary);
}

/* 「展开全部 / 收起」小按钮（如开发商列表折叠） */
.info-toggle {
  display: inline;
  margin-left: 6px;
  padding: 0;
  border: none;
  background: none;
  color: var(--color-primary, #4a9eff);
  font-size: 0.85em;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
  white-space: nowrap;
  opacity: 0.85;
  transition: opacity 0.2s ease;
}

.info-toggle:hover {
  opacity: 1;
}

.detail-publisher {
  color: var(--text-tertiary);
  font-size: 1rem;
  margin: 0 0 15px 0;
  font-style: italic;
  transition: color 0.3s ease;
}

.detail-engine {
  color: var(--text-tertiary);
  font-size: 0.95rem;
  margin: 0 0 15px 0;
  transition: color 0.3s ease;
}

.detail-engine .engine-label {
  font-weight: 600;
  color: var(--text-secondary);
}

.detail-folder {
  color: var(--text-tertiary);
  font-size: 0.9rem;
  margin: 0 0 15px 0;
  word-break: break-all; /* 允许在任意字符间换行 */
  overflow-wrap: break-word; /* 允许在单词内部换行 */
  word-wrap: break-word; /* 兼容旧浏览器 */
  line-height: 1.4;
  transition: color 0.3s ease;
  white-space: normal; /* 确保允许换行 */
  max-width: 100%; /* 确保不超过容器宽度 */
}

.detail-description {
  margin-bottom: 20px;
  padding: 15px;
  background: var(--bg-tertiary);
  border-radius: 8px;
  border-left: 4px solid var(--accent-color);
  transition: background-color 0.3s ease;
}

.description-title {
  color: var(--text-primary);
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 8px 0;
  transition: color 0.3s ease;
}

.description-content {
  color: var(--text-secondary);
  font-size: 0.95rem;
  line-height: 1.6;
  margin: 0;
  white-space: pre-wrap;
  transition: color 0.3s ease;
}

.detail-tags {
  margin-bottom: 20px;
  padding: 15px;
  background: var(--bg-tertiary);
  border-radius: 8px;
  border-left: 4px solid var(--accent-color);
  transition: background-color 0.3s ease;
}

.tags-title {
  color: var(--text-primary);
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 10px 0;
  transition: color 0.3s ease;
}

.tags-container {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}


.detail-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;
  padding: 20px;
  background: var(--bg-tertiary);
  border-radius: 8px;
  transition: background-color 0.3s ease;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.stat-label {
  color: var(--text-secondary);
  font-size: 0.9rem;
  font-weight: 500;
  transition: color 0.3s ease;
}

.stat-value {
  color: var(--text-primary);
  font-size: 1.1rem;
  font-weight: 600;
  transition: color 0.3s ease;
}

.detail-actions {
  display: flex;
  gap: 15px;
  flex-wrap: wrap;
}


.btn-stop-game {
  background: #ef4444;
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background 0.3s ease;
  flex: 1;
  justify-content: center;
}

.btn-stop-game:hover {
  background: #dc2626;
}


.btn-open-folder {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  padding: 12px 20px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.3s ease;
}

.btn-open-folder:hover {
  background: var(--bg-secondary);
}

.btn-open {
  background: var(--accent-color);
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background 0.3s ease;
  flex: 1;
  justify-content: center;
}

.btn-open:hover {
  background: var(--accent-hover);
}

/* 视频页：「随机抽帧设为封面」/「删除封面」
   必须自带样式 —— 之前配置里写的 btn-cover / btn-remove-cover 没有对应 CSS，
   两个按钮就退化成了浏览器默认外观（主人 2026-10-04 指出的「没有设置样式」）。 */
.btn-cover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  padding: 12px 20px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.3s ease;
}

.btn-cover:hover {
  background: var(--bg-secondary);
  border-color: var(--accent-color);
}

.btn-remove-cover {
  background: var(--bg-tertiary);
  color: #ef4444;
  border: 1px solid var(--border-color);
  padding: 12px 20px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.3s ease;
}

.btn-remove-cover:hover {
  background: rgba(239, 68, 68, 0.12);
  border-color: #ef4444;
}

/* 视频页：「重新关联到…」（文件改名/挪走后手动指认） */
.btn-relink {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  padding: 12px 20px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.3s ease;
}

.btn-relink:hover {
  background: var(--bg-secondary);
  border-color: var(--accent-color);
}

.btn-update-duration {
  background: #17a2b8;
  color: white;
  border: none;
  padding: 12px 20px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.3s ease;
}

.btn-update-duration:hover {
  background: #138496;
  transform: translateY(-1px);
}

.btn-visit {
  background: var(--accent-color);
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background 0.3s ease;
  flex: 1;
  justify-content: center;
}

.btn-visit:hover {
  background: var(--accent-hover);
}

.btn-refresh-favicon {
  background: #28a745;
  color: white;
  border: none;
  padding: 12px 20px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.3s ease;
}

.btn-refresh-favicon:hover {
  background: #218838;
  transform: translateY(-1px);
}

.btn-edit {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  padding: 12px 20px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.3s ease;
}

.btn-edit:hover {
  background: var(--bg-secondary);
}


.btn-remove {
  background: #fee2e2;
  color: #dc2626;
  border: 1px solid #fecaca;
  padding: 12px 20px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.3s ease;
}

.btn-remove:hover {
  background: #fecaca;
}

.btn-add-to-playlist {
  background: #28a745;
  color: white;
  border: none;
  padding: 12px 20px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.3s ease;
}

.btn-add-to-playlist:hover {
  background: #218838;
  transform: translateY(-1px);
}



.btn-icon {
  font-size: 1rem;
}

.detail-rating {
  width: 100%;
  padding: 15px;
  background: var(--bg-tertiary);
  border-radius: 8px;
  border-left: 4px solid var(--accent-color);
  transition: background-color 0.3s ease;
}

.rating-title {
  color: var(--text-primary);
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 12px 0;
  transition: color 0.3s ease;
}

.rating-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}


.comment-content {
  color: var(--text-secondary);
  font-size: 0.95rem;
  line-height: 1.6;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  transition: color 0.3s ease;
}

.extra-section {
  border-top: 1px solid var(--border-color);
  padding: 20px;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .detail-content {
    width: 95vw;
    margin: 20px;
  }
  
  .detail-body {
    flex-direction: column;
    gap: 20px;
  }
  
  .detail-left {
    width: 100%;
  }
  
  .detail-image {
    width: 100%;
    height: 250px;
  }
  
  .detail-stats {
    grid-template-columns: 1fr;
  }
  
  .detail-actions {
    flex-direction: column;
  }
}
</style>

