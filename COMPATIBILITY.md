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

> **⚠️ 修订（2026-09-22，v1.0.0 发布前）**：上游的「数据目录 = `process.cwd()`」很脆 ——
> 实测从别的 cwd 拉起 exe，`SaveData` 会跑到那个 cwd，用户看到的是「库空了」；
> 旧版单文件 portable 更糟（`%TEMP%` 解包目录，退出即被清空）。
> 本项目 v1.0.0 尚无已安装用户，**零迁移成本**，故改为：
>
> ```
> 打包后（安装版 / 绿色包）→ 资源根 = 数据根 = exe 所在目录
> 开发版（未打包）        → 资源根 = 数据根 = 启动 cwd（仓库根，行为不变）
> 单文件 portable（防御） → 资源根 = %TEMP% 解包目录，数据根 = 便携 exe 所在目录
> ```
>
> 实现在 `electron/utils/app-root.js`，启动时 `process.chdir(数据根)`，
> 因此**所有** `process.cwd()` 数据路径（含渲染层传来的相对路径）一次性统一。
> **新增「随包分发资源」（`configs/`、`disguise/`）的路径解析时，请用
> `resolveResourcePath()` / `getResourcesRoot()`，不要写裸相对路径。**
> 用户的 `settings.saveDataLocation === 'custom'` 优先级高于以上全部规则。

真实存档目录内容：

| 路径 | 内容 |
| --- | --- |
| `database.db` | 532KB，SQLite 主库 |
| `scraper-library.db` | 49KB，刮削库（本项目不再使用，**保留文件不动**） |
| `games/covers/` | 93 个文件（其中 **89 张**被 `coverPath` 引用，余为历史孤儿），文件名 `<游戏ID>_<时间戳>.png` |
| `Game/Screenshots/<ID>_<名字>/` | 274 文件 / 309MB，**无封面游戏的回退封面来源** + 游戏内截图 |
| `Settings/` | `settings.json` / `achievements.json` / `user.json` / `collections.json` |
| `TagOpsBackup/` | **可安全删除**：左栏标签操作（重命名/合并/移除）的撤销备份，最多留 20 份 JSON。删了只是没法再「撤销上一次标签操作」，不影响任何数据与其它功能 |
| 其它类型子目录 | 空或极少，**保留不动** |

---

## 一·补、标签批量操作对数据库的写入约定（2026-10-13，v1.5.0）

左栏筛选器（标签 / 开发商 / 作者 / 发行商 / 引擎）支持「重命名 / 合并 / 移除」，它**直接改写资源表**，
因此必须遵守以下约定（实现见 `electron/services/tag-ops.js`，单测见 `src/tests/tagOps.spec.ts`）：

1. **只动目标字段**：`UPDATE <表> SET jsonData = ?, timestamp = ? WHERE id = ?`，
   `jsonData` 里除目标字段外的所有键**逐字节保持原样**（已用真库副本逐字段比对验证）；
   `version` 列**不写**；`timestamp` 刷新为当前时间（用于识别"这条被改过"）。
2. **只动受影响的记录**：不整页重写。真库副本实测：视频页 6710 条里改 913 条耗时约 124ms，
   且 `timestamp` 只在被改的那 913 行上变化（其余 5797 行一字节未动）。
3. **先备份再写**：写库前把「哪些 id、改前是什么、改后是什么」落成 `TagOpsBackup/<时间>-<动作>-<字段>.json`；
   撤销时按 id 精确还原并**作废**该备份（不可重复撤销）。
4. **撞名即停**：重命名时若目标名已存在于该字段 → 拒绝执行（`code: duplicate`），
   引导用「合并标签」；合并允许并入一个已存在的标签名。
5. **字段类型按记录判断**：数组字段（`games.tags` / `games.developers` / `video.tags` / `video.author`）
   移除 = 从数组里删掉、合并 = 替换后去重；单值字段（`games.publisher` / `games.engine`）
   移除 = 清空成 `''`。**按这条记录里该字段实际是什么**来判断，避免历史脏数据被判错。
6. **预览必须只统计不写**：界面上的"影响面预览"走 `dryRun`，该参数必须一路透传到服务层
   （漏传会让"预览"变成真改库 —— 这坑 2026-10-13 被界面 E2E 抓到过，已加单测钉死）。

> 「格式筛选」的 `ext`、「丢失的资源」「正在游玩」都是**运行时算出来的**，库里没有这些字段，
> 因此界面上不给它们编辑入口（`NON_EDITABLE_TAG_FIELDS`）。

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

`settings` 表 1 行，`jsonData` 含 **47 个键**：

```
theme, autoStart, silentStart, minimizeToTray, disguiseMode, safetyKeyEnabled, safetyKeyUrl, safetyKeyShortcut,
showWindowShortcut, showWindowShortcutEnabled, customAppTitle, customAppSubtitle, backgroundImagePath,
saveDataLocation, saveDataPath, autoBackupEnabled, autoBackupInterval, maxBackupCount,
screenshotKey, screenshotLocation, screenshotsPath, screenshotFormat, screenshotQuality,
screenshotNotification, autoOpenScreenshotFolder, smartWindowDetection,
videoPlayMode, image, video, audio, game, novel, autoCheckUpdates, sidebarWidth, showWelcome,
sageMode, safetyKey, safetyAppPath, dataPath, autoBackup, lastView, sortSettings, layoutSettings,
hasShowUpdateDialog, videoRoots, videoExtensions, potPlayerPath
```

> 核实日期 **2026-10-05**（用只读连接数真库 `settings.jsonData` 的真实键集合：
> 当时 45 键，本文档此前漏记了 `videoRoots` / `videoExtensions`，已补齐）。
> 老库缺新键是**正常**的 —— 新增键按「缺省即默认值」处理，不得为此清库。

> `silentStart`（2026-10-05 新增）：开机自启时是否静默启动（只进托盘、不弹窗）。
> 纯新增键，老库缺它时按 `false` 处理；实现见 `electron/utils/login-item.js`。

> `potPlayerPath`（2026-10-10 新增）：PotPlayer 可执行文件路径，供「视频」页把选中的视频
> 写进 PotPlayer 播放列表时定位安装目录（`<安装目录>\Playlist\`）。
> 纯新增键，老库缺它时按 `''` 处理 = 自动探测（注册表卸载项 → 正在运行的进程）；
> 实现见 `electron/services/potplayer-playlist.js`。**键数 46 → 47**。

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
