/**
 * 游戏引擎检测工具
 * 用于根据游戏目录结构自动识别游戏引擎
 *
 * 当前支持识别的游戏引擎类型（共 25 种，1种未实现）：
 * 1. Flash/ActionScript - 通过 .swf 文件识别
 * 2. Unity - 通过 UnityPlayer.dll 和 [GameName]_Data 文件夹识别
 * 3. Unreal Engine - 通过 Engine 文件夹或 .uproject 文件识别
 * 4. Godot - 通过 .pck 文件或 godot 可执行文件识别
 * 5. RPG Maker 2000/2003 - 通过.ini文件 + .ldb文件 + .lmt文件识别
 * 6. RPG Maker XP - 通过 .rxproj 文件或 .rgssad 文件识别
 * 7. RPG Maker VX - 通过 .rvproj 文件或 .rgss2a 文件识别
 * 8. RPG Maker VX Ace - 通过 .rvproj2 文件或 .rgss3a 文件识别
 * 9. RPG Maker MV - 通过 .rpgproject 文件或 www 文件夹内js文件夹中 rpg_cors.js 识别
 * 10. RPG Maker MZ - 通过 .rmmzproject 文件或 js 文件夹中 rmmz_cors.js 识别
 * 11. Wolf RPG - 通过 config.exe + data.wolf 或 data文件夹内 .wolf文件识别
 * 12. SRPG Studio - 通过 data.dts + environment.evs + runtime.rts 文件识别
 * 13. Pixel Game Maker MV - 暂未实现
 * 14. RPG Developer Bakin - 通过data文件夹 bakinplayer.exe 和 bakinplayer.exe.config 文件识别
 * 15. GameMaker Studio - 通过 data.win 或 options.ini 文件识别
 * 16. TyranoBuilder - 通过 *_tyrano_data.* 文件识别
 * 17. Ren'Py - 通过 renpy 文件夹和 game 文件夹识别
 * 18. Construct - 通过 construct 相关文件或 data.js + main.js 识别
 * 19. Love2D - 通过 main.lua 文件识别
 * 20. Python/Pygame - 通过 .py 文件和 pygame 相关文件识别
 * 21. Java - 通过 .jar 文件识别
 * 22. Kirikiri / 吉里吉里 - 通过 .xp3 文件或 data.xp3 文件识别
 * 23. CatSystem2 - 通过 cs2.exe、.int 文件（scene.int/image.int）、startup.xml 或 .dat 文件识别
 * 24. Ethornell (BGI) - 通过 BGI.exe、.arc 文件或 BGI.gdb 文件识别
 * 25. Entis - 通过 .noa 文件、.eri 文件或 .mio 文件识别
 * 26. Electron - 通过 resources/app.asar 或 resources/electron.asar 文件识别
 */

/**
 * 检测上下文，包含游戏路径、目录信息、文件列表等
 */
interface DetectionContext {
  gamePath: string
  gameDir: string
  gameFileName: string
  files: string[]
  fileNames: string[]
  filePaths: string[]
  pathSeparator: string
}

/**
 * 引擎检测器函数类型
 */
type EngineDetector = (context: DetectionContext) => Promise<string | null> | string | null

/**
 * 引擎检测器配置
 */
interface EngineDetectorConfig {
  name: string
  detector: EngineDetector
}

/**
 * 检测 Flash/ActionScript 引擎
 */
function detectFlash(context: DetectionContext): string | null {
  if (context.gamePath.toLowerCase().endsWith('.swf')) {
    return 'Flash/ActionScript'
  }
  return null
}

/**
 * 检测 Unity 引擎
 */
function detectUnity(context: DetectionContext): string | null {
  const hasUnityPlayer = context.fileNames.some(f => f.includes('unityplayer.dll'))
  const hasUnityData = context.fileNames.some(f => f.includes('_data') && f.includes(context.gameFileName.toLowerCase()))
  if (hasUnityPlayer || hasUnityData) {
    return 'Unity'
  }
  return null
}

