/**
 * @module SystemHandlers
 * @description 管理应用程序的系统信息和外部操作相关的 IPC 处理器。
 *
 * 主要功能:
 * 1. 获取应用版本信息。
 * 2. 获取系统信息（平台、架构、版本等）。
 * 3. 获取磁盘信息（Windows 平台）。
 * 4. 显示系统通知。
 * 5. 打开外部链接或文件。
 * 6. 注册与系统信息相关的 IPC 处理器。
 *
 * 导出的函数:
 * - `registerIpcHandlers(ipcMain, app, windowsUtils, shell, getMainWindow)`: 注册 IPC 处理器。
 *
 * IPC 处理器:
 * - `get-app-version`: 获取应用版本。
 * - `get-system-info`: 获取系统信息。
 * - `get-disk-info`: 获取所有物理磁盘信息（Windows）。
 * - `get-disk-type-by-path`: 根据文件路径获取磁盘类型（Windows）。
 * - `show-notification`: 显示系统通知。
 * - `open-external`: 打开外部链接或文件。
 */

const { spawn } = require('child_process')
const { Notification } = require('electron')
const path = require('path')
const fs = require('fs')

/**
 * 注册与系统信息相关的 IPC 处理器。
 * @param {Object} ipcMain - Electron 的 ipcMain 对象。
 * @param {Object} app - Electron 的 app 对象。
 * @param {Object} windowsUtils - windows-utils 模块。
 * @param {Object} shell - Electron 的 shell 对象。
 * @param {Function} getMainWindow - 获取主窗口的函数。
 */
