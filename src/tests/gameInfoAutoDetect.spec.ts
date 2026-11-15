/**
 * 游戏入库时「游戏名 / 开发商」自动识别（`src/utils/gameInfoAutoDetect.ts`）
 *
 * 口径来自主人 2026-11-07 原话：
 *   - 开发商 = 文件上层目录名里 `[] {} () 【】（）「」` 括号内的内容；
 *   - 游戏名 = 同一个目录名去掉这些括号及内容后剩下的部分。
 *
 * 这里把"正常路径 / 容器目录 / 全括号目录 / 无上层目录"四种边界都钉住。
 */
import { describe, it, expect } from 'vitest'
import {
  detectGameInfoFromPath,
  resolveParentFolderName,
  extractBracketContents,
  stripBracketContents,
  gameNameFromFileName
} from '../utils/gameInfoAutoDetect'

describe('extractBracketContents：括号内的开发商', () => {
  it('六种括号都能识别', () => {
    expect(extractBracketContents('[A] {B} (C) 【D】（E）「F」')).toEqual([
      'A', 'B', 'C', 'D', 'E', 'F'
    ])
  })

  it('去空白、去空括号、去重（大小写不敏感）', () => {
    expect(extractBracketContents('  [  Studio  ] [] 【】 [STUDIO] 「 」 ')).toEqual(['Studio'])
  })

  it('没有括号时返回空数组', () => {
    expect(extractBracketContents('普通游戏名')).toEqual([])
  })
})

describe('stripBracketContents：去掉括号后的游戏名', () => {
  it('去掉括号及内容，收拾多余空格和首尾分隔符', () => {
    expect(stripBracketContents('[Dev] 游戏名 【v1.0】')).toBe('游戏名')
    expect(stripBracketContents(' - [Dev] 游戏名 - 【v1.0】 ')).toBe('游戏名')
  })

  it('只剩括号时返回空串（交给调用方回退文件名）', () => {
    expect(stripBracketContents('[Dev]【v1.0】')).toBe('')
  })
})

describe('resolveParentFolderName：跳过容器目录', () => {
  it('普通游戏目录直接取上层目录名', () => {
    expect(resolveParentFolderName('D:\\Games\\Foo\\game.exe')).toBe('Foo')
  })

  it('文件躺在 Games 根下时继续往上找（不会把 Games 当游戏名）', () => {
    expect(resolveParentFolderName('D:\\Games\\game.exe')).toBe('')
  })

  it('exe 在 bin / win64 子目录里时取真正的游戏目录', () => {
    expect(resolveParentFolderName('D:\\Games\\Foo\\bin\\win64\\game.exe')).toBe('Foo')
  })

  it('盘符不是目录名', () => {
    expect(resolveParentFolderName('D:\\game.exe')).toBe('')
  })
})

describe('gameNameFromFileName：文件名兜底', () => {
  it('去扩展名、清理 game- 前缀与分隔符', () => {
    expect(gameNameFromFileName('game-Cool_Game.exe')).toBe('Cool Game')
  })

  it('空文件名返回空串（调用方自己决定怎么显示）', () => {
    expect(gameNameFromFileName('')).toBe('')
  })
})

describe('detectGameInfoFromPath：组合口径', () => {
  it('主人点名的场景：[开发商] 游戏名', () => {
    expect(detectGameInfoFromPath('D:\\Games\\[Studio] 我的游戏\\game.exe')).toEqual({
      name: '我的游戏',
      developers: ['Studio'],
      folderName: '[Studio] 我的游戏'
    })
  })

  it('多个括号：括号内容都算开发商，游戏名只剩正文', () => {
    const result = detectGameInfoFromPath('E:\\Galgame\\【A】游戏名「B」\\start.exe')
    expect(result.name).toBe('游戏名')
    expect(result.developers).toEqual(['A', 'B'])
  })

  it('目录名没有括号：游戏名就是目录名，开发商为空（不瞎猜）', () => {
    expect(detectGameInfoFromPath('D:\\Games\\Cool Game\\CoolGame.exe')).toEqual({
      name: 'Cool Game',
      developers: [],
      folderName: 'Cool Game'
    })
  })

  it('整个目录名都是括号：游戏名回退文件名，开发商照收', () => {
    const result = detectGameInfoFromPath('D:\\Games\\[Studio]\\game.exe')
    expect(result.name).toBe('Game')
    expect(result.developers).toEqual(['Studio'])
  })

  it('没有有效上层目录：回退文件名，开发商为空', () => {
    expect(detectGameInfoFromPath('D:\\Games\\game.exe')).toEqual({
      name: 'Game',
      developers: [],
      folderName: ''
    })
  })
})
