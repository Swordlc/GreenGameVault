/*
 * Logger.cs —— 日志落盘 + NDJSON 事件输出 + 极简 JSON 转义
 *
 * 日志策略：
 *   - 优先写调用方给的路径；写不了就退到 %LOCALAPPDATA%\PotStats\；再不行就只走控制台。
 *   - 单文件超过 5MB 时启动即重开，避免无限增长。
 *   - 任何日志失败都不能影响统计本身。
 *
 * 事件策略（挂载形态给 GGV 消费）：
 *   - 一行一条 JSON（NDJSON）写到 stdout，便于主进程按行解析。
 */

using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace PotStats
{
    internal static class Json
    {
        public static string Escape(string text)
        {
            if (text == null) return "";
            StringBuilder sb = new StringBuilder(text.Length + 8);
            for (int i = 0; i < text.Length; i++)
            {
                char c = text[i];
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.ToString();
        }

        public static string Str(string key, string value)
        {
            return ",\"" + key + "\":\"" + Escape(value) + "\"";
        }

        public static string Num(string key, long value)
        {
            return ",\"" + key + "\":" + value;
        }
    }

    internal sealed class Logger
    {
        private readonly object _gate = new object();
        private readonly bool _echo;
        private StreamWriter _writer;
        private string _path;

        private const long MAX_LOG_BYTES = 5 * 1024 * 1024;

        public Logger(string requestedPath, bool echoStdout)
        {
            _echo = echoStdout;
            _path = ResolveWritablePath(requestedPath);
            if (_path == null) return;
            try
            {
                FileInfo fi = new FileInfo(_path);
                if (fi.Exists && fi.Length > MAX_LOG_BYTES) File.Delete(_path);
                FileStream fs = new FileStream(_path, FileMode.Append, FileAccess.Write, FileShare.Read);
                _writer = new StreamWriter(fs, new UTF8Encoding(false));
                _writer.AutoFlush = true;
            }
            catch
            {
                _writer = null;
                _path = null;
            }
        }

        public string LogPath { get { return _path; } }

        private static string ResolveWritablePath(string requested)
        {
            List<string> candidates = new List<string>();
            if (!string.IsNullOrEmpty(requested)) candidates.Add(requested);

            try
            {
                string exeDir = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
                if (!string.IsNullOrEmpty(exeDir)) candidates.Add(Path.Combine(exeDir, "potstats.log"));
            }
            catch { /* 忽略 */ }

            try
            {
                string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                if (!string.IsNullOrEmpty(local)) candidates.Add(Path.Combine(Path.Combine(local, "PotStats"), "potstats.log"));
            }
            catch { /* 忽略 */ }

            for (int i = 0; i < candidates.Count; i++)
            {
                try
                {
                    string path = candidates[i];
                    string dir = Path.GetDirectoryName(path);
                    if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
                    // 试写一次确认可写
                    using (FileStream probe = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read))
                    {
                        // 只是探测权限
                    }
                    return path;
                }
                catch { /* 换下一个 */ }
            }
            return null;
        }

        private void WriteLine(string level, string message)
        {
            string line = string.Format("{0} [{1}] {2}", DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff"), level, message);
            lock (_gate)
            {
                if (_writer != null)
                {
                    try { _writer.WriteLine(line); }
                    catch { /* 磁盘满了之类，忽略 */ }
                }
                if (_echo)
                {
                    try { Console.Error.WriteLine(line); }
                    catch { /* 无控制台，忽略 */ }
                }
            }
        }

        public void Info(string message) { WriteLine("INFO", message); }
        public void Warn(string message) { WriteLine("WARN", message); }

        /// <summary>输出一条 NDJSON 事件到 stdout（挂载形态给 GGV 消费）</summary>
        public void Emit(string jsonBody)
        {
            lock (_gate)
            {
                try
                {
                    Console.Out.WriteLine(jsonBody);
                    Console.Out.Flush();
                }
                catch { /* 管道断了，忽略 */ }
            }
        }
    }
}
