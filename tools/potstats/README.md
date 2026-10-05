# PotStats —— PotPlayer 播放统计（可选外挂）

记录「某个视频用 PotPlayer 播放了多少次 / 累计播了多久 / 最后和第一次打开是什么时候」，
写进**视频同目录的同名 `.ini`**。

它同时是 **GreenGameVault 的可选外挂**：被 GGV 拉起时随 GGV 生命周期起落、无托盘无窗口，
把统计实时喂给 GGV 的「视频」页（见 `electron/services/potstats-bridge.js`）。

---

## 为什么不用 AngelScript 插件

GGV 原来靠比对视频文件的 **atime（最后访问时间）** 猜"外部播放器看过"。
但 atime 会被**任何**一次读取刷新 —— 磁盘装载 / 索引 / 杀毒 / 批量抽帧都会刷它。
主人真库实测：14 小时内就有 **1461 个文件**被机器批量读过（秒级间隔、还在持续变动）。
拿它当"看过"本质上是**猜**。

PotStats 走 **PotPlayer 官方 IPC**，拿到的是**实测值**：播放状态、播放位置、当前文件。

补一句：**纯 AngelScript 插件做不到这件事**（2026-10-05 实测确认）：

| 卡点 | 证据 |
| --- | --- |
| 脚本不能往视频目录写文件 | `Extension\api.txt` 第 129–137 行：`HostFileCreate` 只允许 config 目录，禁 `..`、禁绝对路径 |
| 脚本拿不到播放位置 / 暂停状态 | `api.txt` 全文只有 `HostGetPlayingFileName()` / `HostGetPlayingTitle()`，无位置、无状态、无时长 |
| 命令行也查不到 | `CmdLine64.txt` 842 行全是打开/播放开关，没有任何查询项 |

---

## IPC 协议（官方 SDK）

来源：Daum 官方 cafe「팟플레이어 실험실」，由 **PotPlayer 开发者本人**发布
→ <https://m.cafe.daum.net/pot-tool/N88T/6>（附件 `InternalSimpleCmd.h`，2023-08-29 更新）

```c
#define POT_COMMAND            WM_USER   // 0x0400
#define POT_GET_TOTAL_TIME     0x5002    // ms
#define POT_GET_CURRENT_TIME   0x5004    // ms
#define POT_GET_PLAY_STATUS    0x5006    // 0:Stopped 1:Paused 2:Running
#define POT_GET_PLAYFILE_NAME  0x6020    // 字符串，经 WM_COPYDATA 回传
```

查询一个数值：`SendMessageTimeout(hwnd, 0x0400, 0x5006, 0, ...)`，返回值就是状态。
取字符串要先把自己的回传窗口句柄当 `lParam` 传进去，播放器再以
`SendMessage(回传HWND, WM_COPYDATA, ...)` 把 **UTF-8** 字符串送回来。

### 本机实测踩到的三个坑（2026-10-05）

1. **22 个顶层窗口里只有 1 个真正处理该协议**，窗口类名是 `PotPlayer64`
   （32 位版为 `PotPlayer`）。其余窗口（`tooltips_class32` / `Afx:` /
   `FilterGraphWindow` / `PotShadowWnd` / `IME` …）**要么返回 0、要么直接不响应**。
   ⇒ **必须按窗口类名锁定实例**，绝不能按"有返回值"判断 —— 按后者选中了
   `tooltips_class32`，整个观察期拿到的全是 0。
2. **有些窗口对 `SendMessage` 会永久挂起** ⇒ 一律用 `SendMessageTimeout`（`SMTO_ABORTIFHUNG`）。
3. 窗口**标题是过去时**：探测期间标题显示的文件与 IPC 实报的文件可能不是同一个
   （播放列表自动续播）。⇒ 文件名一律**实时**问 IPC，标题只当兜底。

---

## 两种存在形态

```
PotStats.exe                                    （默认 / --tray）
  托盘图标，自己写 {视频名}.ini。可单独拷出去用，不依赖 GGV。

PotStats.exe --headless --parent-pid <pid>
  无托盘、无窗口、无任何 UI，随父进程生命周期起落；
  父进程一没就自杀（防 GGV 崩溃后留孤儿）；
  统计以 NDJSON 一行一条写到 stdout，由 GGV 主进程消费。
```

