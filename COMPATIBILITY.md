# 存档兼容性契约（不可破坏）

> 本文件是 GreenGameVault 的**硬约束**。任何改动若违反下列任一条，都会导致主人现有游戏库读不出来。
> 所有结论均来自对真实存档 `D:\Games\HGamesLink\GreenResourcesManager\SaveData\`（约 423MB）的**实测**。

---

## 一、存档位置

```
<启动工作目录>/SaveData/
```
由 `electron/database/sqlite.js` 的 `getSaveDataDirectory()` 决定，**基于 `process.cwd()`**，
并支持 `settings.saveDataLocation === 'custom'` + `settings.saveDataPath` 重定向。

> **⚠️ 便携版例外（2026-09-22 加入）**：单文件 portable 会把 App 解包到 `%TEMP%` 再运行，
> 此时 `process.cwd()` 指向临时目录，`SaveData` 会随解包目录被清掉。
> 因此启动时会先走 `electron/utils/app-root.js`：若存在 `PORTABLE_EXECUTABLE_DIR`，
> 就把 cwd 切到便携 exe 所在目录（**数据根**），同时把原始 cwd 记为**资源根**
> 供 `configs/`、`disguise/` 使用。
> **开发版 / 安装版下两者相同，此逻辑是空操作 —— 上面的规则不受影响。**
> 新增「随包分发资源」的路径解析时，请用 `resolveResourcePath()` 而不是裸的相对路径。

真实存档目录内容：

| 路径 | 内容 |
| --- | --- |
| `database.db` | 532KB，SQLite 主库 |
| `scraper-library.db` | 49KB，刮削库（本项目不再使用，**保留文件不动**） |
| `games/covers/` | 93 个文件（其中 **89 张**被 `coverPath` 引用，余为历史孤儿），文件名 `<游戏ID>_<时间戳>.png` |
| `Game/Screenshots/<ID>_<名字>/` | 274 文件 / 309MB，**无封面游戏的回退封面来源** + 游戏内截图 |
| `Settings/` | `settings.json` / `achievements.json` / `user.json` / `collections.json` |
| 其它类型子目录 | 空或极少，**保留不动** |

---

## 二、SQLite 结构（🚫 严禁改动）

```sql
CREATE TABLE "games" (id TEXT PRIMARY KEY, jsonData TEXT NOT NULL, timestamp TEXT, version TEXT);
CREATE TABLE "games_page" (id TEXT PRIMARY KEY, resourceType TEXT NOT NULL, resourceId TEXT NOT NULL);
CREATE TABLE settings (id TEXT PRIMARY KEY DEFAULT 'main', jsonData TEXT NOT NULL, timestamp TEXT, version TEXT);
CREATE TABLE user     (id TEXT PRIMARY KEY DEFAULT 'main', jsonData TEXT NOT NULL, timestamp TEXT, version TEXT);
```

- **表名是小写 `games`**（不是 `Game`）——由 `mapResourceTypeToTableName('Game')` 映射得到
- `games` = **265 行**；`games_page` 中 `resourceType='games'` 的有 **261 条**
- `pages` 表为空，页面归属靠 `games_page`（`id` 形如 `<时间戳>_<序号>_<随机>`）
- 库里还留有其它类型表（`video` / `novel` / `manga` / `software_page` …），多为空表。
  **一律保留，不删不建**，删了反而可能触发未知迁移逻辑

## 三、`games.jsonData` 字段（🚫 严禁改名/改语义）

265 行**全部已是新格式**（无旧格式残留，迁移已完成）。字段并集：

```jsonc
{
  "id": "1771570831617_irvnaquri",   // 形如 <时间戳>_<9位随机>
  "resourceType": "game",
  "name": "", "nickname": "", "nameZh": "", "nameEn": "", "nameJa": "",
  "description": "",
  "tags": [],                         // string[]，260/265 有标签，去重后 34 个
  "coverPath": "",                    // 见第四节
  "resourcePath": "",                 // 可执行文件绝对路径（注意：不是 executablePath）
  "developers": [], "publisher": "",
  "engine": "",
  "folderSize": 0,
  "playTime": 0, "playCount": 0,
  "visitedSessions": [],
  "rating": 0, "comment": "", "isFavorite": false,
  "addedDate": "", "lastPlayed": null, "firstPlayed": null,
  "fileExists": true, "isArchive": false
}
```

⚠️ 历史坑：旧版本用过 `image` / `executablePath`，**现已全部迁移**。
`CoverManager` 的 `COVER_FIELDS` 仍保留 `['coverPath','cover','thumbnail','thumbnailPath']` 兼容列表 —— **保留**。

---

## 四、封面解析链（🚫 关键路径，缺一不可）

```
MediaCard.vue  coverImagePath()
  1) item.coverPath 非空 → 用它                    // 119/265 走这条
  2) 否则 cover / thumbnail / thumbnailPath
  3) 否则且 type==='game' → 回退到【截图文件夹第一张图】  // 146/265 走这条
         ↳ useGameScreenshot.getGameScreenshotFolderPath(gameId, gameName)
         ↳ 目录：SaveData/Game/Screenshots/<ID>_<名字>/
