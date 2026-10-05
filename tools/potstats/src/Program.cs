/*
 * Program.cs —— PotStats 入口
 *
 * 三种存在形态（同一份代码）：
 *   1. 独立形态   `PotStats.exe`（默认 / --tray）
 *        托盘图标，自己写 {视频名}.ini，主人手动跑或开机自启。
 *   2. 挂载形态   `PotStats.exe --headless --parent-pid <GGV 的 pid>`
 *        **无托盘、无窗口、无任何 UI**，随 GreenGameVault 生命周期起落；
 *        父进程一没就自杀（防 GGV 崩溃后留下孤儿进程）；
 *        统计结果以 NDJSON 一行一条写到 stdout，由 GGV 主进程消费。
 *   3. 诊断形态   `--once`（单拍采样）/ `--selftest-ini <文件>`（离线自检 ini 合并逻辑）
 *
 * 无论哪种形态都需要消息循环：取播放文件名靠的是播放器回调 WM_COPYDATA。
 * 因此主线程一律只跑消息循环，统计跑在工作线程上。
 */

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace PotStats
{
    internal sealed class Options
    {
        public bool Headless;
        public bool Once;
        public bool ShowHelp;
        public bool WriteIni = true;
        public bool EchoStdout;
        public int IntervalMs = 1000;
        public int ThresholdSeconds = 10;
        public int FlushSeconds = 30;
        public int ParentPid;
        public string IniSection = StatsStore.DEFAULT_SECTION;
        public string LogPath;
        public string SelfTestIni;

        public static Options Parse(string[] args)
        {
            Options o = new Options();
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (a == "--headless") o.Headless = true;
                else if (a == "--tray") o.Headless = false;
                else if (a == "--once") o.Once = true;
                else if (a == "--no-ini") o.WriteIni = false;
                else if (a == "--verbose") o.EchoStdout = true;
                else if (a == "--help" || a == "-h" || a == "/?") o.ShowHelp = true;
                else if (a == "--interval" && i + 1 < args.Length) o.IntervalMs = ParseInt(args[++i], o.IntervalMs);
                else if (a == "--threshold" && i + 1 < args.Length) o.ThresholdSeconds = ParseInt(args[++i], o.ThresholdSeconds);
                else if (a == "--flush" && i + 1 < args.Length) o.FlushSeconds = ParseInt(args[++i], o.FlushSeconds);
                else if (a == "--parent-pid" && i + 1 < args.Length) o.ParentPid = ParseInt(args[++i], o.ParentPid);
                else if (a == "--ini-section" && i + 1 < args.Length) o.IniSection = args[++i];
                else if (a == "--log" && i + 1 < args.Length) o.LogPath = args[++i];
                else if (a == "--selftest-ini" && i + 1 < args.Length) o.SelfTestIni = args[++i];
            }
            if (o.IntervalMs < 200) o.IntervalMs = 200;
            if (o.ThresholdSeconds < 1) o.ThresholdSeconds = 1;
            if (o.FlushSeconds < 5) o.FlushSeconds = 5;
            if (o.IniSection.Length == 0) o.IniSection = StatsStore.DEFAULT_SECTION;
            if (o.Headless) o.EchoStdout = true;
            return o;
        }

        private static int ParseInt(string text, int fallback)
        {
            int v;
            return int.TryParse(text, out v) ? v : fallback;
        }
    }

    /// <summary>把引擎跑在工作线程上，主线程留给消息循环</summary>
    internal sealed class EngineHost
    {
        private readonly Options _opt;
        private readonly Logger _log;
        private volatile bool _stop;

        public int ExitCode;
        public TrackerEngine Engine;

        public EngineHost(Options opt, Logger log)
        {
            _opt = opt;
            _log = log;
        }

        public void Stop()
        {
            _stop = true;
        }

        public void Run()
        {
            try
            {
                TrackerOptions to = new TrackerOptions();
                to.IntervalMs = _opt.IntervalMs;
                to.ThresholdSeconds = _opt.ThresholdSeconds;
                to.FlushSeconds = _opt.FlushSeconds;
                to.IniSection = _opt.IniSection;
                to.WriteIni = _opt.WriteIni;
                Engine = new TrackerEngine(to, _log);

                if (_opt.Once)
                {
                    Engine.Tick();
                    Engine.FlushAll("once");
                    return;
                }

                _log.Info(string.Format("开始统计（间隔 {0}ms，计数阈值 {1}s，落盘间隔 {2}s，写 ini={3}）",
                    _opt.IntervalMs, _opt.ThresholdSeconds, _opt.FlushSeconds, _opt.WriteIni));

                while (!_stop)
                {
                    if (_opt.ParentPid > 0 && !IsProcessAlive(_opt.ParentPid))
                    {
                        _log.Info("父进程 " + _opt.ParentPid + " 已退出，随之收工");
                        break;
                    }
                    Engine.Tick();
                    SleepInterruptible(_opt.IntervalMs);
                }

                Engine.FlushAll("exit");
            }
            catch (Exception ex)
            {
                _log.Warn("引擎异常终止: " + ex);
                ExitCode = 9;
            }
            finally
            {
                PotIpc.RequestQuit();
            }
        }

        private void SleepInterruptible(int ms)
        {
            int waited = 0;
            while (waited < ms && !_stop)
            {
                int step = ms - waited;
                if (step > 100) step = 100;
                Thread.Sleep(step);
                waited += step;
            }
        }

        internal static bool IsProcessAlive(int pid)
        {
            try
            {
                Process p = Process.GetProcessById(pid);
                return !p.HasExited;
            }
            catch
            {
                return false;
            }
        }
    }

    /// <summary>独立形态的托盘图标（挂载形态绝不创建它）</summary>
    internal sealed class TrayHost : IDisposable
    {
        private NotifyIcon _icon;

        public TrayHost(Logger log, Action onExit)
        {
            _icon = new NotifyIcon();
            _icon.Icon = SystemIcons.Application;
            _icon.Text = "PotStats · 统计 PotPlayer 播放";

            ContextMenuStrip menu = new ContextMenuStrip();
            ToolStripMenuItem title = new ToolStripMenuItem("正在统计 PotPlayer 播放");
            title.Enabled = false;
            menu.Items.Add(title);
            menu.Items.Add(new ToolStripSeparator());

            string logPath = log.LogPath;
            ToolStripMenuItem openLog = new ToolStripMenuItem("打开日志");
            openLog.Click += delegate
            {
                try
                {
                    if (!string.IsNullOrEmpty(logPath) && File.Exists(logPath))
                        Process.Start("notepad.exe", "\"" + logPath + "\"");
                }
                catch { /* 忽略 */ }
            };
            menu.Items.Add(openLog);

            ToolStripMenuItem quit = new ToolStripMenuItem("退出");
            quit.Click += delegate { onExit(); };
            menu.Items.Add(quit);

            _icon.ContextMenuStrip = menu;
            _icon.Visible = true;
        }

        public void Dispose()
        {
            if (_icon != null)
            {
                _icon.Visible = false;
                _icon.Dispose();
                _icon = null;
            }
        }
    }

    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            Options opt;
            try
            {
                opt = Options.Parse(args);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("参数有误: " + ex.Message);
                return 64;
            }

            if (opt.ShowHelp)
            {
                PrintHelp();
                return 0;
            }

            if (!string.IsNullOrEmpty(opt.SelfTestIni))
            {
                return SelfTest.Run(opt.SelfTestIni, opt.IniSection);
            }

            try { Console.OutputEncoding = Encoding.UTF8; }
            catch { /* 无控制台时忽略 */ }

            Logger log = new Logger(opt.LogPath, opt.EchoStdout);
            log.Info("PotStats 启动: " + string.Join(" ", args));

            // 回传窗口必须建在将要跑消息循环的那个线程上
            PotIpc.EnsureReplyWindow();

            EngineHost host = new EngineHost(opt, log);
            TrayHost tray = null;
            if (!opt.Headless && !opt.Once)
            {
                try
                {
                    tray = new TrayHost(log, host.Stop);
                }
                catch (Exception ex)
                {
                    log.Warn("托盘创建失败（继续无托盘运行）: " + ex.Message);
                }
            }

            Thread worker = new Thread(host.Run);
            worker.IsBackground = true;
            worker.Start();

            // 挂载形态：父进程（GreenGameVault）关闭我们的 stdin 就表示"该收尾了"。
            // 这样退出前能先把最后一段播放时长落盘，而不是被硬杀丢掉最多一个落盘间隔的数据。
            if (opt.Headless)
            {
                Thread stdinWatcher = new Thread(delegate()
                {
                    try
                    {
                        string line;
                        while ((line = Console.In.ReadLine()) != null)
                        {
                            string cmd = line.Trim().ToLowerInvariant();
                            if (cmd == "quit" || cmd == "exit") break;
                        }
                    }
                    catch { /* 管道已断，同样按退出处理 */ }
                    log.Info("stdin 已关闭，开始收尾");
                    host.Stop();
                });
                stdinWatcher.IsBackground = true;
                stdinWatcher.Start();
            }

            Application.Run(new ApplicationContext());

            if (tray != null) tray.Dispose();
            log.Info("PotStats 退出，退出码 " + host.ExitCode);
            return host.ExitCode;
        }

        private static void PrintHelp()
        {
            Console.WriteLine("PotStats —— 记录 PotPlayer 播放次数 / 累计时长 / 打开时间");
            Console.WriteLine();
            Console.WriteLine("用法:");
            Console.WriteLine("  PotStats.exe [--tray]                     独立形态：托盘常驻（默认）");
            Console.WriteLine("  PotStats.exe --headless --parent-pid <pid> 挂载形态：无 UI，随父进程退出");
            Console.WriteLine("  PotStats.exe --once                       诊断：只采一拍就退出");
            Console.WriteLine("  PotStats.exe --selftest-ini <文件>        诊断：离线自检 ini 合并逻辑");
            Console.WriteLine();
            Console.WriteLine("选项:");
            Console.WriteLine("  --interval <ms>       采样间隔（默认 1000）");
            Console.WriteLine("  --threshold <秒>      播放满多少秒算一次（默认 10）");
            Console.WriteLine("  --flush <秒>          落盘间隔（默认 30）");
            Console.WriteLine("  --ini-section <名>    ini 段名（默认 PotPlayer）");
            Console.WriteLine("  --no-ini              只发事件不写 ini");
            Console.WriteLine("  --log <路径>          日志文件路径");
            Console.WriteLine("  --verbose             日志同时回显到 stderr");
        }
    }

    /// <summary>
    /// 离线自检：不依赖 PotPlayer 就能验证「读-改-写」是否
    /// 保住了别人的内容、以及计数/时长/首次时间的合并口径。
    /// </summary>
    internal static class SelfTest
    {
        public static int Run(string path, string section)
        {
            Console.WriteLine("== PotStats ini 合并自检 ==");
            Console.WriteLine("目标文件: " + path);

            string original =
                "; 别人的说明行，必须保留\r\n" +
                "[OtherTool]\r\n" +
                "Setting=1\r\n" +
                "\r\n" +
                "[" + section + "]\r\n" +
                "; 手写注释，必须保留\r\n" +
                "PlayCount=2\r\n" +
                "TotalPlaySeconds=100\r\n" +
                "CustomKey=keepme\r\n" +
                "\r\n" +
                "[Trailing]\r\n" +
                "X=9\r\n";

            try
            {
                File.WriteAllText(path, original, new UTF8Encoding(true));
            }
            catch (Exception ex)
            {
                Console.WriteLine("!! 无法写入自检文件: " + ex.Message);
                return 1;
            }

            // 第一轮：某实例播了 5 秒（没到阈值，不该加次数）
            MergeOnce(path, section, 5, 0, "2026-10-05 10:00:00", 5000, 60000);
            // 第二轮：另一个实例播了 30 秒，挣到 +1
            MergeOnce(path, section, 30, 1, "2026-10-05 11:30:00", 30000, 60000);
            // 第三轮：同一实例再播 12 秒（已计过数，不再 +1）
            MergeOnce(path, section, 12, 0, "2026-10-05 11:30:00", 45000, 60000);

            IniRecord rec = StatsStore.Read(path, section);
            string[] lines = File.ReadAllLines(path, Encoding.UTF8);
            string content = string.Join("\n", lines);

            int failures = 0;
            failures += Check("其它 section 保留", content.Contains("[OtherTool]") && content.Contains("Setting=1"));
            failures += Check("尾部 section 保留", content.Contains("[Trailing]") && content.Contains("X=9"));
            failures += Check("我们段内的手写注释保留", content.Contains("; 手写注释，必须保留"));
            failures += Check("我们段内的陌生 key 保留", content.Contains("CustomKey=keepme"));
            failures += Check("顶部说明行保留", content.Contains("; 别人的说明行，必须保留"));
            failures += Check("PlayCount = 3（100→只 +1 一次）", rec.PlayCount == 3);
            failures += Check("TotalPlaySeconds = 147（100+5+30+12）", rec.TotalPlaySeconds == 147);
            failures += Check("FirstOpenTime 只写一次且不被覆盖", rec.FirstOpenTime == "2026-10-05 10:00:00");
            failures += Check("LastOpenTime 取较晚的那个", rec.LastOpenTime == "2026-10-05 11:30:00");
            failures += Check("LastPositionMs 落盘", rec.LastPositionMs == 45000);
            failures += Check("VideoDurationMs 落盘", rec.VideoDurationMs == 60000);
            failures += Check("TotalPlayTime 派生正确（147s → 00:02:27）", content.Contains("TotalPlayTime=00:02:27"));

            Console.WriteLine();
            Console.WriteLine("---- 最终文件内容 ----");
            Console.WriteLine(content);
            Console.WriteLine("----------------------");
            Console.WriteLine(failures == 0 ? "自检通过 ✅" : ("自检失败 ❌ 失败项: " + failures));
            return failures == 0 ? 0 : 1;
        }

        private static void MergeOnce(string path, string section, long addSeconds, long addCount,
            string openedText, long positionMs, long durationMs)
        {
            StatsStore.MergeWrite(path, section, delegate(IniRecord rec)
            {
                rec.PlayCount = rec.PlayCount + addCount;
                rec.TotalPlaySeconds = rec.TotalPlaySeconds + addSeconds;
                if (string.IsNullOrEmpty(rec.FirstOpenTime)) rec.FirstOpenTime = openedText;
                if (string.CompareOrdinal(rec.LastOpenTime, openedText) < 0) rec.LastOpenTime = openedText;
                if (positionMs > 0) rec.LastPositionMs = positionMs;
                if (durationMs > 0) rec.VideoDurationMs = durationMs;
            }, null);
        }

        private static int Check(string name, bool ok)
        {
            Console.WriteLine((ok ? "  [OK]   " : "  [FAIL] ") + name);
            return ok ? 0 : 1;
        }
    }
}
