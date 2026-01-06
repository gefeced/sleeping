/* sleepTracker.js
   Start/stop sleep sessions, compute duration, update streak, compute a 0–100 score.
*/

(function () {
  "use strict";

  const SleepApp = (window.SleepApp = window.SleepApp || {});

  function uuid() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function sortSessionsNewestFirst(sessions) {
    return [...sessions].sort((a, b) => new Date(b.end || b.start).getTime() - new Date(a.end || a.start).getTime());
  }

  function getGoalMinutesForDate(date, goals) {
    if (!goals || typeof goals.defaultGoalMinutes !== "number") return 8 * 60;
    const dayIndex = date.getDay(); // 0=Sun

    // v2 goal blocks: first match wins.
    if (goals.version === 2 && Array.isArray(goals.goalBlocks)) {
      for (const block of goals.goalBlocks) {
        if (!block || typeof block !== "object") continue;
        if (!Array.isArray(block.days) || !block.days.includes(dayIndex)) continue;
        const minutes = Number(block.minutes);
        if (Number.isFinite(minutes) && minutes > 0) return Math.round(minutes);
      }
      return goals.defaultGoalMinutes;
    }

    // Legacy per-day overrides.
    if (!goals.perDayEnabled) return goals.defaultGoalMinutes;
    const override = goals.perDayGoalMinutes ? goals.perDayGoalMinutes[String(dayIndex)] : null;
    return typeof override === "number" ? override : goals.defaultGoalMinutes;
  }

  function getSessionDateKey(session) {
    // IMPORTANT: sessions are assigned to the wake-up date (end time).
    if (!session?.end) return null;
    return SleepApp.time.dateKeyFromISO(session.end);
  }

  function computeSessionTimes(startISO, endISO) {
    const startDate = new Date(startISO);
    const endDate = new Date(endISO);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
    const durationMs = endDate.getTime() - startDate.getTime();
    if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
    const durationMinutes = Math.max(1, Math.round(durationMs / 60000));
    return { startDate, endDate, durationMs, durationMinutes };
  }

  function normalizeSchedule(schedule) {
    if (!schedule) return null;
    const bedtimeMinutes = SleepApp.time.parseTimeToMinutes(schedule.bedtime);
    const wakeMinutes = SleepApp.time.parseTimeToMinutes(schedule.wakeTime);
    if (bedtimeMinutes === null || wakeMinutes === null) return null;
    const activeDays = Array.isArray(schedule.activeDays) ? schedule.activeDays : [];
    return { bedtimeMinutes, wakeMinutes, activeDays };
  }

  function pickScheduleForDate(scheduleState, date) {
    if (!scheduleState) return null;
    const day = date.getDay();

    // New v2 format: { schedules: [...] }
    if (Array.isArray(scheduleState.schedules)) {
      const schedules = scheduleState.schedules.filter((s) => s && typeof s === "object");
      const match = schedules.find((s) => Array.isArray(s.activeDays) && s.activeDays.includes(day));
      return match || schedules[0] || null;
    }

    // Old format: { activeDays, bedtime, wakeTime }
    if (typeof scheduleState === "object") return scheduleState;
    return null;
  }

  function computeConsistencyScore(session, scheduleState, goals) {
    // Returns 0–100 (higher is more consistent with schedule).
    if (!session?.start || !session?.end) return null;
    const startDate = new Date(session.start);
    const endDate = new Date(session.end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;

    const scheduleForDay = pickScheduleForDate(scheduleState, endDate);
    const schedule = normalizeSchedule(scheduleForDay);
    if (!schedule) return null;

    const toleranceMinutes = Math.max(0, Number(goals?.toleranceMinutes ?? 45));
    const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
    const endMinutes = endDate.getHours() * 60 + endDate.getMinutes();
    const bedDiff = Math.abs(SleepApp.time.diffMinutesWrap(schedule.bedtimeMinutes, startMinutes));
    const wakeDiff = Math.abs(SleepApp.time.diffMinutesWrap(schedule.wakeMinutes, endMinutes));
    const avgDiff = (bedDiff + wakeDiff) / 2;

    if (avgDiff <= toleranceMinutes) return 100;
    const t = SleepApp.time.clamp((avgDiff - toleranceMinutes) / 180, 0, 1);
    return Math.round(100 - t * 60);
  }

  function computeVariabilityPenalty(recentSessions) {
    const durations = recentSessions
      .map((s) => s.durationMinutes)
      .filter((m) => Number.isFinite(m) && m > 0);
    if (durations.length < 4) return 0;

    const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
    const variance = durations.reduce((acc, d) => acc + (d - mean) * (d - mean), 0) / durations.length;
    const std = Math.sqrt(variance);

    // 0 penalty below 25m, up to 10 penalty at ~90m std dev.
    const t = SleepApp.time.clamp((std - 25) / 65, 0, 1);
    return Math.round(t * 10);
  }

  function computeScore(session, context) {
    const goals = context.goals;
    const scheduleForDay = pickScheduleForDate(context.schedule, new Date(session.end));
    const schedule = normalizeSchedule(scheduleForDay);
    const streak = context.streak;
    const toleranceMinutes = Math.max(0, Number(goals?.toleranceMinutes ?? 45));

    const startDate = new Date(session.start);
    const endDate = new Date(session.end);
    const goalMinutes = getGoalMinutesForDate(endDate, goals);

    const durationMinutes = session.durationMinutes;
    const ratio = goalMinutes > 0 ? durationMinutes / goalMinutes : 0;

    let score = 100;

    // Duration penalty (dominant factor).
    if (ratio < 1) {
      const deficit = 1 - ratio;
      score -= SleepApp.time.clamp(Math.round(deficit * 55), 0, 55);
    } else {
      // Small bonus for slightly exceeding goal; no bonus for massive oversleep.
      const extra = SleepApp.time.clamp(ratio - 1, 0, 0.25);
      score += Math.round(extra * 20);
    }

    // Timing consistency vs schedule.
    if (schedule) {
      const endDay = endDate.getDay();
      const applies = schedule.activeDays.includes(endDay);
      if (applies) {
        const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
        const endMinutes = endDate.getHours() * 60 + endDate.getMinutes();
        const bedDiff = Math.abs(SleepApp.time.diffMinutesWrap(schedule.bedtimeMinutes, startMinutes));
        const wakeDiff = Math.abs(SleepApp.time.diffMinutesWrap(schedule.wakeMinutes, endMinutes));
        const avgDiff = (bedDiff + wakeDiff) / 2;

        if (avgDiff <= toleranceMinutes) score += 5;
        else {
          // Up to 15 penalty when very far from schedule.
          const t = SleepApp.time.clamp((avgDiff - toleranceMinutes) / 180, 0, 1);
          score -= Math.round(t * 15);
        }
      }
    }

    // Variability penalty (last few sessions).
    score -= computeVariabilityPenalty(context.recentSessions || []);

    // Streak bonus.
    const streakCount = Number(streak?.count ?? 0);
    score += Math.round(SleepApp.time.clamp(streakCount * 1.5, 0, 10));

    // Gentle floor/ceiling.
    score = SleepApp.time.clamp(Math.round(score), 0, 100);

    let label = "—";
    let color = "neutral";
    if (score >= 80) {
      label = "Great";
      color = "good";
    } else if (score >= 65) {
      label = "Okay";
      color = "okay";
    } else {
      label = "Poor";
      color = "poor";
    }

    return { score, label, color, goalMinutes, toleranceMinutes };
  }

  function qualifiesForStreak(session, goals) {
    const endDate = new Date(session.end);
    const goalMinutes = getGoalMinutesForDate(endDate, goals);
    const toleranceMinutes = Math.max(0, Number(goals?.toleranceMinutes ?? 45));
    return session.durationMinutes >= Math.max(0, goalMinutes - toleranceMinutes);
  }

  function updateStreakOnSession(session, goals) {
    const store = SleepApp.storage;
    const streak = store.getStreak();
    const qualifies = qualifiesForStreak(session, goals);
    if (!qualifies) {
      // Reset only if this session is for a later day (avoid nuking the streak when logging naps).
      const dateKey = SleepApp.time.dateKeyFromISO(session.end);
      if (dateKey && streak.lastQualifiedDateKey && dateKey !== streak.lastQualifiedDateKey) {
        streak.count = 0;
      }
      store.setStreak(streak);
      return streak;
    }

    const dateKey = SleepApp.time.dateKeyFromISO(session.end);
    if (!dateKey) return streak;

    if (streak.lastQualifiedDateKey === dateKey) return streak; // already counted today

    if (streak.lastQualifiedDateKey) {
      const last = new Date(streak.lastQualifiedDateKey + "T00:00:00");
      const current = new Date(dateKey + "T00:00:00");
      const diffDays = Math.round((current - last) / 86400000);
      streak.count = diffDays === 1 ? streak.count + 1 : 1;
    } else {
      streak.count = 1;
    }

    streak.lastQualifiedDateKey = dateKey;
    streak.best = Math.max(streak.best || 0, streak.count);
    store.setStreak(streak);
    return streak;
  }

  function startSleeping() {
    const store = SleepApp.storage;
    const active = store.getActiveSession();
    if (active && active.start) return active;

    const now = new Date();
    const nextActive = {
      id: uuid(),
      start: now.toISOString(),
    };
    store.setActiveSession(nextActive);

    window.dispatchEvent(new CustomEvent("sleepapp:activeSessionChanged", { detail: { activeSession: nextActive } }));
    return nextActive;
  }

  function buildProposedSessionFromActive({ endDate = new Date(), overrideDurationMinutes = null } = {}) {
    const store = SleepApp.storage;
    const active = store.getActiveSession();
    if (!active?.start) return null;

    const start = new Date(active.start);
    if (Number.isNaN(start.getTime())) return null;
    let end = endDate instanceof Date ? endDate : new Date();

    if (overrideDurationMinutes !== null && Number.isFinite(Number(overrideDurationMinutes))) {
      const minutes = Math.max(1, Math.round(Number(overrideDurationMinutes)));
      end = new Date(start.getTime() + minutes * 60000);
    }

    if (end <= start) end = new Date(start.getTime() + 60000);

    const durationMs = end.getTime() - start.getTime();
    const durationMinutes = Math.max(1, Math.round(durationMs / 60000));

    return {
      id: active.id || uuid(),
      start: start.toISOString(),
      end: end.toISOString(),
      durationMs,
      durationMinutes,
    };
  }

  function recomputeStreakAndScores(sessions) {
    const store = SleepApp.storage;
    const goals = store.getGoals();
    const schedule = store.getSchedule();

    const withIds = (sessions || []).map((s) => {
      if (!s || typeof s !== "object") return s;
      return { ...s, id: typeof s.id === "string" && s.id ? s.id : uuid() };
    });

    const completed = withIds
      .filter((s) => s?.start && s?.end)
      .map((s) => {
        const times = computeSessionTimes(s.start, s.end);
        if (!times) return null;
        return {
          ...s,
          start: times.startDate.toISOString(),
          end: times.endDate.toISOString(),
          durationMs: times.durationMs,
          durationMinutes: times.durationMinutes,
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(a.end).getTime() - new Date(b.end).getTime());

    const dayInfo = new Map(); // dateKey -> { qualifies:boolean, sessions:[] }
    for (const s of completed) {
      const key = getSessionDateKey(s);
      if (!key) continue;
      const info = dayInfo.get(key) || { qualifies: false, sessions: [] };
      info.sessions.push(s);
      if (!info.qualifies) info.qualifies = qualifiesForStreak(s, goals);
      dayInfo.set(key, info);
    }

    const dayKeys = [...dayInfo.keys()].sort();
    const dayStreakCount = new Map();
    let currentCount = 0;
    let best = 0;
    let lastQualifiedDateKey = null;
    let prevDate = null;

    for (const key of dayKeys) {
      const qualifies = Boolean(dayInfo.get(key)?.qualifies);
      const currentDate = new Date(key + "T00:00:00");
      const diffDays = prevDate ? Math.round((currentDate - prevDate) / 86400000) : null;

      if (qualifies) {
        if (diffDays === 1) currentCount += 1;
        else currentCount = 1;
        lastQualifiedDateKey = key;
      } else {
        currentCount = 0;
      }

      dayStreakCount.set(key, currentCount);
      best = Math.max(best, currentCount);
      prevDate = currentDate;
    }

    // Score recompute in chronological order with a rolling "recent durations" window.
    const recentWindow = [];
    const scored = completed.map((s) => {
      const key = getSessionDateKey(s);
      const streakCount = key ? dayStreakCount.get(key) || 0 : 0;
      const scoreResult = computeScore(
        { start: s.start, end: s.end, durationMinutes: s.durationMinutes },
        {
          goals,
          schedule,
          streak: { count: streakCount },
          recentSessions: recentWindow.slice(-12),
        },
      );
      recentWindow.push({ durationMinutes: s.durationMinutes });
      return { ...s, score: scoreResult.score };
    });

    const streak = {
      count: lastQualifiedDateKey ? dayStreakCount.get(lastQualifiedDateKey) || 0 : 0,
      best,
      lastQualifiedDateKey,
    };
    store.setStreak(streak);

    // Merge recomputed fields back into the original list (keep any extra fields).
    const byId = new Map(scored.map((s) => [s.id, s]));
    return {
      sessions: withIds.map((s) => (byId.has(s.id) ? { ...s, ...byId.get(s.id) } : s)),
      streak,
    };
  }

  function saveCompletedSession(session) {
    const store = SleepApp.storage;
    const sessions = store.getSessions();
    const nextSessions = [...sessions, session];
    const recalced = recomputeStreakAndScores(nextSessions);
    store.setSessions(recalced.sessions);
    store.setActiveSession(null);

    window.dispatchEvent(new CustomEvent("sleepapp:sessionSaved", { detail: { session } }));
    window.dispatchEvent(new CustomEvent("sleepapp:sessionsChanged", { detail: { sessions: recalced.sessions } }));
    window.dispatchEvent(new CustomEvent("sleepapp:activeSessionChanged", { detail: { activeSession: null } }));
    return { saved: true, session: { ...session }, streak: recalced.streak };
  }

  function stopSleeping() {
    const session = buildProposedSessionFromActive({ endDate: new Date() });
    if (!session) return { saved: false, reason: "No active session." };
    return saveCompletedSession(session);
  }

  function updateSessionTimes(sessionId, { startISO, endISO }) {
    const store = SleepApp.storage;
    const sessions = store.getSessions();
    const idx = sessions.findIndex((s) => s?.id === sessionId);
    if (idx < 0) return { ok: false, reason: "Session not found." };

    const next = { ...sessions[idx] };
    if (typeof startISO === "string") next.start = startISO;
    if (typeof endISO === "string") next.end = endISO;
    const times = computeSessionTimes(next.start, next.end);
    if (!times) return { ok: false, reason: "End time must be after start time." };
    next.durationMs = times.durationMs;
    next.durationMinutes = times.durationMinutes;

    const nextSessions = sessions.slice();
    nextSessions[idx] = next;
    const recalced = recomputeStreakAndScores(nextSessions);
    store.setSessions(recalced.sessions);

    window.dispatchEvent(new CustomEvent("sleepapp:sessionsChanged", { detail: { sessions: recalced.sessions } }));
    return { ok: true, streak: recalced.streak };
  }

  function deleteSession(sessionId) {
    const store = SleepApp.storage;
    const sessions = store.getSessions();
    const nextSessions = sessions.filter((s) => s?.id !== sessionId);
    if (nextSessions.length === sessions.length) return { ok: false, reason: "Session not found." };

    const recalced = recomputeStreakAndScores(nextSessions);
    store.setSessions(recalced.sessions);

    window.dispatchEvent(new CustomEvent("sleepapp:sessionsChanged", { detail: { sessions: recalced.sessions } }));
    return { ok: true, streak: recalced.streak };
  }

  function getLatestCompletedSession() {
    const sessions = SleepApp.storage.getSessions();
    const completed = sessions.filter((s) => s && s.start && s.end);
    if (completed.length === 0) return null;
    return sortSessionsNewestFirst(completed)[0];
  }

  function getTodaysCompletedSession() {
    const todayKey = SleepApp.time.toDateKeyLocal(new Date());
    const sessions = SleepApp.storage.getSessions().filter((s) => s && s.end);
    const todays = sessions.filter((s) => SleepApp.time.dateKeyFromISO(s.end) === todayKey);
    if (todays.length === 0) return null;
    return sortSessionsNewestFirst(todays)[0];
  }

  function getTodaysSummary() {
    const todayKey = SleepApp.time.toDateKeyLocal(new Date());
    const sessions = SleepApp.storage
      .getSessions()
      .filter((s) => s?.start && s?.end && SleepApp.time.dateKeyFromISO(s.end) === todayKey);
    if (sessions.length === 0) return null;

    let totalMs = 0;
    let firstStart = null;
    let lastEnd = null;
    for (const s of sessions) {
      const start = new Date(s.start);
      const end = new Date(s.end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
      totalMs += Math.max(0, end.getTime() - start.getTime());
      if (!firstStart || start < firstStart) firstStart = start;
      if (!lastEnd || end > lastEnd) lastEnd = end;
    }

    if (!firstStart || !lastEnd || totalMs <= 0) return null;
    return { totalMs, firstStartISO: firstStart.toISOString(), lastEndISO: lastEnd.toISOString() };
  }

  function getHomeSummary() {
    const store = SleepApp.storage;
    const goals = store.getGoals();
    const schedule = store.getSchedule();
    const streak = store.getStreak();
    const todaySession = getTodaysCompletedSession();
    const todaySummary = getTodaysSummary();
    const latest = todaySession || getLatestCompletedSession();

    const summary = {
      todaySession,
      todaySummary,
      latestSession: latest,
      streak,
      score: null,
      scoreLabel: "—",
      scoreColor: "neutral",
    };

    if (latest?.end && Number.isFinite(latest.score)) {
      const color = latest.score >= 80 ? "good" : latest.score >= 65 ? "okay" : "poor";
      summary.score = latest.score;
      summary.scoreLabel = latest.score >= 80 ? "Great" : latest.score >= 65 ? "Okay" : "Poor";
      summary.scoreColor = color;
    } else if (latest?.end) {
      const scoreResult = computeScore(
        {
          start: latest.start,
          end: latest.end,
          durationMinutes: latest.durationMinutes,
        },
        {
          goals,
          schedule,
          streak,
          recentSessions: sortSessionsNewestFirst(store.getSessions()).slice(0, 12),
        },
      );
      summary.score = scoreResult.score;
      summary.scoreLabel = scoreResult.label;
      summary.scoreColor = scoreResult.color;
    }

    return summary;
  }

  SleepApp.sleepTracker = {
    getGoalMinutesForDate,
    getSessionDateKey,
    computeSessionTimes,
    computeScore,
    computeConsistencyScore,
    startSleeping,
    buildProposedSessionFromActive,
    saveCompletedSession,
    stopSleeping,
    updateSessionTimes,
    deleteSession,
    recomputeStreakAndScores,
    getLatestCompletedSession,
    getTodaysCompletedSession,
    getTodaysSummary,
    getHomeSummary,
    qualifiesForStreak,
  };
})();
