import {
	FormField_Text,
	FormField_Textarea,
	FormField_Tags,
	FormField as FormFieldType
} from './base/FormField.ts'
import { BaseResources } from './base/ResourcesDataBase.ts'
import { ResourceField } from './base/ResourceField.ts'

/**
 * 视频类
 *
 * 与 Game 的根本区别（「只读的标签管理」）：
 *   - 资源**不是**手动添加的，而是由「绑定文件夹」递归扫描得到；
 *     所以这里没有「添加/删除/编辑路径」的语义，resourcePath 等字段不允许在编辑对话框里改。
 *   - 不计时：App 内只统计**打开次数**（watchCount）与最后打开时间（从 visitedSessions 派生）。
 *     用 **PotPlayer** 播放的实测统计（播放次数 / 累计播放时长 / 打开时间）另记在
 *     `potPlayerStats` 字段里，由主进程的 PotStats 挂载写入
 *     （electron/services/potstats-bridge.js，走 PotPlayer 官方 IPC），**绝不动 watchCount**。
 *   - 封面只有一个来源：随机抽 1 帧（覆盖式写入，固定文件名，永不膨胀）。
 *
 * 字段命名口径：游戏页叫「开发商」，视频页一律叫「作者」（author）。
 */
export class Video extends BaseResources {

	// 拖拽文件时自动匹配的资源类型（视频页本身只读，这里主要给拖拽兜底识别用）
	static acceptedExtensions = [
		'.mp4', '.mkv', '.avi', '.wmv', '.mov', '.flv', '.webm', '.m4v',
		'.mpg', '.mpeg', '.ts', '.m2ts', '.mts', '.rmvb', '.rm', '.3gp',
		'.vob', '.ogv', '.ogm', '.asf', '.f4v', '.divx'
	]

	resourceType: ResourceField<string> = new ResourceField<string>({
		saveable: true,
		defaultValue: 'video'
	})

	name: ResourceField<string> = new ResourceField<string>({
		saveable: true,
		editType: new FormField_Text('视频名', true)
	})

	/** 作者（原「开发商」；视频语境下可填作者 / 社团 / 片商 / 演员，支持多个） */
	author: ResourceField<string[]> = new ResourceField<string[]>({
		saveable: true,
		editType: new FormField_Tags('作者', false)
	})

	tags: ResourceField<string[]> = new ResourceField<string[]>({
		saveable: true,
		editType: new FormField_Tags('标签', false)
	})

	description: ResourceField<string> = new ResourceField<string>({
		saveable: true,
		editType: new FormField_Textarea('简介', false)
	})

	/** 视频文件的绝对路径（由扫描写入，不在编辑对话框出现） */
	resourcePath: ResourceField<string> = new ResourceField<string>({
		saveable: true
	})

	/** 相对所属绑定根目录的路径，形如 "合集A/第01话.mp4"（层级浏览的依据） */
	relPath: ResourceField<string> = new ResourceField<string>({
		saveable: true,
		defaultValue: ''
	})

	/** 所属绑定根目录（绝对路径） */
	rootPath: ResourceField<string> = new ResourceField<string>({
		saveable: true,
		defaultValue: ''
	})

	/** 文件名（含扩展名） */
	fileName: ResourceField<string> = new ResourceField<string>({
		saveable: true,
		defaultValue: ''
	})

	/** 文件大小（字节） */
	fileSize: ResourceField<number> = new ResourceField<number>({
		saveable: true,
		defaultValue: 0
	})

	/** 视频时长（秒）。抽帧时顺带由 ffprobe 写回；未知为 0 */
	durationSec: ResourceField<number> = new ResourceField<number>({
		saveable: true,
		defaultValue: 0
	})

	/** 打开次数 */
	watchCount: ResourceField<number> = new ResourceField<number>({
		saveable: true,
		defaultValue: 0
	})

	/** 每次打开的 ISO 时间数组（升序）；lastOpened 由它派生 */
	visitedSessions: ResourceField<string[]> = new ResourceField<string[]>({
		saveable: true,
		defaultValue: []
	})

	/**
	 * 最后一次**确认**打开这个视频的时刻（毫秒）。
	 *
	 * ⚠️ 它不直接显示；显示用的时间来自 `visitedSessions`（主进程命中时会往里追加一条）。
	 * 写入方是主进程的 PotStats 挂载（electron/services/potstats-bridge.js）——
	 * 取的是 PotPlayer 官方 IPC 报的**真实打开时刻**，不再是「文件 atime 被谁读过」的猜测。
	 */
	lastAccessSeenMs: ResourceField<number> = new ResourceField<number>({
		saveable: true,
		defaultValue: 0
	})