/**
 * 检测 Unreal Engine
 */
function detectUnrealEngine(context: DetectionContext): string | null {
  const hasEngineFolder = context.fileNames.some(f => f === 'engine' || f.includes('engine'))
  const hasUproject = context.fileNames.some(f => f.endsWith('.uproject'))
  if (hasEngineFolder || hasUproject) {
    return 'Unreal Engine'
  }
  return null
}

/**
 * 检测 Godot 引擎
 */
function detectGodot(context: DetectionContext): string | null {
  const hasGodotPck = context.fileNames.some(f => f.endsWith('.pck'))
  const hasGodotExe = context.fileNames.some(f => f.includes('godot'))
  if (hasGodotPck || hasGodotExe) {
    return 'Godot'
  }
  return null
}


/**
 * 检测Wolf RPG 引擎
 * 检查游戏目录下是否存在data.wolf 或 游戏目录下data文件夹中存在.wolf为扩展名的文件
 * 同时游戏目录下应该有config.exe
 */
async function detectWolfRPG(context: DetectionContext): Promise<string | null> {
  const { gameDir, pathSeparator, fileNames } = context

  const hasConfigExe = fileNames.some(f => f === 'config.exe');
  const hasDataDir = fileNames.some(f => f === 'data' || f === 'data/');
  const hasDataWolf = fileNames.some(f => f === 'data.wolf')

  if (hasConfigExe) {
    if (hasDataDir) {
      const dataDirPath = `${gameDir}${pathSeparator}data`
      const result = await window.electronAPI.listFiles(dataDirPath);
      if (result.success && Array.isArray(result.files)) {
        const dataDirFiles = result.files.map((f: any) => typeof f === 'string' ? f : (f?.name || String(f))).map((f: string) => f.toLowerCase())
        if (dataDirFiles.some(f => f.endsWith('.wolf'))) {
          return 'Wolf RPG';
        }
      }
    } else if (hasDataWolf) {
      return 'Wolf RPG';
    }
  }

  return null;
}

/**
 * 检测RPG Maker MV/MZ
 */
async function detectRPGMaker(context: DetectionContext): Promise<string | null> {
  const { gameDir, pathSeparator, fileNames, filePaths } = context

  // 首先检查项目文件（最准确的方法，不常见）
  const hasRpgProject = fileNames.some(f => f.endsWith('.rpgproject')) // MV
  const hasRmmzProject = fileNames.some(f => f.endsWith('.rmmzproject')) // MZ

  // 如果找到项目文件，直接返回
  if (hasRmmzProject) {
    return 'RPG Maker MZ'
  }
  if (hasRpgProject) {
    return 'RPG Maker MV'
  }

  // 检查文件夹和文件结构
  const hasWwwFolder = fileNames.some(f => f === 'www' || f === 'www/')
  const hasJsFolder = fileNames.some(f => f === 'js' || f === 'js/')
  const hasPackageJson = filePaths.some(f => f.endsWith('package.json')) || fileNames.some(f => f === 'package.json')
  // const hasIndexHtml = filePaths.some(f => f.endsWith('index.html')) || fileNames.some(f => f === 'index.html')

  /**
   * 检查js文件夹是否有特定文件
   * @param path
   * @param targetFileName
   */
  async function checkJsFolder(path, targetFileName) {
    try {
      const jsResult = await window.electronAPI.listFiles(path)
      if (jsResult.success && Array.isArray(jsResult.files)) {
        const jsFiles = jsResult.files.map((f: any) => typeof f === 'string' ? f : (f?.name || String(f))).map((f: string) => f.toLowerCase())
        return jsFiles.some(f => f.includes(targetFileName))
      }
    } catch (error) {
      console.warn('检查 js 文件夹失败:', error)
      return false;
    }
  }

  // index.html文件可能在根目录也可能在www内，由package.json文件中main决定
  // rpg maker mv 特征：www 文件夹 + package.json + www/js包含rpg_core.js
  // rpg maker mz 特征：无www文件夹 + package.json + js包含rmmz_core.js
  if (hasPackageJson) {
    if (hasWwwFolder) {
      const wwwJsPath = `${gameDir}${pathSeparator}www${pathSeparator}js`;
      if (await checkJsFolder(wwwJsPath, 'rpg_core.js')) {
        return 'RPG Maker MV'
      }
    } else if (!hasWwwFolder && hasJsFolder) {
      const jsPath = `${gameDir}${pathSeparator}js`
      if (await checkJsFolder(jsPath, 'rmmz_core.js')) {
        return 'RPG Maker MZ'
      }
    }
  }

  return null
}

