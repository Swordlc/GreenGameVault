/*
 * PlaybackTracker.cs —— 每个 PotPlayer 实例一个独立状态机
 *
 * 一个「会话」= 一次打开某个视频。规则（主人 2026-10-05 定的口径）：
 *   - **播放次数**：本次会话里"真正在播"的累计时长 ≥ 阈值（默认 10s）才 +1，
 *     且每个会话最多 +1 一次（防拖进度条/误点刷次数）。
 *   - **累计播放时长**：只在 PLAY_STATUS == Running(2) 时累加，
 *     暂停(1)/停止(0) 一秒都不算。
 *   - **最后打开时间**：每次开会话取当前时间；同一会话内不重复刷。
 *   - **首次打开时间**：只在 ini 里为空时写入，天然收敛、永不覆盖。
 *
 * 累加用的是**真实墙钟增量**并设了上限（2× 采样间隔）：
 * 机器休眠 / 进程被挂起时不会把那段空白时间算成观看。
 *
 * 重播识别：同一个文件播完后按重播，路径不变 → 靠
 * 「连续若干拍都是 Stopped，之后又回到 Running」判定为新会话
 * （用连续拍数做防抖，避免 seek / 缓冲瞬间的假 Stopped 把次数灌爆）。
 */

using System;
using System.Collections.Generic;
using System.IO;

namespace PotStats
{
    internal sealed class TrackerOptions
    {
        public int IntervalMs = 1000;
        public int ThresholdSeconds = 10;
        public int FlushSeconds = 30;
        public int ReplayStoppedTicks = 3;
        public string IniSection = StatsStore.DEFAULT_SECTION;
        public bool WriteIni = true;
    }

    /// <summary>一次「打开」</summary>
    internal sealed class Session
    {
        public string VideoPath = "";
        public string IniPath = "";
        public DateTime OpenedAt = DateTime.Now;

        /// <summary>本会话累计"真正在播"的毫秒</summary>
        public long SessionMs;

        /// <summary>已经按整秒落盘过的毫秒（余数留下次，避免每次落盘丢零头）</summary>
        public long WrittenMs;

        /// <summary>本会话是否已经挣到 +1</summary>
        public bool Counted;

        /// <summary>挣到的那次 +1 是否已经写进 ini</summary>
        public bool WrittenCount;

        public long LastPositionMs;
        public long DurationMs;

        /// <summary>本会话是否已经往 ini 里写过东西（没写过且时长为 0 → 不建文件）</summary>
        public bool EverWritten;
    }

    internal sealed class InstanceTracker
    {
        public PotInstance Instance;
        public Session Current;
        public int ConsecutiveStoppedTicks;
        public long LastTickMs;
        public long LastFlushMs;
    }

    internal sealed class TrackerEngine
    {
        private readonly TrackerOptions _opt;
        private readonly Logger _log;
        private readonly Dictionary<long, InstanceTracker> _trackers = new Dictionary<long, InstanceTracker>();
        private long _lastSignature = -1;

        public TrackerEngine(TrackerOptions opt, Logger log)
        {
            _opt = opt;
            _log = log;
        }

        public int ActiveSessions
        {
            get
            {
                int n = 0;
                foreach (KeyValuePair<long, InstanceTracker> kv in _trackers)
                {
                    if (kv.Value.Current != null) n++;
                }
                return n;
            }
        }

        private static long NowMs()
        {
            return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        }

        // ===== 主循环的一拍 =====

        public void Tick()
        {
            long nowMs = NowMs();
            List<PotInstance> instances = PotIpc.FindInstances();

            HashSet<long> alive = new HashSet<long>();
            for (int i = 0; i < instances.Count; i++) alive.Add(instances[i].Hwnd.ToInt64());

            // 消失的实例：先把会话结掉并落盘
            List<long> goneKeys = new List<long>();
            foreach (KeyValuePair<long, InstanceTracker> kv in _trackers)
            {
                if (!alive.Contains(kv.Key)) goneKeys.Add(kv.Key);
            }
            for (int i = 0; i < goneKeys.Count; i++)
            {
                InstanceTracker t = _trackers[goneKeys[i]];
                FlushSession(t, "instance-gone");
                _trackers.Remove(goneKeys[i]);
                _log.Info("PotPlayer 实例已退出: 0x" + goneKeys[i].ToString("X"));
            }

            long signature = BuildSignature(alive);
            if (signature != _lastSignature)
            {
                _lastSignature = signature;
                EmitScan(instances.Count);
                _log.Info("当前 PotPlayer 实例数: " + instances.Count);
            }

            for (int i = 0; i < instances.Count; i++)
            {
                long key = instances[i].Hwnd.ToInt64();
                InstanceTracker tracker;
                if (!_trackers.TryGetValue(key, out tracker))
                {
                    tracker = new InstanceTracker();
                    tracker.LastTickMs = nowMs;
                    _trackers[key] = tracker;
                    _log.Info("发现 PotPlayer 实例: " + instances[i].HwndHex + " pid=" + instances[i].Pid);
                }
                tracker.Instance = instances[i];
                TickInstance(tracker, nowMs);
            }
        }

