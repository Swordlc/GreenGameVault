# GreenGameVault

> 一个只做一件事的**本地游戏库管理器**：**游戏库 + 标签 + 截图装载**。
> 从 [GreenResourcesManager](https://github.com/klsdf/GreenResourcesManager) 精简剥离而来。

[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-blue.svg)](./LICENSE)

---

## 这是什么

上游 GreenResourcesManager 是个「什么都能管」的多媒体管理器（游戏 / 漫画 / 视频 / 音频 /
小说 / 网站 + 桌宠 + 成就 + 刮削 + 内置播放器 + 插件工坊）。功能很多，但绝大多数人
（包括我）其实只用得上其中一小块。

**GreenGameVault 把那一小块单独留下来，其余全部砍掉**，换来的好处是链路短、启动快、
坏了好修：

| 保留 ✅ | 移除 ❌ |
| --- | --- |
| 游戏库（增删改查、批量导入、多选批量操作） | 漫画 / 视频 / 音频 / 小说 / 网站 / 软件 / 单图 / 文件夹 共 8 个资源页 |
| 标签系统（侧栏筛选、批量增删 tag） | 桌宠、成就等游戏化系统 |
| 游戏截图（全局 F9 截图、详情页截图浏览、截图当封面） | 资源刮削库（scraper-library） |
| 开发商筛选、搜索（可按 tag 命中并高亮命中原因） | 内置播放器 / 阅读器 |
| 游戏启动、运行状态、游玩时长统计 | 插件 / 创意工坊（`new Function` 无沙箱执行） |
| 主页「抓阄」推荐：最常游玩 / 最近游玩 / 接下来游玩 三条链路（前 3 名固定 + 权重随机）+ 全局标签筛选 | |
| 完整的存档兼容（沿用上游 SQLite 结构与 `SaveData` 布局）| |

## 安装 / 运行

从 [Releases](../../releases) 下载：

| 文件 | 说明 |
| --- | --- |
| `GreenGameVault_Setup_<版本>.exe` | 安装版，可自选安装目录 |
| `GreenGameVault_<版本>_Portable_x64.zip` | **绿色包**：解压到任意目录，双击里面的 `GreenGameVault.exe` 即用 |

> 两者都是「绿色」的：数据（`SaveData/`）就在程序旁边，不写注册表、不往 C 盘塞数据。
> 换个机器把整个目录（或解压后的文件夹）拷走即可。

**绿色包怎么用**：解压出来的文件夹里就是安装后应有的一切（`GreenGameVault.exe` +
`configs/` + `disguise/` + `locales/` + `resources/` …）。

```
D:\Games\GreenGameVault\        ← 解压到这里
├── GreenGameVault.exe          ← 双击它
├── configs/                    ← 页面配置（随包分发）
├── disguise/                   ← 伪装壁纸目录（图片需自备，见下文）
├── locales/  resources/  ...
└── SaveData/                   ← 首次启动后自动生成，你的游戏库就在这儿
```

> ⚠️ 建议**双击 exe 启动**（或把快捷方式的「起始位置」指向该文件夹）。
> 数据目录是按**启动时的工作目录**定位的，从别处用奇怪的 cwd 拉起它会读不到库。

## 从源码构建

```bash
npm install
npm run electron-dev     # 开发调试（Vite :5173 + Electron）
npm run build            # 仅构建前端
npm run electron-build   # 打包 Windows 发行版 → dist-electron/v<版本>/
npm run test:run         # 单元测试
```

### ⚠️ 原生模块 ABI（必读）

`better-sqlite3` 是原生模块，而 **Node 24 = ABI 137、Electron 29 = ABI 121**，互斥。
**每次 `npm install` 之后**都要重跑一次预编译安装：

```bash
cd node_modules/better-sqlite3
npx prebuild-install --runtime=electron --target=29.4.6 --arch=x64 --platform=win32
```

本机没有 MSVC C++ 工具链，所以上游 README 推荐的 `electron-rebuild` **会直接编译失败**，
必须走预编译二进制。

### ⚠️ 打包 Windows 时的 `winCodeSign` 坑

`electron-builder` 首次打包会下载 `winCodeSign-2.6.0.7z`，里面含 **macOS 的 dylib 符号链接**。
非管理员且未开启 Windows 开发者模式时，7-Zip 会报
`Cannot create symbolic link ... libcrypto.dylib` 并重试 4 次后失败。

Windows 构建根本用不到 `darwin/`，手动跳过即可：

```powershell
$cache = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"
# 从已下载的 .7z 解包（-x!darwin 跳过符号链接）
& node_modules\7zip-bin\win\x64\7za.exe x "$cache\<随机名>.7z" "-o$cache\winCodeSign-2.6.0" -x'!darwin' -bd -y
```

之后重跑打包会打印 `found existing path=...\winCodeSign-2.6.0` 并直接跳过下载。

## 存档兼容

**GreenGameVault 直接读上游的 `SaveData/`，不需要迁移工具。** 只保留游戏相关的表，
其余表原样留存不动：

- `games`（266 行级）、`games_page`、`settings`、`user`
- `jsonData` 里始终不存 `lastPlayed` / `firstPlayed`，它们由 `visitedSessions` 派生

详细的不可破坏契约（表名、字段、封面解析链、settings 不得删键）见
**[COMPATIBILITY.md](./COMPATIBILITY.md)** —— 改数据层前请务必先读。

## 数据目录

| 项 | 位置 |
| --- | --- |
| 数据根 | 开发版 = 项目根；安装版 = 安装目录；绿色包 = 解压出来的文件夹 |
| 存档 | `<数据根>/SaveData/`（`database.db` + `Settings/` + `games/covers/` + `Game/Screenshots/`） |
| 用户配置 | `%APPDATA%/green-game-vault`（与上游的 `green-resources-manager` 相互独立） |

> 数据根由**启动时的工作目录**决定（`process.cwd()`），所以请双击程序目录里的 exe 启动，
> 或确保快捷方式的「起始位置」指向程序目录。
> 例外：旧版单文件 `portable` 包会把程序解压到 `%TEMP%` 再运行，此时改用
> `PORTABLE_EXECUTABLE_DIR`（见 `electron/utils/app-root.js`）把数据固定到 exe 旁边 ——
> 该防御逻辑保留着，但现在的发行版已不再使用单文件 portable 目标。

## 已知限制

- **仅 Windows**（主进程大量使用 PowerShell 做进程/窗口探测与截图）
- **`disguise/` 里的伪装壁纸不在本仓库内**：那些图片不是本作品的版权素材，请自行放入
  `disguise/` 目录（代码与加载逻辑完整保留）。仓库内只保留 `disguise.txt` 说明文件。
- 打包发行版未做代码签名，Windows SmartScreen 可能提示"未知发布者"
- 启动器（`.bat`/`.cmd`）类游戏的进程认领有 1~20 秒不等的等待窗口，属预期行为

## 致谢与授权

本项目是 **[GreenResourcesManager](https://github.com/klsdf/GreenResourcesManager)**
（作者 **YanChenXiang** / GitHub [@klsdf](https://github.com/klsdf)）的**精简衍生作品**。
界面框架、数据层设计、截图与游戏启动链路都源自上游 —— 没有上游就没有这个项目，
在此郑重致谢。

上游已停止维护，本项目在其基础上做减法与修复。

**License: [PolyForm Noncommercial License 1.0.0](./LICENSE) —— 仅限非商业用途。**

继承上游的授权条款：你可以自由使用、修改、分发，但**不得用于商业目的**，
且必须保留本授权与上述署名。详见 [LICENSE](./LICENSE) 与 [NOTICE](./NOTICE)。