function registerIpcHandlers(ipcMain, app, windowsUtils, shell, getMainWindow) {
  // 获取应用版本
  ipcMain.handle('get-app-version', () => {
    return app.getVersion()
  })

  // 获取系统信息
  ipcMain.handle('get-system-info', () => {
    return {
      platform: process.platform,
      arch: process.arch,
      version: process.version,
      electronVersion: process.versions.electron
    }
  })

  // 列出逻辑磁盘（盘符）
  ipcMain.handle('list-logical-drives', async () => {
    try {
      if (process.platform !== 'win32') {
        return { success: false, error: '此功能仅在 Windows 系统上可用' }
      }
      return new Promise((resolve) => {
        const powershell = spawn('powershell', [
          '-Command',
          'Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Root | ConvertTo-Json -Depth 10'
        ])
        let output = ''
        let errorOutput = ''
        powershell.stdout.on('data', (data) => { output += data.toString() })
        powershell.stderr.on('data', (data) => { errorOutput += data.toString() })
        powershell.on('close', (code) => {
          if (code !== 0) {
            resolve({ success: false, error: errorOutput || '获取逻辑磁盘失败' })
            return
          }
          try {
            const roots = JSON.parse(output.trim())
            const arr = Array.isArray(roots) ? roots : [roots]
            const drives = arr
              .map(r => (typeof r === 'string' ? r : '').trim())
              .filter(r => /^[A-Za-z]:\\$/.test(r))
              .map(r => r.replace(/\\$/,'').toUpperCase())
            resolve({ success: true, drives })
          } catch (e) {
            resolve({ success: false, error: '解析逻辑磁盘失败: ' + e.message })
          }
        })
      })
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 获取所有物理磁盘信息（包括类型：SSD/HDD）
  ipcMain.handle('get-disk-info', async () => {
    try {
      if (process.platform !== 'win32') {
        return { success: false, error: '此功能仅在 Windows 系统上可用' }
      }

      return new Promise((resolve) => {
        // 使用 PowerShell 命令获取磁盘信息
        const powershell = spawn('powershell', [
          '-Command',
          'Get-PhysicalDisk | Select-Object DeviceID, FriendlyName, MediaType, Size, BusType | ConvertTo-Json -Depth 10'
        ])

        let output = ''
        let errorOutput = ''

        powershell.stdout.on('data', (data) => {
          output += data.toString()
        })

        powershell.stderr.on('data', (data) => {
          errorOutput += data.toString()
        })

        powershell.on('close', (code) => {
          if (code !== 0) {
            console.error('获取磁盘信息失败:', errorOutput)
            resolve({ success: false, error: errorOutput || '获取磁盘信息失败' })
            return
          }

          try {
            // 解析 PowerShell 输出的 JSON
            const disks = JSON.parse(output.trim())
            // 如果是单个对象，转换为数组
            const diskArray = Array.isArray(disks) ? disks : [disks]

            // 格式化磁盘信息
            const formattedDisks = diskArray.map(disk => ({
              deviceId: disk.DeviceID,
              friendlyName: disk.FriendlyName || '未知磁盘',
              mediaType: disk.MediaType || 'Unknown', // SSD, HDD, 或其他
              size: disk.Size || 0,
              busType: disk.BusType || 'Unknown',
              sizeGB: disk.Size ? Math.round(disk.Size / (1024 * 1024 * 1024)) : 0
            }))

            resolve({ success: true, disks: formattedDisks })
          } catch (parseError) {
            console.error('解析磁盘信息失败:', parseError, '原始输出:', output)
            resolve({ success: false, error: '解析磁盘信息失败: ' + parseError.message })
          }
        })
      })
    } catch (error) {
      console.error('获取磁盘信息异常:', error)
      return { success: false, error: error.message }
    }
  })

  // 获取所有逻辑磁盘的完整信息（包括盘符、容量、使用情况、磁盘类型）
  ipcMain.handle('get-logical-drives-info', async () => {
    try {
      if (process.platform !== 'win32') {
        return { success: false, error: '此功能仅在 Windows 系统上可用' }
      }

      return new Promise((resolve) => {
        const psCommand = `
$results = @()
$drives = Get-PSDrive -PSProvider FileSystem
foreach ($drive in $drives) {
    $driveLetter = $drive.Root.TrimEnd('\\')
    if (-not $driveLetter) { continue }
    
    $usedBytes = $drive.Used
    $freeBytes = $drive.Free
    $totalBytes = if ($usedBytes -and $freeBytes) { $usedBytes + $freeBytes } else { 0 }
    
    $mediaType = 'Unknown'
    $friendlyName = '未知磁盘'
    $busType = 'Unknown'
    $deviceId = $null
    
    try {
        $partition = Get-Partition -DriveLetter $driveLetter[0] -ErrorAction SilentlyContinue
        if ($partition) {
            $disk = Get-Disk -Number $partition.DiskNumber -ErrorAction SilentlyContinue
            if ($disk) {
                $physicalDisk = Get-PhysicalDisk -DeviceId $disk.Number -ErrorAction SilentlyContinue
                if ($physicalDisk) {
                    $mediaType = $physicalDisk.MediaType
                    $friendlyName = $physicalDisk.FriendlyName
                    $busType = $physicalDisk.BusType
                    $deviceId = $physicalDisk.DeviceID
                }
            }
        }
    } catch {
        # 忽略错误，继续使用默认值
    }
    
    $results += @{
        driveLetter = $driveLetter
        usedBytes = if ($usedBytes) { $usedBytes } else { 0 }
        freeBytes = if ($freeBytes) { $freeBytes } else { 0 }
        totalBytes = $totalBytes
        mediaType = $mediaType
        friendlyName = $friendlyName
        busType = $busType
        deviceId = $deviceId
    }
}
$results | ConvertTo-Json -Depth 10
`
        const powershell = spawn('powershell', [
          '-Command',
          psCommand
        ])

        let output = ''
        let errorOutput = ''

        powershell.stdout.on('data', (data) => {
          output += data.toString()
        })

        powershell.stderr.on('data', (data) => {
          errorOutput += data.toString()
        })

        powershell.on('close', (code) => {
          if (code !== 0) {
            console.error('获取逻辑磁盘信息失败:', errorOutput)
            resolve({ success: false, error: errorOutput || '获取逻辑磁盘信息失败' })
            return
          }

          try {
            const drives = JSON.parse(output.trim())
            const driveArray = Array.isArray(drives) ? drives : [drives]

            const formattedDrives = driveArray.map(drive => ({
              driveLetter: drive.driveLetter || 'Unknown',
              usedBytes: drive.usedBytes || 0,
              freeBytes: drive.freeBytes || 0,
              totalBytes: drive.totalBytes || 0,
              usedGB: drive.usedBytes ? Math.round(drive.usedBytes / (1024 * 1024 * 1024)) : 0,
              freeGB: drive.freeBytes ? Math.round(drive.freeBytes / (1024 * 1024 * 1024)) : 0,
              totalGB: drive.totalBytes ? Math.round(drive.totalBytes / (1024 * 1024 * 1024)) : 0,
              usagePercent: drive.totalBytes > 0 ? Math.round((drive.usedBytes / drive.totalBytes) * 100) : 0,
              mediaType: drive.mediaType || 'Unknown',
              friendlyName: drive.friendlyName || '未知磁盘',
              busType: drive.busType || 'Unknown',
              deviceId: drive.deviceId
            }))

            resolve({ success: true, drives: formattedDrives })
          } catch (parseError) {
            console.error('解析逻辑磁盘信息失败:', parseError, '原始输出:', output)
            resolve({ success: false, error: '解析逻辑磁盘信息失败: ' + parseError.message })
          }
        })
      })
    } catch (error) {
      console.error('获取逻辑磁盘信息异常:', error)
      return { success: false, error: error.message }
    }
  })

  // 根据文件路径获取所在磁盘的类型（SSD/HDD）
  ipcMain.handle('get-disk-type-by-path', async (event, filePath) => {
    try {
      return await windowsUtils.getDiskType(filePath)
    } catch (error) {
      console.error('获取磁盘类型失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 显示系统通知
  ipcMain.handle('show-notification', (event, title, body) => {
    try {
      if (Notification.isSupported()) {
        const mainWindow = getMainWindow()
        const iconPath = path.join(__dirname, '../../butter-icon.ico')
        
        const notification = new Notification({
          title: title,
          body: body,
          icon: iconPath,
          silent: false
        })

        notification.show()

        // 可选：点击通知时的处理
        notification.on('click', () => {
          console.log('通知被点击')
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show()
            mainWindow.focus()
          }
        })

        console.log('系统通知已显示:', title, body)
      } else {
        console.log('系统不支持通知:', title, body)
      }
    } catch (error) {
      console.error('显示通知失败:', error)
      console.log('通知内容:', title, body)
    }
  })

  // 打开外部链接或文件（使用系统默认程序）
  ipcMain.handle('open-external', async (event, urlOrPath) => {
    try {
      console.log('=== Electron: 开始打开外部链接/文件 ===')
      console.log('URL/路径:', urlOrPath)

      if (!urlOrPath) {
        console.log('❌ URL/路径为空')
        return { success: false, error: '无效的URL或路径' }
      }

      // 检查是否是URL（以http://或https://开头）
      if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
        console.log('✅ 检测到URL，正在调用 shell.openExternal...')
        await shell.openExternal(urlOrPath)
        console.log('✅ URL打开成功')
        return { success: true }
      }

      // 对于本地文件路径，检查文件是否存在
      const fs = require('fs')
      if (!fs.existsSync(urlOrPath)) {
        console.log('❌ 文件不存在:', urlOrPath)
        return { success: false, error: '文件不存在' }
      }

      console.log('✅ 文件存在，正在调用 shell.openPath...')
      const result = await shell.openPath(urlOrPath)
      console.log('shell.openPath 返回结果:', result)

      if (result) {
        // openPath 返回非空字符串表示错误信息
        console.log('❌ 打开文件失败，错误信息:', result)
        return { success: false, error: result }
      }

      console.log('✅ 文件打开成功')
      return { success: true }
    } catch (error) {
      console.error('❌ 打开外部文件失败:', error)
      console.error('错误堆栈:', error.stack)
      return { success: false, error: error.message }
    }
  })

  // 获取文件图标（主要用于 exe 文件）
  ipcMain.handle('get-file-icon', async (event, filePath, size = 32) => {
    try {
      if (process.platform !== 'win32') {
        return { success: false, error: '此功能仅在 Windows 系统上可用' }
      }

      const { nativeImage } = require('electron')
      const fs = require('fs')

      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        return { success: false, error: '文件不存在' }
      }

      // 检查是否为 exe 文件
      const ext = path.extname(filePath).toLowerCase()
      if (ext !== '.exe' && ext !== '.lnk') {
        return { success: false, error: '仅支持 .exe 和 .lnk 文件' }
      }

      // 使用 Electron 的 app.getFileIcon 方法（如果可用）
      if (app.getFileIcon) {
        try {
          const icon = await app.getFileIcon(filePath, { size: size === 16 ? 'small' : 'normal' })
          if (icon && !icon.isEmpty()) {
            // 转换为 base64 data URL
            const pngBuffer = icon.toPNG()
            const base64 = pngBuffer.toString('base64')
            const dataUrl = `data:image/png;base64,${base64}`
            return { success: true, icon: dataUrl }
          }
        } catch (iconError) {
          console.warn('使用 app.getFileIcon 失败，尝试备用方法:', iconError.message)
        }
      }

      // 备用方法：使用 PowerShell 提取图标
      return new Promise((resolve) => {
        // 转义 PowerShell 字符串中的特殊字符
        const escapedPath = filePath.replace(/'/g, "''").replace(/\$/g, '`$')
        
        const powershell = spawn('powershell', [
          '-Command',
          `
          try {
            Add-Type -AssemblyName System.Drawing
            $icon = [System.Drawing.Icon]::ExtractAssociatedIcon('${escapedPath}')
            if ($icon) {
              $bitmap = $icon.ToBitmap()
              $ms = New-Object System.IO.MemoryStream
              $bitmap.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
              $bytes = $ms.ToArray()
              $base64 = [Convert]::ToBase64String($bytes)
              Write-Output $base64
              $icon.Dispose()
              $bitmap.Dispose()
              $ms.Dispose()
            } else {
              Write-Output "ERROR: 无法提取图标"
            }
          } catch {
            Write-Output "ERROR: $($_.Exception.Message)"
          }
          `
        ])
        
        // 设置超时（5秒）
        const timeout = setTimeout(() => {
          if (powershell && !powershell.killed) {
            powershell.kill()
          }
          resolve({ success: false, error: '提取图标超时' })
        }, 5000)

        let output = ''
        let errorOutput = ''

        powershell.stdout.on('data', (data) => {
          output += data.toString()
        })

        powershell.stderr.on('data', (data) => {
          errorOutput += data.toString()
        })

        powershell.on('close', (code) => {
          clearTimeout(timeout)
          if (code !== 0 || errorOutput) {
            console.error('提取图标失败:', errorOutput)
            resolve({ success: false, error: errorOutput || '提取图标失败' })
            return
          }

          const base64 = output.trim()
          if (base64 && !base64.startsWith('ERROR:')) {
            const dataUrl = `data:image/png;base64,${base64}`
            resolve({ success: true, icon: dataUrl })
          } else {
            resolve({ success: false, error: '无法提取图标' })
          }
        })
        
        powershell.on('error', (error) => {
          clearTimeout(timeout)
          console.error('PowerShell 进程错误:', error)
          resolve({ success: false, error: error.message || 'PowerShell 进程启动失败' })
        })
      })
    } catch (error) {
      console.error('获取文件图标异常:', error)
      return { success: false, error: error.message }
    }
  })
}

module.exports = {
  registerIpcHandlers
}