/**
 * 检测RPG Maker 2000/2003/XP/VX/VX Ace
 * RMXP（太阳）：.rxproj .rgssad
 * RMVX（马头）：.rvproj .rgss2a
 * RMVA（龙头）：.rvproj2 .rgss3a
 * RM2K/RM2K3：.ini + .ldb + .lmt
 */
function detectRPGMakerOldVersions(context: DetectionContext): string | null {
  if (context.fileNames.some(f => f.endsWith('.rxproj') || f.endsWith('.rgssad'))) {
    return 'RPG Maker XP'
  }

  if (context.fileNames.some(f => f.endsWith('.rvproj') || f.endsWith('.rgss2a'))) {
    return 'RPG Maker VX'
   }

  if (context.fileNames.some(f => f.endsWith('.rvproj2') || f.endsWith('.rgss3a'))) {
    return 'RPG Maker VX Ace'
  }

  const hasIni = context.fileNames.some(f => f.endsWith('.ini'))
  const hasLdb = context.fileNames.some(f => f.endsWith('.ldb'))
  const hasLmt = context.fileNames.some(f => f.endsWith('.lmt'))
  if (hasIni && hasLdb && hasLmt) {
    return 'RPG Maker 2000/2003'
  }

  return null
}

/**
 * 检测 SRPG Studio
 * 游戏目录包含data.dts environment.evs runtime.rts
 * 可能存在system.dat 文件
 */
function detectSRPGStudio(context: DetectionContext): string | null {
  const hasDataDts = context.fileNames.some(f => f === 'data.dts')
  const hasEnvironmentEvs = context.fileNames.some(f => f === 'environment.evs')
  const hasRuntimeRts = context.fileNames.some(f => f === 'runtime.rts')
  if (hasDataDts && hasEnvironmentEvs && hasRuntimeRts) {
    return 'SRPG Studio'
  }

  return null
}

/**
 * 检测 Pixel Game Maker MV
 * todo: 未发现PGMMV游戏文件特征
 */
function detectPixelGameMakerMv(context: DetectionContext): string | null {
  return null;
}

/**
 * 检测 RPG Developer Bakin
 * 游戏目录下包含data文件夹，其中包含bakinplayer.exe和bakinplayer.exe.config
 */
async function detectRPGDeveloperBakin(context: DetectionContext): Promise<string | null> {
  const { gameDir, pathSeparator, fileNames } = context

  const hasDataDir = fileNames.some(f => f === 'data' || f === 'data/')
  if (hasDataDir) {
    const dataDirPath = `${gameDir}${pathSeparator}data`
    const result = await window.electronAPI.listFiles(dataDirPath)
    if (result.success && Array.isArray(result.files)) {
      const dataDirFiles = result.files.map((f: any) => typeof f === 'string' ? f : (f?.name || String(f))).map((f: string) => f.toLowerCase())
      const hasBakinPlayer = dataDirFiles.some(f => f.includes('bakinplayer.exe'))
      const hasBakinPlayerConfig = dataDirFiles.some(f => f.includes('bakinplayer.exe.config'))
      if (hasBakinPlayer && hasBakinPlayerConfig) {
        return 'RPG Developer Bakin'
      }
    }
  }

  return null;
}

