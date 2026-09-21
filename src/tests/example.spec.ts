/**
 * 示例单元测试 - 验证测试环境已正确搭建
 * 运行: npm run test
 */
import { describe, it, expect } from 'vitest'

describe('测试环境', () => {
  it('基本断言可用', () => {
    expect(1 + 1).toBe(2)
  })

  it('对象/数组匹配', () => {
    expect({ a: 1, b: 2 }).toEqual({ a: 1, b: 2 })
    expect([1, 2, 3]).toHaveLength(3)
  })
})
