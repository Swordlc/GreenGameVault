import { FormField } from './FormField.ts'
/**
 * 资源字段类（泛型）
 * 用于定义资源属性的值、可保存性和编辑类型
 * 这个类统一管理字段的值、是否可保存以及编辑表单类型
 * 
 * @template T - 字段值的类型，例如 string、number、string[] 等
 * 
 * 使用示例：
 * ```typescript
 * // 字符串类型字段
 * const nameField = new ResourceField<string>({
 *   value: '',
 *   saveable: true,
 *   editType: new FormField_Text('名称', true)
 * })
 * 
 * // 数组类型字段
 * const tagsField = new ResourceField<string[]>({
 *   value: [],
 *   saveable: true,
 *   editType: new FormField_Tags('标签', false)
 * })
 * ```
 */
export class ResourceField<T = any> {
	
	value: T | undefined  // 字段的值（可能为 undefined）
	defaultValue?: T // 字段的默认值
	saveable: boolean // 是否可保存到文件
	editType: FormField | null // 编辑类型（表单字段）

	/**
	 * 构造函数
	 * @param params - 参数对象
	 * @param params.value - 字段的值（类型为 T）
	 * @param params.defaultValue - 字段的默认值（可选，类型为 T）
	 * @param params.saveable - 是否可保存到文件
	 * @param params.editType - 编辑类型（表单字段）
	 */
	constructor(params: {defaultValue?: T; saveable: boolean; editType?: FormField }) {
		this.defaultValue = params.defaultValue
		// 如果提供了 defaultValue，自动将其赋值给 value
		if (params.defaultValue !== undefined) {
			this.value = params.defaultValue
		} else {
			this.value = undefined
		}
		this.saveable = params.saveable ?? true
		this.editType = params.editType ?? null
	}
}