/**
 * 检测 GameMaker Studio
 */
function detectGameMaker(context: DetectionContext): string | null {
  const hasDataWin = context.fileNames.some(f => f === 'data.win' || f === 'game.unx')
  const hasOptionsIni = context.fileNames.some(f => f === 'options.ini')
  if (hasDataWin || hasOptionsIni) {
    return 'GameMaker Studio'
  }
  return null
}

/**
 * 检测 TyranoBuilder
 */
function detectTyranoBuilder(context: DetectionContext): string | null {
  const hasTyranoData = context.fileNames.some(f => f.includes('tyrano_data') || f.includes('tyranodata'))
  if (hasTyranoData) {
    return 'TyranoBuilder'
  }
  return null
}

/**
 * 检测 Ren'Py
 */
function detectRenpy(context: DetectionContext): string | null {
  const hasRenpyFolder = context.fileNames.some(f => f === 'renpy' || f.includes('renpy'))
  const hasGameFolder = context.fileNames.some(f => f === 'game')
  if (hasRenpyFolder && hasGameFolder) {
    return "Ren'Py"
  }
  return null
}

/**
 * 检测 Construct
 */
function detectConstruct(context: DetectionContext): string | null {
  const hasConstructFiles = context.fileNames.some(f => f.includes('construct') || (f === 'data.js' && context.fileNames.includes('main.js')))
  if (hasConstructFiles) {
    return 'Construct'
  }
  return null
}

/**
 * 检测 Love2D
 */
function detectLove2D(context: DetectionContext): string | null {
  const hasMainLua = context.fileNames.some(f => f === 'main.lua')
  if (hasMainLua) {
    return 'Love2D'
  }
  return null
}

/**
 * 检测 Python/Pygame
 */
function detectPythonPygame(context: DetectionContext): string | null {
  const hasPythonFiles = context.fileNames.some(f => f.endsWith('.py'))
  if (hasPythonFiles && context.fileNames.some(f => f.includes('pygame'))) {
    return 'Python/Pygame'
  }
  return null
}

/**
 * 检测 Java
 */
function detectJava(context: DetectionContext): string | null {
  const hasJarFiles = context.fileNames.some(f => f.endsWith('.jar'))
  if (hasJarFiles) {
    return 'Java'
  }
  return null
}

/**
 * 检测 Kirikiri / 吉里吉里
 */
function detectKirikiri(context: DetectionContext): string | null {
  const hasXp3Files = context.fileNames.some(f => f.endsWith('.xp3') || f === 'data.xp3')
  const hasKrkrExe = context.fileNames.some(f => f.includes('krkr') || f.includes('kag'))
  if (hasXp3Files || hasKrkrExe) {
    return 'Kirikiri / 吉里吉里'
  }
  return null
}

/**
 * 检测 CatSystem2
 */
function detectCatSystem2(context: DetectionContext): string | null {
  const { fileNames } = context
  const hasCs2Exe = fileNames.some(f => f === 'cs2.exe')
  const hasStartupXml = fileNames.some(f => f === 'startup.xml')
  const hasSceneInt = fileNames.some(f => f === 'scene.int')
  const hasImageInt = fileNames.some(f => f === 'image.int')
  const hasFesInt = fileNames.some(f => f === 'fes.int')
  const hasIntFiles = fileNames.some(f => f.endsWith('.int'))
  const hasDirectDat = fileNames.some(f => f === 'direct.dat')
  const hasKeyDat = fileNames.some(f => f === 'key.dat')

  // 如果找到 cs2.exe，直接返回 CatSystem2
  if (hasCs2Exe) {
    return 'CatSystem2'
  }

  // 如果同时有 startup.xml 和 .int 文件，很可能是 CatSystem2
  if (hasStartupXml && (hasSceneInt || hasImageInt || hasFesInt || hasIntFiles)) {
    return 'CatSystem2'
  }

  // 如果有 .int 文件和 .dat 文件，也可能是 CatSystem2
  if ((hasDirectDat || hasKeyDat) && (hasSceneInt || hasImageInt || hasFesInt || hasIntFiles)) {
    return 'CatSystem2'
  }

  return null
}

