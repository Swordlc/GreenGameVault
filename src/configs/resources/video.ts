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
 *   - 不计时：只统计**打开次数**（watchCount）与最后打开时间（从 visitedSessions 派生）。
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
	 * 上一次观测到的文件访问时间（毫秒）。
	 * 用于「外部播放器打开 → atime 变化」的兜底统计去重：只有 atime 明显新于这个值才 +1。
	 */
	lastAccessSeenMs: ResourceField<number> = new ResourceField<number>({
		saveable: true,
		defaultValue: 0
	})

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

	/** 最后一次打开时间（从 visitedSessions 派生，与 Game.lastPlayed 同款） */
	get lastOpened(): string | null {
		const arr = this.visitedSessions.value
		return Array.isArray(arr) && arr.length > 0 ? arr[arr.length - 1] : null
	}

	/** 首次打开时间 */
	get firstOpened(): string | null {
		const arr = this.visitedSessions.value
		return Array.isArray(arr) && arr.length > 0 ? arr[0] : null
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
				field: 'watchCount',
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
				field: 'watchCount',
				label: '打开次数',
				formatter: undefined,
				defaultValue: '0 次'
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
