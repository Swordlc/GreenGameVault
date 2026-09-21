/**
 * ScreenshotCover 单元测试
 *
 * 覆盖「使用最新截图作为封面」最容易出错的三件事：
 *  1. 挑「最新」必须按文件名内嵌的时间戳，而不是字典序；
 *  2. 写进库的路径必须是相对 SaveData 的（自带 SaveData 前缀会让封面永远显示不出来）；
 *  3. 批量扫描的文件夹归属：`game_1` 不能抢走 `game_1_2` 的文件夹。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./SaveManager.ts', () => ({
  default: {
    dataDirectory: 'SaveData',
    loadSettings: async () => ({ screenshotLocation: 'default' })
  }
}))

import {
  pickNewestScreenshot,
  toSaveDataRelativePath,
  resolveScreenshotBasePath,
  scanGamesMissingCover
} from './ScreenshotCover.ts'

/** 造一个假的 electronAPI：folders 为截图根目录下的文件夹名，images 为「文件夹 -> 文件全路径」 */
function installFakeElectronApi(folders: string[], images: Record<string, string[]>) {
  const api = {
    listFiles: vi.fn(async () => ({ success: true, files: folders })),
    listImageFiles: vi.fn(async (folderPath: string) => {
      const files = images[folderPath]
      if (!files) return { success: false, error: '目录不存在', files: [] }
      return { success: true, files }
    })
  }
  ;(window as any).electronAPI = api
  return api
}

describe('ScreenshotCover', () => {
  afterEach(() => {
    delete (window as any).electronAPI
    vi.restoreAllMocks()
  })

  describe('pickNewestScreenshot', () => {
    it('按内嵌时间戳挑最新，而不是按字典序', () => {
      const files = [
        'SaveData\\Game\\Screenshots\\x\\A_2026-01-05_10-00-00.png',
        'SaveData\\Game\\Screenshots\\x\\A_2026-09-21_20-04-52.png',
        'SaveData\\Game\\Screenshots\\x\\A_2026-03-11_09-30-00.png'
      ]
      expect(pickNewestScreenshot(files)).toBe(
        'SaveData\\Game\\Screenshots\\x\\A_2026-09-21_20-04-52.png'
      )
    })

    it('没有时间戳的文件视为最旧', () => {
      const files = ['SaveData\\Game\\Screenshots\\x\\无时间戳.png', 'SaveData\\Game\\Screenshots\\x\\B_2020-01-01_00-00-00.png']
      expect(pickNewestScreenshot(files)).toBe('SaveData\\Game\\Screenshots\\x\\B_2020-01-01_00-00-00.png')
    })

    it('单张图时返回它自己', () => {
      expect(pickNewestScreenshot(['a\\b.png'])).toBe('a\\b.png')
    })
  })

  describe('toSaveDataRelativePath', () => {
    it('剥掉 SaveData 前缀（反斜杠 / 正斜杠都行）', () => {
      expect(toSaveDataRelativePath('SaveData\\Game\\Screenshots\\x\\a.png')).toBe(
        'Game/Screenshots/x/a.png'
      )
      expect(toSaveDataRelativePath('SaveData/Game/Screenshots/x/a.png')).toBe(
        'Game/Screenshots/x/a.png'
      )
    })

    it('已有的相对路径保持不变', () => {
      expect(toSaveDataRelativePath('games/covers/a.png')).toBe('games/covers/a.png')
    })

    it('绝对路径原样保留', () => {
      expect(toSaveDataRelativePath('E:\\Games\\a\\shot.png')).toBe('E:/Games/a/shot.png')
    })

    it('不会把 SaveDataSaveData 变回来（幂等）', () => {
      const once = toSaveDataRelativePath('SaveData\\Game\\Screenshots\\x\\a.png')
      expect(toSaveDataRelativePath(once)).toBe(once)
    })
  })

  describe('resolveScreenshotBasePath', () => {
    it('screenshotLocation=default 时用 SaveData/Game/Screenshots', async () => {
      await expect(resolveScreenshotBasePath()).resolves.toBe('SaveData/Game/Screenshots')
    })
  })

  describe('scanGamesMissingCover', () => {
    it('分别归类「命中 / 无文件夹 / 文件夹里没图」', async () => {
      installFakeElectronApi(
        ['g1_游戏一', 'g3_游戏三'],
        {
          'SaveData/Game/Screenshots/g1_游戏一': [
            'SaveData\\Game\\Screenshots\\g1_游戏一\\p_2025-01-01_00-00-00.png',
            'SaveData\\Game\\Screenshots\\g1_游戏一\\p_2025-06-01_00-00-00.png'
          ],
          'SaveData/Game/Screenshots/g3_游戏三': []
        }
      )

      const result = await scanGamesMissingCover([
        { id: 'g1', name: '游戏一' },
        { id: 'g2', name: '游戏二' },
        { id: 'g3', name: '游戏三' }
      ])

      expect(result.targets).toHaveLength(1)
      expect(result.targets[0].id).toBe('g1')
      expect(result.targets[0].newestFile).toContain('2025-06-01')
      expect(result.skipped).toEqual([
        { id: 'g2', name: '游戏二', reason: 'no-folder' },
        { id: 'g3', name: '游戏三', reason: 'no-image' }
      ])
    })

    it('游戏 id 互为前缀时，文件夹归给「最长的那个 id」', async () => {
      installFakeElectronApi(['game_1_2_游戏二'], {
        'SaveData/Game/Screenshots/game_1_2_游戏二': [
          'SaveData\\Game\\Screenshots\\game_1_2_游戏二\\s_2026-02-02_02-02-02.png'
        ]
      })

      const result = await scanGamesMissingCover([
        { id: 'game_1', name: '游戏一' },
        { id: 'game_1_2', name: '游戏二' }
      ])

      expect(result.targets.map(t => t.id)).toEqual(['game_1_2'])
      expect(result.skipped).toEqual([{ id: 'game_1', name: '游戏一', reason: 'no-folder' }])
    })

    it('根目录不存在时全部归入 no-folder，不抛异常', async () => {
      const api = installFakeElectronApi([], {})
      api.listFiles.mockResolvedValueOnce({ success: false, error: '目录不存在', files: [] })

      const result = await scanGamesMissingCover([{ id: 'g1', name: '游戏一' }])
      expect(result.targets).toEqual([])
      expect(result.skipped).toEqual([{ id: 'g1', name: '游戏一', reason: 'no-folder' }])
    })

    it('没有 electronAPI 时抛错（由调用方提示用户）', async () => {
      delete (window as any).electronAPI
      await expect(scanGamesMissingCover([{ id: 'g1', name: '游戏一' }])).rejects.toThrow(
        '当前环境不支持文件列表接口'
      )
    })

    it('扫描不写库、不复制文件（只调用只读接口）', async () => {
      const api = installFakeElectronApi(['g1_x'], {
        'SaveData/Game/Screenshots/g1_x': ['SaveData\\Game\\Screenshots\\g1_x\\a_2026-01-01_00-00-00.png']
      })
      await scanGamesMissingCover([{ id: 'g1', name: 'x' }])
      expect(api.listFiles).toHaveBeenCalledTimes(1)
      expect(api.listImageFiles).toHaveBeenCalledTimes(1)
    })
  })
})