GGV 关闭时先关子进程的 **stdin**：子进程读到 EOF 会**先落盘再退出**，
不会被硬杀丢掉最后一个落盘间隔的数据。

---

## 统计口径（主人 2026-10-05 定的）

| 指标 | 口径 |
| --- | --- |
| 采样间隔 | 1 秒 |
| **播放次数** | 本次会话「真正在播」累计 **≥ 10 秒**才 +1，每个会话最多 +1 次（防误点/拖进度条灌水） |
| **累计播放时长** | **只在 `PLAY_STATUS == 2` 时累加**，暂停(1)/停止(0) 一秒都不算 |
| **最后打开时间** | 每次开会话取当前时间；同一会话内不重复刷 |
| **首次打开时间** | 只在 ini 里为空时写入，**永不覆盖** |
| 落盘时机 | 每 **30 秒** / 切换视频 / 实例消失 / 本进程退出（含 stdin EOF） |

累加用的是**真实墙钟增量**并设了上限（2× 采样间隔）：机器休眠/挂起时不会把那段空白算成观看。

**重播识别**：同一个文件播完再播，路径不变 → 靠「连续 3 拍都是 Stopped，之后又回到 Running」
判定为新会话（用连续拍数防抖，避免 seek/缓冲的假 Stopped 把次数灌爆）。

**多开**：每个 PotPlayer 实例（每个 `PotPlayer64` 窗口）**各自独立跟踪**，互不干扰。

---

## 输出：`{视频名}.ini`

与视频同目录、同主文件名。**只动 `[PotPlayer]` 这一段**，文件里其它 section、其它 key、
注释一律原样保留；连这一段里的手写注释和陌生 key 也保留。写不进去（只读盘/网络盘/无权限）
**静默跳过**，绝不让统计把播放器带崩。

```ini
[PotPlayer]
VideoFile=Aika_01.mp4
PlayCount=3
TotalPlaySeconds=147
TotalPlayTime=00:02:27
FirstOpenTime=2026-10-05 10:00:00
LastOpenTime=2026-10-05 11:30:00
LastPositionMs=45000
VideoDurationMs=60000
UpdatedAt=2026-10-05 14:03:46
```

**增量合并**：落盘时先读回磁盘当前值再累加"本次增量"，所以同一个视频被两个实例同时播时，
两边的时间都会累加进去，不会被后写的那边覆盖。

---

## 构建

```powershell
powershell -File build.ps1
```

用**系统自带** .NET Framework 4.8 的 `csc.exe` 编译 —— 零依赖、零安装。
目标机只要有 Windows（自带 .NET Framework 4.x）就能直接跑，不需要 .NET SDK/运行时。
产物：`bin/PotStats.exe`（约 31 KB，单文件）。

---

## 用法

```
PotStats.exe                                  独立形态：托盘常驻（默认）
PotStats.exe --headless --parent-pid <pid>    挂载形态：无 UI，随父进程退出
PotStats.exe --once                           诊断：只采一拍就退出
PotStats.exe --selftest-ini <文件>            诊断：离线自检 ini 合并逻辑

选项：
  --interval <ms>       采样间隔（默认 1000）
  --threshold <秒>      播放满多少秒算一次（默认 10）
  --flush <秒>          落盘间隔（默认 30）
  --ini-section <名>    ini 段名（默认 PotPlayer）
  --no-ini              只发事件不写 ini
  --log <路径>          日志文件路径（默认 exe 同目录 potstats.log）
  --verbose             日志同时回显到 stderr
```

`.temp/potstats-probe-20261005/` 里另外留了一个**协议探针**（`PotStatsProbe.exe`），
用于在没有 GGV 的情况下单独确认 IPC 通不通。

---

## 验证现状（2026-10-05）

| 项 | 状态 |
| --- | --- |
| 编译零错误零警告 | ✅ |
| `--selftest-ini` 12 项断言（保留别人的内容 / 计数不重复 / 首次时间不被覆盖 …） | ✅ 全过 |
| `--once` / `--help` / stdin EOF 优雅退出 / parent-pid 看门狗 | ✅ |
| 与 GGV 桥接的真进程挂载（spawn → NDJSON → 优雅退出 → 无孤儿） | ✅ 6/6 |
| 与真 SQLite 的写库往返（含"绝不碰 watchCount"） | ✅ 11/11 |
| **用真 PotPlayer 播一个视频的端到端** | ⏳ 待主人实机验证 |
