/*
 * PotIpc.cs —— PotPlayer 官方 IPC 客户端（窗口消息）
 *
 * 协议来源：PotPlayer 开发者在 Daum 官方 cafe 发布的 SDK
 *           https://m.cafe.daum.net/pot-tool/N88T/6   (InternalSimpleCmd.h, 2023-08-29 更新)
 *
 * 实测结论（2026-10-05 本机验证）：
 *   - 22 个顶层窗口里**只有 1 个**真正处理该协议，其窗口类名为 `PotPlayer64`
 *     （32 位版为 `PotPlayer`）；其余窗口（tooltips_class32 / Afx: / FilterGraphWindow /
 *     PotShadowWnd / IME …）要么返回 0、要么直接不响应。
 *     ⇒ 所以本客户端**按窗口类名锁定实例**，绝不能按"有返回值"判断。
 *   - 某些窗口对 SendMessage 会**永久挂起**，因此一律使用 SendMessageTimeout。
 *   - 取字符串（POT_GET_PLAYFILE_NAME）必须自备回传窗口，播放器会以
 *     SendMessage(回传HWND, WM_COPYDATA, ...) 把 UTF-8 字符串送回来。
 */

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace PotStats
{
    /// <summary>一个 PotPlayer 实例（= 一个 IPC 主窗口）</summary>
    internal sealed class PotInstance
    {
        public IntPtr Hwnd;
        public int Pid;
        public string Title = "";
        public string HwndHex = "";
    }

    internal static class PotIpc
    {
        // ===== PotPlayer 官方 IPC 常量（InternalSimpleCmd.h）=====
        public const int POT_COMMAND = 0x0400;            // WM_USER
        public const int POT_GET_VOLUME = 0x5000;         // 0 ~ 100
        public const int POT_GET_TOTAL_TIME = 0x5002;     // ms
        public const int POT_GET_CURRENT_TIME = 0x5004;   // ms
        public const int POT_GET_PLAY_STATUS = 0x5006;    // 0:Stopped 1:Paused 2:Running
        public const int POT_GET_PLAYFILE_NAME = 0x6020;  // 字符串，经 WM_COPYDATA 回传

        public const int WM_COPYDATA = 0x004A;
        private const uint SMTO_ABORTIFHUNG = 0x0002;
        private const int SEND_TIMEOUT_MS = 800;
        private const int REPLY_WAIT_MS = 500;

        /// <summary>播放状态</summary>
        public const long STATUS_STOPPED = 0;
        public const long STATUS_PAUSED = 1;
        public const long STATUS_RUNNING = 2;

        /// <summary>承载该协议的窗口类名（64 位 / 32 位）</summary>
        private static readonly string[] IpcWindowClasses = { "PotPlayer64", "PotPlayer" };

        // ===== Win32 =====

        [StructLayout(LayoutKind.Sequential)]
        private struct COPYDATASTRUCT
        {
            public IntPtr dwData;
            public int cbData;
            public IntPtr lpData;
        }

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SendMessageTimeout(IntPtr hWnd, int Msg, IntPtr wParam,
            IntPtr lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);

        // ===== 回传窗口（接收 WM_COPYDATA）=====

        private sealed class ReplyWindow : Form
        {
            private volatile int _lastMsg;
            private volatile string _lastData = "";

            // 用属性而不是公开字段：MarshalByRefObject 子类的字段访问会触发 CS1690
            public int LastMsg { get { return _lastMsg; } }
            public string LastData { get { return _lastData; } }

            public ReplyWindow()
            {
                FormBorderStyle = FormBorderStyle.None;
                ShowInTaskbar = false;
                StartPosition = FormStartPosition.Manual;
                Location = new System.Drawing.Point(-32000, -32000);
                Size = new System.Drawing.Size(1, 1);
                if (Handle == IntPtr.Zero) throw new InvalidOperationException("无法创建 IPC 回传窗口");
            }

            // 永不真正显示
            protected override void SetVisibleCore(bool value)
            {
                base.SetVisibleCore(false);
            }

            public void Reset()
            {
                _lastMsg = 0;
                _lastData = "";
            }

            public void RequestQuit()
            {
                try
                {
                    BeginInvoke((MethodInvoker)delegate { Application.ExitThread(); });
                }
                catch
                {
                    Application.ExitThread();
                }
            }

            protected override void WndProc(ref Message m)
            {
                if (m.Msg == WM_COPYDATA)
                {
                    COPYDATASTRUCT cds = (COPYDATASTRUCT)Marshal.PtrToStructure(m.LParam, typeof(COPYDATASTRUCT));
                    _lastMsg = cds.dwData.ToInt32();
                    if (cds.cbData > 0 && cds.lpData != IntPtr.Zero)
                    {
                        byte[] buf = new byte[cds.cbData];
                        Marshal.Copy(cds.lpData, buf, 0, cds.cbData);
                        _lastData = Encoding.UTF8.GetString(buf);
                    }
                    else
                    {
                        _lastData = "";
                    }
                }
                base.WndProc(ref m);
            }
        }

        private static ReplyWindow s_reply;

        /// <summary>建回传窗口（必须在将要跑消息循环的那个线程上调用）</summary>
        public static void EnsureReplyWindow()
        {
            if (s_reply == null) s_reply = new ReplyWindow();
        }

        public static void ResetReply()
        {
            if (s_reply != null) s_reply.Reset();
        }

        /// <summary>请求退出消息循环（会自动回到正确的线程上执行）</summary>
        public static void RequestQuit()
        {
            if (s_reply != null) s_reply.RequestQuit();
            else Application.ExitThread();
        }

        // ===== 查询 =====

        /// <summary>查询一个数值命令。返回 false = 该窗口不响应（超时或失败）</summary>
        public static bool Query(IntPtr hwnd, int cmd, out long value)
        {
            IntPtr result;
            IntPtr ok = SendMessageTimeout(hwnd, POT_COMMAND, (IntPtr)cmd, IntPtr.Zero,
                SMTO_ABORTIFHUNG, SEND_TIMEOUT_MS, out result);
            value = result.ToInt64();
            return ok != IntPtr.Zero;
        }

        /// <summary>查询当前播放文件（完整路径）。失败返回 ""</summary>
        public static string QueryPlayingFile(IntPtr hwnd)
        {
            if (s_reply == null) return "";
            s_reply.Reset();

            IntPtr result;
            IntPtr ok = SendMessageTimeout(hwnd, POT_COMMAND, (IntPtr)POT_GET_PLAYFILE_NAME,
                s_reply.Handle, SMTO_ABORTIFHUNG, SEND_TIMEOUT_MS, out result);
            if (ok == IntPtr.Zero) return "";

            // 回传是在消息循环线程上异步发生的，这里等它落地
            int waited = 0;
            while (waited < REPLY_WAIT_MS)
            {
                if (s_reply.LastMsg != 0) return s_reply.LastData;
                Thread.Sleep(10);
                waited += 10;
            }
            return "";
        }

        // ===== 实例发现 =====

        /// <summary>
        /// 枚举所有 PotPlayer 的 IPC 实例（按窗口类名锁定，与"是否响应"无关）。
        /// 多开时每个实例各得一条。
        /// </summary>
        public static List<PotInstance> FindInstances()
        {
            List<PotInstance> found = new List<PotInstance>();

            EnumWindows(delegate(IntPtr h, IntPtr l)
            {
                string cls = ReadClassName(h);
                if (!IsIpcWindowClass(cls)) return true;

                int pid;
                GetWindowThreadProcessId(h, out pid);
                if (pid == 0) return true;

                // 类名已经很专有，但仍核对一次进程名，避免撞上第三方同名窗口
                if (!IsPotPlayerProcess(pid)) return true;

                PotInstance item = new PotInstance();
                item.Hwnd = h;
                item.Pid = pid;
                item.Title = ReadWindowText(h);
                item.HwndHex = "0x" + h.ToInt64().ToString("X");
                found.Add(item);
                return true;
            }, IntPtr.Zero);

            return found;
        }

        private static bool IsIpcWindowClass(string cls)
        {
            for (int i = 0; i < IpcWindowClasses.Length; i++)
            {
                if (string.Equals(cls, IpcWindowClasses[i], StringComparison.Ordinal)) return true;
            }
            return false;
        }

        private static bool IsPotPlayerProcess(int pid)
        {
            try
            {
                string name = Process.GetProcessById(pid).ProcessName;
                return name.IndexOf("PotPlayer", StringComparison.OrdinalIgnoreCase) >= 0;
            }
            catch
            {
                return false;
            }
        }

        private static string ReadClassName(IntPtr h)
        {
            StringBuilder sb = new StringBuilder(256);
            GetClassName(h, sb, sb.Capacity);
            return sb.ToString();
        }

        private static string ReadWindowText(IntPtr h)
        {
            StringBuilder sb = new StringBuilder(512);
            GetWindowText(h, sb, sb.Capacity);
            return sb.ToString();
        }
    }
}
