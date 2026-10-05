/*
 * StatsStore.cs —— {视频名}.ini 的读取与「读-改-写」合并
 *
 * 设计要点：
 *   1. **保留别人的内容**：只动我们自己那一段（默认 `[PotPlayer]`），
 *      文件里其它 section、其它 key、注释一律原样保留；连我们 section 里的
 *      注释和陌生 key 也保留。写之前先读回来再合，不整文件重排。
 *   2. **增量合并**：调用方带着"本次会话的增量"来合，而不是带着"最终值"——
 *      这样同一个视频被两个 PotPlayer 实例同时播放时，两边的时间都会累加进去，
 *      不会被后写的那边覆盖掉。
 *   3. **原子落盘**：先写同目录临时文件再替换，避免写一半断电留下半个 ini。
 *   4. **写不进去就静默失败**：只读盘 / 网络盘 / 无权限都只当没写成，
 *      绝不让统计把播放器或 GGV 带崩。
 */

using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace PotStats
{
    /// <summary>ini 里记录的一条视频统计</summary>
    internal sealed class IniRecord
    {
        public string VideoFile = "";
        public long PlayCount;
        public long TotalPlaySeconds;
        public long VideoDurationMs;
        public long LastPositionMs;
        public string FirstOpenTime = "";
        public string LastOpenTime = "";
        public string UpdatedAt = "";

        public IniRecord Clone()
        {
            IniRecord copy = new IniRecord();
            copy.VideoFile = VideoFile;
            copy.PlayCount = PlayCount;
            copy.TotalPlaySeconds = TotalPlaySeconds;
            copy.VideoDurationMs = VideoDurationMs;
            copy.LastPositionMs = LastPositionMs;
            copy.FirstOpenTime = FirstOpenTime;
            copy.LastOpenTime = LastOpenTime;
            copy.UpdatedAt = UpdatedAt;
            return copy;
        }
    }

    internal static class StatsStore
    {
        public const string DEFAULT_SECTION = "PotPlayer";

        /// <summary>我们负责写入的 key（其余内容一律保留）</summary>
        private static readonly string[] ManagedKeys =
        {
            "VideoFile", "PlayCount", "TotalPlaySeconds", "TotalPlayTime",
            "FirstOpenTime", "LastOpenTime", "LastPositionMs", "VideoDurationMs", "UpdatedAt"
        };

        private static readonly UTF8Encoding Utf8WithBom = new UTF8Encoding(true);

        // ===== 路径 =====

        /// <summary>由视频路径推出同目录同名 ini 路径</summary>
        public static string IniPathFor(string videoPath)
        {
            if (string.IsNullOrEmpty(videoPath)) return null;
            string dir;
            string name;
            try
            {
                dir = Path.GetDirectoryName(videoPath);
                name = Path.GetFileNameWithoutExtension(videoPath);
            }
            catch
            {
                return null;
            }
            if (string.IsNullOrEmpty(dir) || string.IsNullOrEmpty(name)) return null;
            return Path.Combine(dir, name + ".ini");
        }

        // ===== 读 =====

        public static IniRecord Read(string iniPath, string section)
        {
            IniRecord rec = new IniRecord();
            string[] lines;
            if (!TryReadLines(iniPath, out lines)) return rec;

            bool inSection = false;
            for (int i = 0; i < lines.Length; i++)
            {
                string line = lines[i];
                string trimmed = line.Trim();
                if (trimmed.Length == 0) continue;

                if (trimmed[0] == '[')
                {
                    inSection = IsOurSection(trimmed, section);
                    continue;
                }
                if (!inSection) continue;
                if (trimmed[0] == ';' || trimmed[0] == '#') continue;

                string key, value;
                if (!TrySplitKeyValue(line, out key, out value)) continue;
                ApplyKey(rec, key, value);
            }
            return rec;
        }

        private static void ApplyKey(IniRecord rec, string key, string value)
        {
            switch (key.ToLowerInvariant())
            {
                case "videofile": rec.VideoFile = value; break;
                case "playcount": rec.PlayCount = ParseLong(value, rec.PlayCount); break;
                case "totalplayseconds": rec.TotalPlaySeconds = ParseLong(value, rec.TotalPlaySeconds); break;
                case "firstopentime": rec.FirstOpenTime = value; break;
                case "lastopentime": rec.LastOpenTime = value; break;
                case "lastpositionms": rec.LastPositionMs = ParseLong(value, rec.LastPositionMs); break;
                case "videodurationms": rec.VideoDurationMs = ParseLong(value, rec.VideoDurationMs); break;
                case "updatedat": rec.UpdatedAt = value; break;
                // TotalPlayTime 是给人看的派生值，读的时候忽略（由 TotalPlaySeconds 算）
            }
        }

        // ===== 写（读-改-写）=====

        /// <summary>
        /// 把一条记录合并进 ini 并落盘。
        /// <paramref name="mutate"/> 拿到的是**磁盘上的当前值**（可能已被另一个实例改过），
        /// 改完由本方法写回。
        /// </summary>
        public static bool MergeWrite(string iniPath, string section, Action<IniRecord> mutate, Logger log)
        {
            if (string.IsNullOrEmpty(iniPath)) return false;
            try
            {
                IniRecord current = Read(iniPath, section);
                mutate(current);
                current.UpdatedAt = FmtTime(DateTime.Now);

                string[] original;
                if (!TryReadLines(iniPath, out original)) original = new string[0];

                string[] output = Rebuild(original, section, current);
                return AtomicWrite(iniPath, output, log);
            }
            catch (Exception ex)
            {
                if (log != null) log.Warn("写 ini 失败（已忽略）: " + iniPath + " -> " + ex.Message);
                return false;
            }
        }

        /// <summary>把 original 行数组重建成「我们的 section 更新过、其余原样」的新行数组</summary>
        private static string[] Rebuild(string[] original, string section, IniRecord rec)
        {
            List<string> managed = BuildManagedLines(rec);
            List<string> result = new List<string>();

            string header = "[" + section + "]";
            int sectionStart = -1;
            int sectionEnd = original.Length;

            for (int i = 0; i < original.Length; i++)
            {
                string trimmed = original[i].Trim();
                if (trimmed.Length > 0 && trimmed[0] == '[')
                {
                    if (sectionStart < 0)
                    {
                        if (IsOurSection(trimmed, section)) sectionStart = i;
                    }
                    else
                    {
                        // 我们 section 的结束位置 = 下一个 section 头
                        sectionEnd = i;
                        break;
                    }
                }
            }

            if (sectionStart < 0)
            {
                // 没有我们的 section：整份原样保留，末尾追加
                result.AddRange(original);
                // 末尾补一个空行做分隔（原文件非空时）
                if (result.Count > 0 && result[result.Count - 1].Trim().Length != 0) result.Add("");
                result.Add(header);
                result.AddRange(managed);
                return result.ToArray();
            }

            // 我们 section 之前的内容原样
            for (int i = 0; i < sectionStart; i++) result.Add(original[i]);
            result.Add(header);
            result.AddRange(managed);

            // 保留我们 section 里"非我们管理的"内容（注释 / 陌生 key / 空行）
            for (int i = sectionStart + 1; i < sectionEnd; i++)
            {
                string line = original[i];
                string trimmed = line.Trim();
                if (trimmed.Length == 0) continue;
                if (trimmed[0] == ';' || trimmed[0] == '#')
                {
                    result.Add(line);
                    continue;
                }
                string key, value;
                if (TrySplitKeyValue(line, out key, out value) && !IsManagedKey(key))
                {
                    result.Add(line);
                }
            }

            // 我们 section 之后的内容原样；衔接处补一个空行，别把下一个 section 头贴上
            if (sectionEnd < original.Length &&
                result.Count > 0 && result[result.Count - 1].Trim().Length != 0)
            {
                string next = original[sectionEnd].Trim();
                if (next.Length > 0 && next[0] == '[') result.Add("");
            }
            for (int i = sectionEnd; i < original.Length; i++) result.Add(original[i]);

            return result.ToArray();
        }

        private static List<string> BuildManagedLines(IniRecord rec)
        {
            List<string> lines = new List<string>();
            lines.Add("VideoFile=" + rec.VideoFile);
            lines.Add("PlayCount=" + rec.PlayCount);
            lines.Add("TotalPlaySeconds=" + rec.TotalPlaySeconds);
            lines.Add("TotalPlayTime=" + FormatDuration(rec.TotalPlaySeconds));
            lines.Add("FirstOpenTime=" + rec.FirstOpenTime);
            lines.Add("LastOpenTime=" + rec.LastOpenTime);
            lines.Add("LastPositionMs=" + rec.LastPositionMs);
            lines.Add("VideoDurationMs=" + rec.VideoDurationMs);
            lines.Add("UpdatedAt=" + rec.UpdatedAt);
            return lines;
        }

        // ===== 落盘 =====

        private static bool AtomicWrite(string iniPath, string[] lines, Logger log)
        {
            string tmpPath = iniPath + ".potstats.tmp";
            try
            {
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < lines.Length; i++)
                {
                    sb.Append(lines[i]);
                    sb.Append("\r\n");
                }
                File.WriteAllText(tmpPath, sb.ToString(), Utf8WithBom);

                if (File.Exists(iniPath))
                {
                    try
                    {
                        File.Replace(tmpPath, iniPath, null);
                    }
                    catch
                    {
                        // 某些文件系统不支持 Replace，退化为覆盖拷贝
                        File.Copy(tmpPath, iniPath, true);
                        TryDelete(tmpPath);
                    }
                }
                else
                {
                    File.Move(tmpPath, iniPath);
                }
                return true;
            }
            catch (Exception ex)
            {
                TryDelete(tmpPath);
                if (log != null) log.Warn("落盘失败（已忽略）: " + iniPath + " -> " + ex.Message);
                return false;
            }
        }

        private static void TryDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); }
            catch { /* 忽略 */ }
        }

        // ===== 小工具 =====

        private static bool TryReadLines(string iniPath, out string[] lines)
        {
            lines = new string[0];
            try
            {
                if (!File.Exists(iniPath)) return false;
                // StreamReader 会自动识别 BOM（UTF-8 / UTF-16）
                lines = File.ReadAllLines(iniPath, Encoding.UTF8);
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static bool IsOurSection(string trimmedLine, string section)
        {
            int close = trimmedLine.IndexOf(']');
            if (close < 0) return false;
            string name = trimmedLine.Substring(1, close - 1).Trim();
            return string.Equals(name, section, StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsManagedKey(string key)
        {
            for (int i = 0; i < ManagedKeys.Length; i++)
            {
                if (string.Equals(ManagedKeys[i], key, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        private static bool TrySplitKeyValue(string line, out string key, out string value)
        {
            key = "";
            value = "";
            int eq = line.IndexOf('=');
            if (eq <= 0) return false;
            key = line.Substring(0, eq).Trim();
            value = line.Substring(eq + 1).Trim();
            return key.Length > 0;
        }

        private static long ParseLong(string text, long fallback)
        {
            long v;
            if (long.TryParse(text, out v)) return v;
            return fallback;
        }

        public static string FmtTime(DateTime dt)
        {
            return dt.ToString("yyyy-MM-dd HH:mm:ss");
        }

        public static string FormatDuration(long seconds)
        {
            if (seconds < 0) seconds = 0;
            long h = seconds / 3600;
            long m = (seconds % 3600) / 60;
            long s = seconds % 60;
            return string.Format("{0:00}:{1:00}:{2:00}", h, m, s);
        }
    }
}