	/**
	 * 用 **PotPlayer** 播放这个视频的实测统计（由主进程 PotStats 挂载写入）。
	 *
	 * 🔴 与 `watchCount` 是**两个不同指标**，别混：
	 *   - `watchCount`        = **App 内点开次数**（`useVideoLibrary.bumpOpenCount`）；
	 *   - `potPlayerStats.playCount` = **用 PotPlayer 播放且满 10 秒的次数**。
	 *
	 * 数据来源是 PotPlayer 官方 IPC（`InternalSimpleCmd.h`）：`PLAY_STATUS == 2` 才算在看，
	 * 所以 `totalSeconds` 是**暂停一秒都不算**的真实播放时长。
	 * 外部播放**只写本字段与时间戳两件套，绝不碰 `watchCount`**。
	 *
	 * 形状：`{ playCount, totalSeconds, firstOpenMs, lastOpenMs, lastPositionMs, durationMs, updatedAt }`
	 */
	potPlayerStats: ResourceField<any> = new ResourceField<any>({
		saveable: true,
		defaultValue: null
	})

	/** PotPlayer 播放次数（0 = 还没统计到） */
	get potPlayerPlayCount(): number {
		const stats = this.potPlayerStats.value
		return stats && typeof stats === 'object' ? (Number(stats.playCount) || 0) : 0
	}

	/** PotPlayer 累计播放时长（秒，暂停不计） */
	get potPlayerTotalSeconds(): number {
		const stats = this.potPlayerStats.value
		return stats && typeof stats === 'object' ? (Number(stats.totalSeconds) || 0) : 0
	}

	/** 封面（相对 SaveData 的路径，如 videos/covers/<id>.jpg） */
	coverPath: ResourceField<string> = new ResourceField<string>({
		saveable: true,
		defaultValue: ''
	})

	/** 最近一次抽帧的时间点（秒），用于「重刷」时避开同一位置 */
	lastFrameTime: ResourceField<number> = new ResourceField<number>({
		saveable: true,
		defaultValue: 0
	})

	/** 视频搜索/匹配用的字段（与 GenericResourceView 的 searchFields 共用一份） */
	static searchFields = ['name', 'fileName', 'relPath', 'author', 'tags', 'description']

	/**
	 * 封面版本号（毫秒时间戳），每次抽帧/删封面都 +1 次新值。
	 *
	 * 为什么需要：封面是**固定文件名**覆盖写的（`videos/covers/<id>.jpg`），
	 * 重刷后路径一模一样，渲染层的图片缓存就会一直拿旧图 ——
	 * 主人 2026-10-04 报的「重刷无效、删除后重刷还是第一张图」就是这个原因。
	 * 卡片/详情页监听这个字段，一变就丢掉那张图的缓存重新读。
	 */
	coverUpdatedAt: ResourceField<number> = new ResourceField<number>({
		saveable: true,
		defaultValue: 0
	})

	/**
	 * 最后一次打开时间 —— **只认 ini 同步过来的 `potPlayerStats`**。
	 *
	 * 🔴 2026-10-05 主人要求「全局计算口径直接读 ini，以 ini 为唯一事实来源」：
	 * 没有 ini 的视频一律显示「从未观看」。所以这里**不再看 `visitedSessions`** ——
	 * 那个字段里还留着早期 atime 巡检写进去的时间戳，会让"没有 ini 却显示 5 分钟前"
	 * 这种自相矛盾的东西冒出来（主人验收时就是这么发现的）。
	 */
	get lastOpened(): string | null {
		const stats = this.potPlayerStats.value
		const ms = stats && typeof stats === 'object' ? Number(stats.lastOpenMs) || 0 : 0
		return ms > 0 ? new Date(ms).toISOString() : null
	}

	/** 首次打开时间（同样只认 ini） */
	get firstOpened(): string | null {
		const stats = this.potPlayerStats.value
		const ms = stats && typeof stats === 'object'
			? (Number(stats.firstOpenMs) || Number(stats.lastOpenMs) || 0)
			: 0
		return ms > 0 ? new Date(ms).toISOString() : null
	}

	/** 所在子目录（相对根目录），根下文件返回 ''；层级浏览用 */
	get folderPath(): string {
		const rel = this.relPath.value || ''
		const index = rel.lastIndexOf('/')
		return index > 0 ? rel.slice(0, index) : ''
	}

	getSaveData(): any {
		const idValue = this.id.value || this.generateId()
		return {
			id: idValue,
			resourceType: this.resourceType.value || 'video',
			name: this.name.value || '',
			author: Array.isArray(this.author.value) ? [...this.author.value] : [],
			tags: Array.isArray(this.tags.value) ? [...this.tags.value] : [],
			description: this.description.value || '',
			resourcePath: this.resourcePath.value || '',
			relPath: this.relPath.value || '',
			rootPath: this.rootPath.value || '',
			fileName: this.fileName.value || '',
			fileSize: this.fileSize.value || 0,
			durationSec: this.durationSec.value || 0,
			watchCount: this.watchCount.value || 0,
			visitedSessions: Array.isArray(this.visitedSessions.value) ? [...this.visitedSessions.value] : [],
			lastAccessSeenMs: this.lastAccessSeenMs.value || 0,
			potPlayerStats: this.potPlayerStats.value || null,
			coverPath: this.coverPath.value || '',
			lastFrameTime: this.lastFrameTime.value || 0,
			coverUpdatedAt: this.coverUpdatedAt.value || 0,
			addedDate: this.addedDate.value || '',
			rating: this.rating.value || 0,
			comment: this.comment.value || '',
			isFavorite: this.isFavorite.value || false
		}
	}