        private static long BuildSignature(HashSet<long> alive)
        {
            long sum = 0;
            foreach (long key in alive) sum += key;
            return alive.Count * 1000003L + sum;
        }

        private void TickInstance(InstanceTracker tracker, long nowMs)
        {
            IntPtr hwnd = tracker.Instance.Hwnd;

            long status;
            bool okStatus = PotIpc.Query(hwnd, PotIpc.POT_GET_PLAY_STATUS, out status);
            if (!okStatus)
            {
                // 这一拍拿不到状态（窗口忙/正在退出）：不累计时间，也不改任何状态
                tracker.LastTickMs = nowMs;
                return;
            }

            long position = 0;
            PotIpc.Query(hwnd, PotIpc.POT_GET_CURRENT_TIME, out position);
            long duration = 0;
            PotIpc.Query(hwnd, PotIpc.POT_GET_TOTAL_TIME, out duration);

            string path = PotIpc.QueryPlayingFile(hwnd);

            bool running = status == PotIpc.STATUS_RUNNING;
            bool localFile = IsLocalMediaFile(path);

            // ---- 会话切换：换成另一个文件了 ----
            if (tracker.Current != null && localFile &&
                !SamePath(tracker.Current.VideoPath, path))
            {
                FlushSession(tracker, "switch");
                tracker.Current = null;
                tracker.ConsecutiveStoppedTicks = 0;
            }

            // ---- 重播：同一个文件，停了若干拍又跑起来 ----
            if (tracker.Current != null && localFile &&
                SamePath(tracker.Current.VideoPath, path))
            {
                if (status == PotIpc.STATUS_STOPPED)
                {
                    tracker.ConsecutiveStoppedTicks++;
                }
                else
                {
                    if (status == PotIpc.STATUS_RUNNING &&
                        tracker.ConsecutiveStoppedTicks >= _opt.ReplayStoppedTicks)
                    {
                        FlushSession(tracker, "replay");
                        StartSession(tracker, path, nowMs);
                    }
                    tracker.ConsecutiveStoppedTicks = 0;
                }
            }

            // ---- 开新会话 ----
            if (tracker.Current == null && localFile)
            {
                StartSession(tracker, path, nowMs);
            }

            // ---- 累计时长 / 计数 / 周期落盘 ----
            if (tracker.Current != null)
            {
                if (running)
                {
                    long delta = nowMs - tracker.LastTickMs;
                    if (delta < 0) delta = 0;
                    long cap = (long)_opt.IntervalMs * 2;
                    if (delta > cap) delta = cap;   // 休眠 / 挂起不留灌水口子
                    tracker.Current.SessionMs += delta;
                    tracker.Current.LastPositionMs = position;
                    if (duration > 0) tracker.Current.DurationMs = duration;
                }

                if (!tracker.Current.Counted &&
                    tracker.Current.SessionMs >= (long)_opt.ThresholdSeconds * 1000L)
                {
                    tracker.Current.Counted = true;
                    FlushSession(tracker, "counted");
                    tracker.LastFlushMs = nowMs;
                }

                if (tracker.LastFlushMs == 0) tracker.LastFlushMs = nowMs;
                if (nowMs - tracker.LastFlushMs >= (long)_opt.FlushSeconds * 1000L)
                {
                    FlushSession(tracker, "interval");
                    tracker.LastFlushMs = nowMs;
                }
            }

            tracker.LastTickMs = nowMs;
        }

