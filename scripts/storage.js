/* storage.js
   All localStorage read/write lives here.
   Data is stored as JSON with a small schema and safe defaults.
*/

(function () {
  "use strict";

  const SleepApp = (window.SleepApp = window.SleepApp || {});

  const PREFIX = "sleepTracker.v1.";
  const KEYS = {
    sessions: PREFIX + "sessions",
    activeSession: PREFIX + "activeSession",
    goals: PREFIX + "goals",
    schedule: PREFIX + "schedule",
    streak: PREFIX + "streak",
    ui: PREFIX + "ui",
  };

  function safeParseJSON(text) {
    if (typeof text !== "string" || text.length === 0) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function readJSON(key, fallback) {
    const raw = window.localStorage.getItem(key);
    const parsed = safeParseJSON(raw);
    return parsed === null ? fallback : parsed;
  }

  function writeJSON(key, value) {
    window.localStorage.setItem(key, JSON.stringify(value));
  }

  function remove(key) {
    window.localStorage.removeItem(key);
  }

  function hasKey(key) {
    return window.localStorage.getItem(key) !== null;
  }

  function defaults() {
    return {
      goals: {
        version: 2,
        defaultGoalMinutes: 8 * 60,
        goalBlocks: [], // [{ id, minutes, days:[0..6] }]
        // Legacy fields kept for safe migration.
        perDayEnabled: false,
        perDayGoalMinutes: { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null },
        toleranceMinutes: 45,
      },
      schedule: {
        version: 2,
        activeScheduleId: "default",
        schedules: [
          {
            id: "default",
            name: "Default",
            activeDays: [1, 2, 3, 4, 5], // Mon–Fri
            bedtime: "23:00",
            wakeTime: "07:00",
          },
        ],
      },
      streak: {
        count: 0,
        best: 0,
        lastQualifiedDateKey: null,
      },
      sessions: [],
      activeSession: null,
      ui: {
        analyticsView: "daily",
      },
    };
  }

  function normalizeGoals(value) {
    const fallback = defaults().goals;
    if (!value || typeof value !== "object") return fallback;

    // v2: defaultGoalMinutes + goalBlocks
    if (value.version === 2 && Array.isArray(value.goalBlocks)) {
      const defaultGoalMinutes =
        typeof value.defaultGoalMinutes === "number" && Number.isFinite(value.defaultGoalMinutes)
          ? value.defaultGoalMinutes
          : fallback.defaultGoalMinutes;
      const toleranceMinutes =
        typeof value.toleranceMinutes === "number" && Number.isFinite(value.toleranceMinutes)
          ? value.toleranceMinutes
          : fallback.toleranceMinutes;

      const goalBlocks = value.goalBlocks
        .filter((b) => b && typeof b === "object")
        .map((b, index) => {
          const id = typeof b.id === "string" && b.id ? b.id : `goal-${index + 1}`;
          const minutes = Number(b.minutes);
          const days = Array.isArray(b.days) ? b.days.filter((d) => Number.isFinite(d) && d >= 0 && d <= 6) : [];
          return {
            id,
            minutes: Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : defaultGoalMinutes,
            days: [...new Set(days)].sort(),
          };
        });

      return {
        ...fallback,
        ...value,
        version: 2,
        defaultGoalMinutes,
        toleranceMinutes: Math.max(0, Math.round(toleranceMinutes)),
        goalBlocks,
      };
    }

    // Legacy: defaultGoalMinutes + perDay map. Convert overrides into goalBlocks.
    const defaultGoalMinutes =
      typeof value.defaultGoalMinutes === "number" && Number.isFinite(value.defaultGoalMinutes)
        ? value.defaultGoalMinutes
        : fallback.defaultGoalMinutes;
    const toleranceMinutes =
      typeof value.toleranceMinutes === "number" && Number.isFinite(value.toleranceMinutes)
        ? value.toleranceMinutes
        : fallback.toleranceMinutes;

    const perDayEnabled = Boolean(value.perDayEnabled);
    const perDay = value.perDayGoalMinutes && typeof value.perDayGoalMinutes === "object" ? value.perDayGoalMinutes : {};

    const buckets = new Map(); // minutes -> days[]
    if (perDayEnabled) {
      for (const day of ["0", "1", "2", "3", "4", "5", "6"]) {
        const minutes = Number(perDay[day]);
        if (!Number.isFinite(minutes)) continue;
        const normalizedMinutes = Math.max(0, Math.round(minutes));
        if (normalizedMinutes === defaultGoalMinutes) continue;
        const arr = buckets.get(normalizedMinutes) || [];
        arr.push(Number(day));
        buckets.set(normalizedMinutes, arr);
      }
    }

    const goalBlocks = [...buckets.entries()].map(([minutes, days], index) => ({
      id: `goal-${index + 1}`,
      minutes,
      days: [...new Set(days)].sort(),
    }));

    return {
      ...fallback,
      ...value,
      version: 2,
      defaultGoalMinutes,
      toleranceMinutes: Math.max(0, Math.round(toleranceMinutes)),
      goalBlocks,
      // Keep legacy fields but disable them to avoid double-application.
      perDayEnabled: false,
      perDayGoalMinutes: { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null },
    };
  }

  function normalizeScheduleState(value) {
    const fallback = defaults().schedule;

    // New format: { version:2, schedules:[...], activeScheduleId }
    if (value && typeof value === "object" && Array.isArray(value.schedules)) {
      const schedules = value.schedules
        .filter((s) => s && typeof s === "object")
        .map((s, index) => {
          const id = typeof s.id === "string" && s.id ? s.id : `schedule-${index + 1}`;
          const name = typeof s.name === "string" && s.name.trim() ? s.name.trim() : `Schedule ${index + 1}`;
          const activeDays = Array.isArray(s.activeDays) ? s.activeDays.filter((d) => Number.isFinite(d)) : [];
          const bedtime = typeof s.bedtime === "string" ? s.bedtime : fallback.schedules[0].bedtime;
          const wakeTime = typeof s.wakeTime === "string" ? s.wakeTime : fallback.schedules[0].wakeTime;
          return { id, name, activeDays, bedtime, wakeTime };
        });

      if (schedules.length === 0) return fallback;
      const activeScheduleId =
        typeof value.activeScheduleId === "string" && schedules.some((s) => s.id === value.activeScheduleId)
          ? value.activeScheduleId
          : schedules[0].id;

      return { version: 2, schedules, activeScheduleId };
    }

    // Old format: { activeDays, bedtime, wakeTime }
    if (value && typeof value === "object") {
      const activeDays = Array.isArray(value.activeDays) ? value.activeDays.filter((d) => Number.isFinite(d)) : [];
      const bedtime = typeof value.bedtime === "string" ? value.bedtime : fallback.schedules[0].bedtime;
      const wakeTime = typeof value.wakeTime === "string" ? value.wakeTime : fallback.schedules[0].wakeTime;
      return {
        version: 2,
        activeScheduleId: "default",
        schedules: [{ id: "default", name: "Default", activeDays, bedtime, wakeTime }],
      };
    }

    return fallback;
  }

  function getGoals() {
    const exists = hasKey(KEYS.goals);
    const raw = readJSON(KEYS.goals, defaults().goals);
    const normalized = normalizeGoals(raw);
    const alreadyV2 = raw && typeof raw === "object" && raw.version === 2 && Array.isArray(raw.goalBlocks);
    if (exists && !alreadyV2) writeJSON(KEYS.goals, normalized);
    return normalized;
  }
  function setGoals(goals) {
    writeJSON(KEYS.goals, normalizeGoals(goals));
  }

  function getSchedule() {
    const raw = readJSON(KEYS.schedule, defaults().schedule);
    const normalized = normalizeScheduleState(raw);
    // Opportunistically migrate older formats into v2 (avoid rewriting already-v2 values).
    const alreadyV2 = raw && typeof raw === "object" && raw.version === 2 && Array.isArray(raw.schedules);
    if (!alreadyV2) writeJSON(KEYS.schedule, normalized);
    return normalized;
  }
  function setSchedule(schedule) {
    writeJSON(KEYS.schedule, normalizeScheduleState(schedule));
  }

  function getStreak() {
    return readJSON(KEYS.streak, defaults().streak);
  }
  function setStreak(streak) {
    writeJSON(KEYS.streak, streak);
  }

  function getSessions() {
    return readJSON(KEYS.sessions, defaults().sessions);
  }
  function setSessions(sessions) {
    writeJSON(KEYS.sessions, sessions);
  }

  function getActiveSession() {
    return readJSON(KEYS.activeSession, defaults().activeSession);
  }
  function setActiveSession(activeSession) {
    if (activeSession === null) remove(KEYS.activeSession);
    else writeJSON(KEYS.activeSession, activeSession);
  }

  function getUI() {
    return readJSON(KEYS.ui, defaults().ui);
  }
  function setUI(ui) {
    writeJSON(KEYS.ui, ui);
  }

  SleepApp.storage = {
    KEYS,
    readJSON,
    writeJSON,
    remove,
    hasKey,
    defaults,
    normalizeGoals,
    normalizeScheduleState,
    getGoals,
    setGoals,
    getSchedule,
    setSchedule,
    getStreak,
    setStreak,
    getSessions,
    setSessions,
    getActiveSession,
    setActiveSession,
    getUI,
    setUI,
  };
})();