	static editDialogConfig = {
		addTitle: '添加视频',
		editTitle: '编辑视频信息'
	}

	/** 右键菜单（打开 / 打开所在文件夹 / 抽帧封面 / 删除封面 / 重新关联 / 编辑 / 详情） */
	static contextMenuItems = [
		{ key: 'detail', icon: '👁️', label: '查看详情' },
		{ key: 'open', icon: '▶️', label: '播放视频' },
		{ key: 'reveal', icon: '📁', label: '打开所在文件夹' },
		{ key: 'grab-cover', icon: '🎬', label: '随机抽帧设为封面' },
		{ key: 'remove-cover', icon: '🧹', label: '删除封面' },
		{ key: 'relink', icon: '🔗', label: '重新关联到…' },
		{ key: 'edit', icon: '✏️', label: '编辑信息' }
	]

	/** 卡片上的主操作按钮：播放 */
	static actionConfig = {
		key: 'open',
		icon: '▶️',
		label: '播放视频',
		handlerName: 'openVideo'
	}

	static getDisplayTexts() {
		return {
			neverAccessed: '从未观看',
			justAccessed: '刚刚',
			accessAction: '观看',
			yesterdayAccessed: '昨天'
		}
	}

	static getDefaultIcon() {
		return './default-video.png'
	}

	static cardDisplayConfig = {
		title: 'name',
		subtitle: 'author',      // 作者（原「开发商」的位置）
		extra: 'relPath',        // 相对路径，直接告诉用户文件在哪一层
		tags: 'tags',
		maxTags: 6,
		showExeIcon: false,
		badge: {
			field: 'fileSize',
			formatter: 'formatFolderSize'
		},
		stats: [
			{
				type: 'text' as const,
				// 🔴 只认 ini 同步过来的 potPlayerStats（没有 ini = 没看过 = 未观看），
				// 不能用 watchCount：那是"App 内点开次数"，会出现"有次数、没时间"的矛盾组合。
				field: 'potPlayerPlayCount',
				label: '观看:',
				formatter: 'formatWatchCount'
			},
			{
				type: 'text' as const,
				field: 'lastOpened',
				label: '',
				formatter: 'formatLastOpened'
			}
		]
	}

	static detailPanelConfig = {
		// DetailPanel 的 type 校验白名单里已包含 'video'
		type: 'video',
		defaultImage: './default-video.png',
		title: {
			field: 'name',
			formatter: undefined
		},
		// 客观信息区（原「开发商 / 发行商 / 引擎 / 游戏路径」→ 视频语境）
		objectiveInfo: [
			{
				field: 'author',
				label: '作者',
				formatter: undefined,
				arrayJoin: '、',
				collapsible: true,
				collapsedLimit: 5
			},
			{
				field: 'relPath',
				label: '相对路径',
				formatter: undefined
			},
			{
				field: 'resourcePath',
				label: '文件路径',
				formatter: undefined
			}
		],
		// 数据记录区（去掉了游戏时长，只留打开次数与时间）
		dataRecords: [
			{
				field: 'potPlayerPlayCount',
				label: 'PotPlayer 播放次数',
				formatter: 'formatWatchCount',
				defaultValue: '从未观看'
			},
			{
				field: 'lastOpened',
				label: '最后打开',
				formatter: 'formatLastOpened',
				defaultValue: '从未观看'
			},
			{
				field: 'firstOpened',
				label: '第一次打开',
				formatter: 'formatFirstOpened',
				defaultValue: '从未观看'
			},
			{
				field: 'durationSec',
				label: '视频时长',
				formatter: 'formatVideoLength',
				defaultValue: '未知'
			},
			{
				field: 'fileSize',
				label: '文件大小',
				formatter: 'formatFolderSize',
				defaultValue: '未知'
			},
			{
				field: 'addedDate',
				label: '入库时间',
				formatter: 'formatDate',
				defaultValue: '未知'
			}
		],
		// 详情面板按钮：播放 / 抽帧封面 / 打开文件夹 / 编辑
		actions: [
			{
				key: 'open',
				icon: '▶️',
				label: '播放视频',
				class: 'btn-play'
			},
			{
				key: 'grab-cover',
				icon: '🎬',
				label: '随机抽帧设为封面',
				class: 'btn-cover'
			},
			{
				key: 'remove-cover',
				icon: '🧹',
				label: '删除封面',
				class: 'btn-remove-cover'
			},
			{
				key: 'relink',
				icon: '🔗',
				label: '重新关联到…',
				class: 'btn-relink'
			},
			{
				key: 'reveal',
				icon: '📁',
				label: '打开所在文件夹',
				class: 'btn-open-folder'
			},
			{
				key: 'edit',
				icon: '✏️',
				label: '编辑信息',
				class: 'btn-edit'
			}
		],
		// 视频没有截图相册，预览区留空
		previewArea: null
	}
}