```

相对路径 → `coverManager.getCoverUrl()` → IPC `get-cover-full-path` → `path.join(saveDataDir, coverPath)`。

### 🔴 铁律：写进 `coverPath` 的值绝不能自带 `SaveData` 前缀

`saveDataDir` **是相对路径**（`src/utils/SaveManager.ts:19` → `this.dataDirectory = 'SaveData'`），
`path.join` 全靠**主进程 cwd = 应用根目录**才能解析成功。所以：

```
存 "games/covers/x.png"                  → 解析 SaveData\games\covers\x.png            ✅
存 "Game/Screenshots/<ID>_<名>/x.png"    → 解析 SaveData\Game\Screenshots\...\x.png     ✅
存 "SaveData\Game\Screenshots\...\x.png" → 解析 SaveData\SaveData\Game\...\x.png        ❌ 双拼，永远加载不出来
```

👉 **任何从 `saveManager.dataDirectory` 派生出来的路径，落库前必须先剥掉 `SaveData` 前缀**。
渲染层为此提供了 `src/utils/ScreenshotCover.ts` 的 `toSaveDataRelativePath()`，新代码请复用它
（编辑对话框的单个按钮与游戏管理页的全局批量按钮都走这一套）。

**踩坑记录（2026-09-21 实锤）**：`handleUseFirstImageAsGameCover` 走 `listImageFiles()`，
返回的就是 `SaveData\Game\Screenshots\<文件夹>\<文件>.png`；原样存库后封面一片空白。
相对地，`handleUseScreenshotAsCover` 走 Electron 文件对话框，拿到的是**绝对路径**（含盘符），
被 `shouldProcessCover()` 判定为"需处理"并拷进 `games/covers/`，所以它一直能正常显示 ——
这就是那个「换个按钮就好了」的诡异现象的成因。**这是上游遗留 bug，不是本项目引入的。**

⚠️ 注意 `shouldProcessCover()` 的判据是"路径里有没有 `:`"：**带 `SaveData\` 前缀的相对路径没有冒号**，
因此不会被拷贝修复，会被原样存下去 —— 坏值就这样固化进库了。

封面路径形式（实测）：

| 形式 | 例 | 可否显示 |
| --- | --- | --- |
| 相对 SaveData | `games/covers/<ID>_<ts>.png`、`Game/Screenshots/<ID>_<名>/<文件>.png` | ✅ |
| 绝对路径 | `D:\...\SaveData\Game\Screenshots\...` | ✅（源文件还在时）|
| 带 `SaveData\` 前缀的相对路径 | ~~`SaveData\Game\Screenshots\...`~~ | ❌ **已全部修复，务必不要再产生** |

修复脚本与备份：`.temp/ggv-db-backup-20260921/`（修复前库）。修复逻辑＝对 `coverPath` 去掉
`SaveData/` 前缀、折叠重复斜杠、统一为正斜杠；只对**源文件仍然存在**的条目动刀，其余跳过。
**迁移主人真实存档时必须跑一次 —— 真实存档实测中招 12 条**（相对路径 101 条 = `games/covers/` 89 条 + 坏值 12 条）。

### 「使用最新截图作为封面」写入的就是第 2 种形式

单体（编辑对话框）与全局批量（游戏管理页工具栏）共用 `src/utils/ScreenshotCover.ts`：
取截图文件夹里**文件名内嵌时间戳最新**的一张，转成 `Game/Screenshots/<ID>_<名>/<文件>` 后落库，
**不复制文件到 `games/covers/`** —— 避免一键批量制造上百份重复图片。
2026-09-22 在开发库（265 条真实数据）上实测：139 条无封面中 **133 条可装载**（5 条无截图文件夹、1 条文件夹为空），
同形态的已有 18 条封面路径**全部可解析**。

**必须原样保留的代码**：
- `src/utils/CoverManager.ts`（尤其 `RESOURCE_TYPE_TO_DIR_MAP.Game = 'games'`）
- `electron/ipc/file-handlers.js` 的 `get-cover-full-path` / `save-cover-to-folder` / `save-cover-from-dataurl`
- `MediaCard.vue` 的封面回退分支
- `src/composables/game/useGameScreenshot.ts` 的 `getGameScreenshotFolderPath`

---

## 五、settings 兼容（🚫 不得丢键）

`settings` 表 1 行，`jsonData` 含 **43 个键**：

```
theme, autoStart, minimizeToTray, disguiseMode, safetyKeyEnabled, safetyKeyUrl, safetyKeyShortcut,
showWindowShortcut, showWindowShortcutEnabled, customAppTitle, customAppSubtitle, backgroundImagePath,
saveDataLocation, saveDataPath, autoBackupEnabled, autoBackupInterval, maxBackupCount,
screenshotKey, screenshotLocation, screenshotsPath, screenshotFormat, screenshotQuality,
screenshotNotification, autoOpenScreenshotFolder, smartWindowDetection,
videoPlayMode, image, video, audio, game, novel, autoCheckUpdates, sidebarWidth, showWelcome,
sageMode, safetyKey, safetyAppPath, dataPath, autoBackup, lastView, sortSettings, layoutSettings,
hasShowUpdateDialog
```

其中属于已删功能的键（`videoPlayMode` / `image` / `video` / `audio` / `novel` / `autoCheckUpdates` /
`sageMode` / `safetyKey*` …）**必须原样保留在库里，不得清除**。

**安全保证来自这两处实现，不得破坏**：
- `SaveManager.loadSettings()`：`{ ...this.defaultData.settings, ...sqliteSettings }` —— 合并而非替换
- `SaveManager.saveSettings(settings)`：整体写回 —— 只要调用方基于 `loadSettings()` 的返回对象改键，43 个键就不会丢

⚠️ 因此**新增设置时必须 `settings.xxx = v` 后整体保存**，禁止构造只含已知键的新对象去覆盖保存。

**与截图强相关的存活键**：`screenshotKey` / `screenshotLocation` / `screenshotsPath` /
`screenshotFormat` / `screenshotQuality` / `screenshotNotification` / `autoOpenScreenshotFolder` /
`smartWindowDetection`。

---

## 六、验收标准

把旧存档挂到新项目上，以下五项必须全部正常：

1. **游戏列表** —— 265 款全部出现，按 `games_page` 的 261 条归属正确显示
2. **标签** —— 34 个去重标签可筛选；260 款带标签游戏标签完整
   （另：**262 款带开发商**，去重后 **155 个开发商**；全局搜索现已支持按 tag 与开发商检索）
3. **封面** —— 119 款显示 `coverPath` 封面；146 款回退显示截图文件夹首图
4. **截图** —— 游戏内截图捕获可用；能浏览 `Game/Screenshots/<ID>_<名字>/` 历史截图
5. **统计** —— `playTime` / `playCount` / `lastPlayed` 正确显示且不被清零

---

## 七、验证方式（不污染真实存档）

1. 复制 `database.db` 到 `GreenGameVault/SaveData/` —— 轻量验证列表/标签/统计
2. 需要验证封面时，用**目录联接（junction）**把 `Game/` 与 `games/` 链过去，避免复制 423MB：
   ```powershell
   New-Item -ItemType Junction -Path GreenGameVault\SaveData\Game  -Target D:\Games\HGamesLink\GreenResourcesManager\SaveData\Game
   New-Item -ItemType Junction -Path GreenGameVault\SaveData\games -Target D:\Games\HGamesLink\GreenResourcesManager\SaveData\games
   ```
   ⚠️ 验证后务必删除联接，避免新程序写入真实存档