        private static bool SamePath(string a, string b)
        {
            return string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>只统计本地文件：URL / 直播没有「同目录」，跳过</summary>
        private static bool IsLocalMediaFile(string path)
        {
            if (string.IsNullOrEmpty(path)) return false;
            if (path.IndexOf("://", StringComparison.Ordinal) >= 0) return false;
            try
            {
                return Path.IsPathRooted(path);
            }
            catch
            {
                return false;
            }
        }

        private void StartSession(InstanceTracker tracker, string path, long nowMs)
        {
            Session s = new Session();
            s.VideoPath = path;
            s.IniPath = StatsStore.IniPathFor(path);
            s.OpenedAt = DateTime.Now;
            tracker.Current = s;
            tracker.ConsecutiveStoppedTicks = 0;
            tracker.LastFlushMs = nowMs;
            _log.Info("开始会话: " + path);
        }

        // ===== 落盘 =====

        public void FlushAll(string reason)
        {
            foreach (KeyValuePair<long, InstanceTracker> kv in _trackers)
            {
                FlushSession(kv.Value, reason);
            }
        }

        private void FlushSession(InstanceTracker tracker, string reason)
        {
            Session s = tracker.Current;
            if (s == null) return;

            long wholeSeconds = (s.SessionMs - s.WrittenMs) / 1000;
            long addCount = (s.Counted && !s.WrittenCount) ? 1 : 0;

            // 没有任何增量：不写盘、不发事件（避免把「只是加载了没播」的文件也建成 ini）
            if (wholeSeconds <= 0 && addCount == 0) return;

            long reportPlayCount;
            long reportTotalSeconds;
            long reportFirstOpenMs;
            string firstOpenTime;

            if (_opt.WriteIni && !string.IsNullOrEmpty(s.IniPath))
            {
                long capturedCount = 0;
                long capturedTotal = 0;
                string capturedFirst = "";
                string openedText = StatsStore.FmtTime(s.OpenedAt);
                string videoName = "";
                try { videoName = Path.GetFileName(s.VideoPath); }
                catch { videoName = s.VideoPath; }

                Session snapshot = s;
                bool ok = StatsStore.MergeWrite(s.IniPath, _opt.IniSection, delegate(IniRecord rec)
                {
                    rec.VideoFile = videoName;
                    rec.PlayCount = rec.PlayCount + addCount;
                    rec.TotalPlaySeconds = rec.TotalPlaySeconds + wholeSeconds;
                    if (string.IsNullOrEmpty(rec.FirstOpenTime)) rec.FirstOpenTime = openedText;
                    if (string.CompareOrdinal(rec.LastOpenTime, openedText) < 0) rec.LastOpenTime = openedText;
                    if (snapshot.LastPositionMs > 0) rec.LastPositionMs = snapshot.LastPositionMs;
                    if (snapshot.DurationMs > 0) rec.VideoDurationMs = snapshot.DurationMs;
                    capturedCount = rec.PlayCount;
                    capturedTotal = rec.TotalPlaySeconds;
                    capturedFirst = rec.FirstOpenTime;
                }, _log);

                if (!ok)
                {
                    // 写不进去（只读盘 / 网络盘 / 无权限）：不推进任何"已写"游标，下次再试
                    return;
                }

                s.WrittenMs += wholeSeconds * 1000;
                s.WrittenCount = s.Counted;
                s.EverWritten = true;

                reportPlayCount = capturedCount;
                reportTotalSeconds = capturedTotal;
                firstOpenTime = capturedFirst;
            }
            else
            {
                s.WrittenMs += wholeSeconds * 1000;
                s.WrittenCount = s.Counted;
                s.EverWritten = true;
                reportPlayCount = addCount;
                reportTotalSeconds = s.WrittenMs / 1000;
                firstOpenTime = StatsStore.FmtTime(s.OpenedAt);
            }

            reportFirstOpenMs = ParseLocalTimeMs(firstOpenTime, s.OpenedAt);

            EmitSession(s, reason, reportPlayCount, reportTotalSeconds,
                reportFirstOpenMs, s.OpenedAt, wholeSeconds, addCount);

            _log.Info(string.Format("落盘 {0}: 次数={1} 累计={2}s (+{3}s, +{4}次)",
                Path.GetFileName(s.VideoPath), reportPlayCount, reportTotalSeconds, wholeSeconds, addCount));

            // 会话结束后不再持有
            if (reason == "switch" || reason == "instance-gone" || reason == "replay" || reason == "exit")
            {
                tracker.Current = null;
            }
        }

        private void EmitScan(int instanceCount)
        {
            string json = "{\"t\":\"scan\""
                + Json.Num("instances", instanceCount)
                + Json.Num("at", NowMs())
                + "}";
            _log.Emit(json);
        }

        private void EmitSession(Session s, string reason, long playCount, long totalSeconds,
            long firstOpenMs, DateTime openedAt, long addedSeconds, long addedCount)
        {
            string json = "{\"t\":\"session\""
                + Json.Str("path", s.VideoPath)
                + Json.Str("reason", reason)
                + Json.Num("playCount", playCount)
                + Json.Num("totalSeconds", totalSeconds)
                + Json.Num("addedSeconds", addedSeconds)
                + Json.Num("addedCount", addedCount)
                + Json.Num("openTimeMs", ToEpochMs(openedAt))
                + Json.Num("firstOpenMs", firstOpenMs)
                + Json.Num("lastPositionMs", s.LastPositionMs)
                + Json.Num("durationMs", s.DurationMs)
                + (s.DurationMs > 0 ? Json.Num("progressPermille", s.LastPositionMs * 1000L / s.DurationMs) : "")
                + Json.Num("at", NowMs())
                + "}";
            _log.Emit(json);
        }

        internal static long ToEpochMs(DateTime local)
        {
            return (long)(local.ToUniversalTime() - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        }

        private static long ParseLocalTimeMs(string text, DateTime fallback)
        {
            if (!string.IsNullOrEmpty(text))
            {
                DateTime parsed;
                if (DateTime.TryParse(text, out parsed)) return ToEpochMs(parsed);
            }
            return ToEpochMs(fallback);
        }
    }
}
