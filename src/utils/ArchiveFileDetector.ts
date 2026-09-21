/**
 * 压缩包文件识别工具
 *
 * 说明：本项目已裁剪掉「解压/压缩」动作（原压缩/解压 composable 已删除），
 * 这里只保留「识别某个文件是不是压缩包」的能力 —— 游戏模块仍用它来决定
 * 压缩包角标、右键菜单项条件（notArchive）等。
 */

/**
 * 压缩包文件扩展名列表
 */
const ARCHIVE_EXTENSIONS = ['.zip', '.rar', '.7z', '.tar', '.gz', '.tar.gz', '.bz2', '.tar.bz2', '.xz', '.tar.xz']

/**
 * 检查文件是否为压缩包
 * @param filePath - 文件路径或文件名
 * @returns 是否为压缩包
 */
export function isArchiveFile(filePath: string | null | undefined): boolean {
  if (!filePath) {
    return false
  }

  if (typeof filePath !== 'string') {
    return false
  }

  const fileName = filePath.toLowerCase()
  return ARCHIVE_EXTENSIONS.some(ext => fileName.endsWith(ext))
}