/**
 * 检测 Electron
 */
async function detectElectron(context: DetectionContext): Promise<string | null> {
  const { gameDir, pathSeparator, fileNames, filePaths } = context

  // 检查文件夹和文件结构（需要排除 RPG Maker MV/MZ）
  const hasWwwFolder = fileNames.some(f => f === 'www' || f === 'www/')
  const hasPackageJson = filePaths.some(f => f.endsWith('package.json')) || fileNames.some(f => f === 'package.json')
  const hasAppAsar = filePaths.some(f => f.includes('resources') && (f.endsWith('app.asar') || f.endsWith('electron.asar')))
  const hasResourcesFolder = fileNames.some(f => f === 'resources' || f === 'resources/')

  if (hasAppAsar || (hasResourcesFolder && hasPackageJson && !hasWwwFolder)) {
    // 进一步检查 resources 文件夹中是否有 .asar 文件
    if (hasResourcesFolder) {
      try {
        const resourcesPath = `${gameDir}${pathSeparator}resources`
        const resourcesResult = await window.electronAPI.listFiles(resourcesPath)
        if (resourcesResult.success && Array.isArray(resourcesResult.files)) {
          const resourcesFiles = resourcesResult.files.map((f: any) => typeof f === 'string' ? f : (f?.name || String(f))).map((f: string) => f.toLowerCase())
          const hasAsarFile = resourcesFiles.some(f => f.endsWith('.asar'))
          if (hasAsarFile) {
            return 'Electron'
          }
        }
      } catch (error) {
        console.warn('检查 resources 文件夹失败:', error)
      }
    }
    // 如果已经有 app.asar 或 electron.asar 的路径匹配，直接返回
    if (hasAppAsar) {
      return 'Electron'
    }
  }

  return null
}

/**
 * 检测 Ethornell (BGI) 引擎
 */
function detectEthornell(context: DetectionContext): string | null {
  const { fileNames } = context
  const hasBgiExe = fileNames.some(f => f === 'bgi.exe')
  const hasBgiGdb = fileNames.some(f => f === 'bgi.gdb')
  const hasArcFiles = fileNames.some(f => f.endsWith('.arc'))

  // 如果找到 BGI.exe，直接返回 Ethornell (BGI)
  if (hasBgiExe) {
    return 'Ethornell (BGI)'
  }

  // 如果有 BGI.gdb 和 .arc 文件，很可能是 Ethornell (BGI)
  if (hasBgiGdb && hasArcFiles) {
    return 'Ethornell (BGI)'
  }

  // 如果有多个 .arc 文件（特别是 data*.arc 或 01xxx.arc 等格式），也可能是 Ethornell
  const arcFileCount = fileNames.filter(f => f.endsWith('.arc')).length
  if (arcFileCount >= 3 && hasArcFiles) {
    // 检查是否有典型的 BGI arc 文件命名模式（01xxx.arc, 02xxx.arc 等）
    const hasTypicalArcNaming = fileNames.some(f => {
      const match = f.match(/^0[1-5]\d{3}\.arc$/)
      return match !== null
    })
    if (hasTypicalArcNaming) {
      return 'Ethornell (BGI)'
    }
  }

  return null
}

/**
 * 检测 Entis 引擎
 */
function detectEntis(context: DetectionContext): string | null {
  const { fileNames } = context
  const hasNoaFiles = fileNames.some(f => f.endsWith('.noa'))
  const hasEriFiles = fileNames.some(f => f.endsWith('.eri'))
  const hasMioFiles = fileNames.some(f => f.endsWith('.mio'))

  // 如果找到 .noa 文件，很可能是 Entis
  if (hasNoaFiles) {
    return 'Entis'
  }

  // 如果同时有 .eri 和 .mio 文件，也可能是 Entis
  if (hasEriFiles && hasMioFiles) {
    return 'Entis'
  }

  return null
}

