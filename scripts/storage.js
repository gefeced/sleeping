/* storage.js
   All localStorage read/write lives here.
   Data is stored as JSON with a small schema and safe defaults.
*/

(function () {
  "use strict";

  const SleepApp = (window.SleepApp = window.SleepApp || {});

  const RELEASE_MARKER = "Sleepoid v1.3";
  const PREFIX = "sleepTracker.v1.";
  const MAIN_KEY = "sleepoid_data";
  const BACKUP_KEY = "sleepoid_data_backup";
  const SCHEMA_VERSION = 1;
  const MAX_SESSION_MINUTES = 24 * 60;

  const KEYS = {
    sessions: PREFIX + "sessions",
    activeSession: PREFIX + "activeSession",
    goals: PREFIX + "goals",
    schedule: PREFIX + "schedule",
    streak: PREFIX + "streak",
    ui: PREFIX + "ui",
    data: MAIN_KEY,
    backup: BACKUP_KEY,
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
    const mainExists = window.localStorage.getItem(MAIN_KEY) !== null;
    const backupExists = window.localStorage.getItem(BACKUP_KEY) !== null;
    if (key === MAIN_KEY || key === BACKUP_KEY) return window.localStorage.getItem(key) !== null;
    if (mainExists || backupExists) return true;
    return window.localStorage.getItem(key) !== null;
  }

  function defaults() {
    return {
      schemaVersion: SCHEMA_VERSION,
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
      settings: {},
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

  function normalizeStreak(value) {
    const fallback = defaults().streak;
    if (!value || typeof value !== "object") return fallback;
    return {
      count: Number.isFinite(Number(value.count)) ? Number(value.count) : fallback.count,
      best: Number.isFinite(Number(value.best)) ? Number(value.best) : fallback.best,
      lastQualifiedDateKey: typeof value.lastQualifiedDateKey === "string" ? value.lastQualifiedDateKey : null,
    };
  }

  function normalizeUI(value) {
    const fallback = defaults().ui;
    if (!value || typeof value !== "object") return fallback;
    const analyticsView = ["daily", "weekly", "monthly"].includes(value.analyticsView) ? value.analyticsView : fallback.analyticsView;
    return {
      ...fallback,
      ...value,
      analyticsView,
    };
  }

  function normalizeActiveSession(value) {
    if (value === null) return null;
    if (!value || typeof value !== "object") return null;
    if (!value.start || typeof value.start !== "string") return null;
    return {
      ...value,
      id: typeof value.id === "string" && value.id ? value.id : `active-${Date.now().toString(36)}`,
    };
  }

  function toDateKeyLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function dateKeyFromISO(isoString) {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return null;
    return toDateKeyLocal(date);
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

  function normalizeSession(session, index) {
    if (!session || typeof session !== "object") return null;
    if (!session.start || !session.end) return null;
    const times = computeSessionTimes(session.start, session.end);
    if (!times) return null;
    const id = typeof session.id === "string" && session.id ? session.id : `session-${Date.now().toString(36)}-${index}`;
    return {
      ...session,
      id,
      start: times.startDate.toISOString(),
      end: times.endDate.toISOString(),
      durationMs: times.durationMs,
      durationMinutes: times.durationMinutes,
    };
  }

  function sessionsOverlap(a, b) {
    const aStart = new Date(a.start).getTime();
    const aEnd = new Date(a.end).getTime();
    const bStart = new Date(b.start).getTime();
    const bEnd = new Date(b.end).getTime();
    if ([aStart, aEnd, bStart, bEnd].some((t) => Number.isNaN(t))) return false;
    return aStart < bEnd && aEnd > bStart;
  }

  function validateSessionList(sessions) {
    if (!Array.isArray(sessions)) return { ok: false, reason: "Sessions must be a list." };

    const ids = new Set();
    const dateKeys = new Set();
    const normalized = [];

    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i];
      if (!session || typeof session !== "object") return { ok: false, reason: "Invalid session data." };
      if (typeof session.id !== "string" || !session.id) return { ok: false, reason: "Session id is required." };
      if (!session.start || !session.end) return { ok: false, reason: "Session start/end is required." };

      if (ids.has(session.id)) return { ok: false, reason: "Duplicate session IDs are not allowed." };
      ids.add(session.id);

      const times = computeSessionTimes(session.start, session.end);
      if (!times) return { ok: false, reason: "Session duration must be greater than zero." };

      const durationMinutes = Number(session.durationMinutes);
      const durationMs = Number(session.durationMs);
      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return { ok: false, reason: "Invalid duration." };
      if (!Number.isFinite(durationMs) || durationMs <= 0) return { ok: false, reason: "Invalid duration." };
      if (durationMinutes > MAX_SESSION_MINUTES) return { ok: false, reason: "Session duration is unrealistic." };
      if (Math.abs(durationMinutes - times.durationMinutes) > 2) return { ok: false, reason: "Session duration mismatch." };
      if (Math.abs(durationMs - times.durationMs) > 120000) return { ok: false, reason: "Session duration mismatch." };

      if (session.score !== undefined && session.score !== null) {
        const score = Number(session.score);
        if (!Number.isFinite(score) || score < 0 || score > 100) {
          return { ok: false, reason: "Invalid session score." };
        }
      }

      const dateKey = dateKeyFromISO(session.end);
      if (!dateKey) return { ok: false, reason: "Invalid session date." };
      if (dateKeys.has(dateKey)) return { ok: false, reason: "Duplicate session dates are not allowed." };
      dateKeys.add(dateKey);

      normalized.push({ ...session, start: times.startDate.toISOString(), end: times.endDate.toISOString() });
    }

    const sorted = normalized.slice().sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    for (let i = 1; i < sorted.length; i++) {
      if (sessionsOverlap(sorted[i - 1], sorted[i])) return { ok: false, reason: "Sessions cannot overlap." };
    }

    return { ok: true };
  }

  function normalizeSessions(rawSessions) {
    if (!Array.isArray(rawSessions)) return [];
    return rawSessions.map((session, index) => normalizeSession(session, index) || session);
  }

  function normalizeDataStructure(raw) {
    const base = defaults();
    return {
      schemaVersion: SCHEMA_VERSION,
      sessions: normalizeSessions(raw?.sessions),
      goals: normalizeGoals(raw?.goals),
      schedule: normalizeScheduleState(raw?.schedule),
      streak: normalizeStreak(raw?.streak),
      activeSession: normalizeActiveSession(raw?.activeSession),
      ui: normalizeUI(raw?.ui),
      settings: raw?.settings && typeof raw.settings === "object" ? raw.settings : base.settings,
    };
  }

  function validateAppData(data) {
    if (!data || typeof data !== "object") return { ok: false, reason: "Data is missing." };
    if (!Number.isFinite(Number(data.schemaVersion))) return { ok: false, reason: "Missing schema version." };
    if (!Array.isArray(data.sessions)) return { ok: false, reason: "Sessions must be an array." };
    if (!data.goals || typeof data.goals !== "object") return { ok: false, reason: "Goals are missing." };
    if (!data.schedule || typeof data.schedule !== "object") return { ok: false, reason: "Schedule is missing." };
    if (!data.streak || typeof data.streak !== "object") return { ok: false, reason: "Streak is missing." };
    if (!data.ui || typeof data.ui !== "object") return { ok: false, reason: "UI state is missing." };
    if (data.activeSession !== null && data.activeSession !== undefined && typeof data.activeSession !== "object") {
      return { ok: false, reason: "Active session is invalid." };
    }
    if (data.settings !== undefined && typeof data.settings !== "object") {
      return { ok: false, reason: "Settings are invalid." };
    }

    return validateSessionList(data.sessions);
  }

  function validateData(data) {
    return validateAppData(data).ok;
  }

  function isLegacyLike(raw) {
    if (!raw || typeof raw !== "object") return false;
    if (!Array.isArray(raw.sessions)) return false;
    return Boolean(raw.goals || raw.schedule || raw.streak || raw.ui || raw.activeSession || raw.sessions);
  }

  function migrateAppData(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (Number.isFinite(Number(raw.schemaVersion))) return normalizeDataStructure(raw);
    if (isLegacyLike(raw)) {
      return normalizeDataStructure({ ...defaults(), ...raw, schemaVersion: SCHEMA_VERSION });
    }
    return null;
  }

  function notifySaveStatus(ok, message = "") {
    window.dispatchEvent(new CustomEvent("sleepapp:saveStatus", { detail: { ok, message } }));
  }

  function notifyDataWarning(message) {
    window.dispatchEvent(new CustomEvent("sleepapp:dataWarning", { detail: { message } }));
  }

  function writeBackup(data) {
    try {
      window.localStorage.setItem(BACKUP_KEY, JSON.stringify(data));
    } catch {
      // no-op
    }
  }

  function attemptWrite(serialized) {
    try {
      window.localStorage.setItem(MAIN_KEY, serialized);
      return true;
    } catch {
      return false;
    }
  }

  function verifiedWrite(serialized) {
    const wrote = attemptWrite(serialized);
    const readBack = safeParseJSON(window.localStorage.getItem(MAIN_KEY));
    if (wrote && validateData(readBack)) {
      writeBackup(readBack);
      notifySaveStatus(true);
      return true;
    }

    const retried = attemptWrite(serialized);
    const retryRead = safeParseJSON(window.localStorage.getItem(MAIN_KEY));
    if (retried && validateData(retryRead)) {
      writeBackup(retryRead);
      notifySaveStatus(true);
      return true;
    }

    const backup = safeParseJSON(window.localStorage.getItem(BACKUP_KEY));
    if (backup && validateData(backup)) {
      try {
        window.localStorage.setItem(MAIN_KEY, JSON.stringify(backup));
      } catch {
        // no-op
      }
    }
    notifySaveStatus(false, "Sleep not saved yet");
    return false;
  }

  function loadFromLegacyKeys() {
    const legacyKeys = [KEYS.sessions, KEYS.activeSession, KEYS.goals, KEYS.schedule, KEYS.streak, KEYS.ui];
    const hasLegacy = legacyKeys.some((k) => window.localStorage.getItem(k) !== null);
    if (!hasLegacy) return null;

    const base = defaults();
    return normalizeDataStructure({
      schemaVersion: SCHEMA_VERSION,
      sessions: readJSON(KEYS.sessions, base.sessions),
      activeSession: readJSON(KEYS.activeSession, base.activeSession),
      goals: readJSON(KEYS.goals, base.goals),
      schedule: readJSON(KEYS.schedule, base.schedule),
      streak: readJSON(KEYS.streak, base.streak),
      ui: readJSON(KEYS.ui, base.ui),
      settings: base.settings,
    });
  }

  let cachedData = null;
  let lastGoodData = null;
  let loadFailed = false;

  function loadAppData() {
    const rawMain = safeParseJSON(window.localStorage.getItem(MAIN_KEY));
    if (rawMain && Number.isFinite(Number(rawMain.schemaVersion))) {
      if (validateData(rawMain)) {
        const upgradedMain = normalizeDataStructure(rawMain);
        cachedData = upgradedMain;
        lastGoodData = upgradedMain;
        return cachedData;
      }
    } else if (isLegacyLike(rawMain)) {
      const upgradedMain = normalizeDataStructure({ ...defaults(), ...rawMain, schemaVersion: SCHEMA_VERSION });
      if (validateData(upgradedMain)) {
        cachedData = upgradedMain;
        lastGoodData = upgradedMain;
        verifiedWrite(JSON.stringify(upgradedMain));
        return cachedData;
      }
    }

    const rawBackup = safeParseJSON(window.localStorage.getItem(BACKUP_KEY));
    if (rawBackup && validateData(rawBackup)) {
      const upgradedBackup = normalizeDataStructure(rawBackup);
      cachedData = upgradedBackup;
      lastGoodData = upgradedBackup;
      return cachedData;
    }
    if (isLegacyLike(rawBackup)) {
      const upgradedBackup = normalizeDataStructure({ ...defaults(), ...rawBackup, schemaVersion: SCHEMA_VERSION });
      if (validateData(upgradedBackup)) {
        cachedData = upgradedBackup;
        lastGoodData = upgradedBackup;
        return cachedData;
      }
    }

    const legacy = loadFromLegacyKeys();
    if (legacy && validateData(legacy)) {
      cachedData = legacy;
      lastGoodData = legacy;
      verifiedWrite(JSON.stringify(legacy));
      return cachedData;
    }

    loadFailed = true;
    cachedData = normalizeDataStructure(defaults());
    notifyDataWarning("Sleep data could not be loaded.");
    return cachedData;
  }

  function saveAppData(nextData) {
    const normalized = migrateAppData(nextData);
    if (!normalized) {
      notifySaveStatus(false, "Sleep not saved yet");
      return false;
    }

    const validation = validateAppData(normalized);
    if (!validation.ok) {
      notifySaveStatus(false, validation.reason || "Sleep not saved yet");
      return false;
    }

    cachedData = normalized;
    const ok = verifiedWrite(JSON.stringify(normalized));
    if (ok) lastGoodData = normalized;
    return ok;
  }

  function getData() {
    if (!cachedData) loadAppData();
    return cachedData;
  }

  function getGoals() {
    const data = getData();
    return normalizeGoals(data.goals);
  }
  function setGoals(goals) {
    const data = getData();
    saveAppData({ ...data, goals: normalizeGoals(goals) });
  }

  function getSchedule() {
    const data = getData();
    return normalizeScheduleState(data.schedule);
  }
  function setSchedule(schedule) {
    const data = getData();
    saveAppData({ ...data, schedule: normalizeScheduleState(schedule) });
  }

  function getStreak() {
    const data = getData();
    return normalizeStreak(data.streak);
  }
  function setStreak(streak) {
    const data = getData();
    saveAppData({ ...data, streak: normalizeStreak(streak) });
  }

  function getSessions() {
    const data = getData();
    return Array.isArray(data.sessions) ? data.sessions : defaults().sessions;
  }
  function setSessions(sessions) {
    const data = getData();
    if (!Array.isArray(sessions)) return false;
    return saveAppData({ ...data, sessions });
  }

  function getActiveSession() {
    const data = getData();
    return data.activeSession ?? defaults().activeSession;
  }
  function setActiveSession(activeSession) {
    const data = getData();
    saveAppData({ ...data, activeSession: normalizeActiveSession(activeSession) });
  }

  function getUI() {
    const data = getData();
    return normalizeUI(data.ui);
  }
  function setUI(ui) {
    const data = getData();
    saveAppData({ ...data, ui: normalizeUI(ui) });
  }

  function getAllData() {
    const data = getData();
    return JSON.parse(JSON.stringify(normalizeDataStructure(data)));
  }

  function setAllData(data) {
    return saveAppData(migrateAppData(data));
  }

  function getSaveState() {
    return { loadFailed, lastGoodData };
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
    getAllData,
    setAllData,
    getSaveState,
    validateData,
    validateAppData,
    migrateAppData,
    loadAppData,
    saveAppData,
  };
})();