/**
 * 引擎检测器配置数组（按优先级排序）
 */
const engineDetectors: EngineDetectorConfig[] = [
  { name: 'Flash/ActionScript', detector: detectFlash },
  { name: 'Unity', detector: detectUnity },
  { name: 'Unreal Engine', detector: detectUnrealEngine },
  { name: 'Godot', detector: detectGodot },
  { name: 'RPG Maker MV/MZ', detector: detectRPGMaker },
  { name: 'RPG Maker XP/VX/VA', detector: detectRPGMakerOldVersions},
  { name: 'Wolf RPG', detector: detectWolfRPG},
  { name: 'SRPG studio', detector: detectSRPGStudio},
  { name: 'Pixel Game Maker MV', detector: detectPixelGameMakerMv},
  { name: 'RPG Developer Bakin', detector: detectRPGDeveloperBakin},
  { name: 'GameMaker Studio', detector: detectGameMaker },
  { name: 'TyranoBuilder', detector: detectTyranoBuilder },
  { name: "Ren'Py", detector: detectRenpy },
  { name: 'Construct', detector: detectConstruct },
  { name: 'Love2D', detector: detectLove2D },
  { name: 'Python/Pygame', detector: detectPythonPygame },
  { name: 'Java', detector: detectJava },
  { name: 'Kirikiri / 吉里吉里', detector: detectKirikiri },
  { name: 'CatSystem2', detector: detectCatSystem2 },
  { name: 'Ethornell (BGI)', detector: detectEthornell },
  { name: 'Entis', detector: detectEntis },
  { name: 'Electron', detector: detectElectron },
]

/**
 * 检测游戏引擎
 * @param gamePath - 游戏可执行文件路径
 * @returns Promise<string | null> - 检测到的引擎名称，如果无法识别则返回 null
 */
export async function detectGameEngine(gamePath: string): Promise<string | null> {
  try {
    // 检查 Electron API 是否可用
    if (!window.electronAPI || !window.electronAPI.listFiles) {
      console.warn('Electron API 不可用，无法检测游戏引擎')
      return null
    }

    // 获取游戏文件所在目录（使用字符串操作，避免 require('path')）
    const lastSeparator = Math.max(gamePath.lastIndexOf('\\'), gamePath.lastIndexOf('/'))
    const gameDir = lastSeparator >= 0 ? gamePath.substring(0, lastSeparator) : gamePath
    const fileNameWithExt = lastSeparator >= 0 ? gamePath.substring(lastSeparator + 1) : gamePath
    const lastDot = fileNameWithExt.lastIndexOf('.')
    const gameFileName = lastDot >= 0 ? fileNameWithExt.substring(0, lastDot) : fileNameWithExt

    // 列出目录中的文件和文件夹
    const listResult = await window.electronAPI.listFiles(gameDir)
    if (!listResult.success || !listResult.files) {
      return null
    }

    // listFiles 可能返回字符串数组或对象数组
    const files = Array.isArray(listResult.files)
      ? listResult.files.map((f: any) => typeof f === 'string' ? f : (f?.name || String(f)))
      : []
    const fileNames = files.map(f => f.toLowerCase())
    const pathSeparator = gameDir.includes('\\') ? '\\' : '/'
    const filePaths = files.map(f => `${gameDir}${pathSeparator}${f}`.toLowerCase())

    // 构建检测上下文
    const context: DetectionContext = {
      gamePath,
      gameDir,
      gameFileName,
      files,
      fileNames,
      filePaths,
      pathSeparator
    }

    // 按优先级顺序检测引擎
    for (const { name, detector } of engineDetectors) {
      const result = await detector(context)
      if (result) {
        return result
      }
    }

    return null
  } catch (error) {
    console.error('检测游戏引擎时出错:', error)
    return null
  }
}
