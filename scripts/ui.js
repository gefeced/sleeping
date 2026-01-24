/* ui.js
   Navigation + animations + page bootstrapping + state syncing between modules.
*/

(function () {
  "use strict";

  const SleepApp = (window.SleepApp = window.SleepApp || {});

  function el(id) {
    return document.getElementById(id);
  }

  function ensureSaveWarning() {
    let node = el("saveWarning");
    if (node) return node;
    node = document.createElement("div");
    node.id = "saveWarning";
    node.className = "save-warning";
    node.hidden = true;
    node.textContent = "Sleep not saved yet";
    document.body.append(node);
    return node;
  }

  function setSaveWarningVisible(visible, message = null) {
    const node = ensureSaveWarning();
    if (message) node.textContent = message;
    node.hidden = !visible;
  }

  function isCoarsePointer() {
    return Boolean(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  }

  // Mobile-only subtle haptics (fails silently if not supported).
  function subtleHapticTap(ms = 10) {
    if (!isCoarsePointer()) return;
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
    try {
      navigator.vibrate(Math.max(1, Math.round(Number(ms) || 10)));
    } catch {
      // no-op
    }
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function ensureModalRoot() {
    let root = document.getElementById("modalRoot");
    if (root) return root;

    root = document.createElement("div");
    root.id = "modalRoot";
    root.className = "modal-root";
    root.hidden = true;

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.dataset.role = "backdrop";

    root.append(backdrop);
    document.body.append(root);
    return root;
  }

  function showModal({ title, body, actions, dismissValue = "cancel", dismissible = true, kind = null }) {
    const root = ensureModalRoot();
    root.hidden = false;
    if (typeof kind === "string" && kind) root.dataset.kind = kind;
    else delete root.dataset.kind;
    document.body.classList.toggle("is-info-modal-open", root.dataset.kind === "info");

    // Clear existing modal content but keep backdrop.
    const existing = root.querySelector(".modal");
    if (existing) existing.remove();

    const modal = document.createElement("div");
    modal.className = "modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    const h = document.createElement("h2");
    h.className = "modal__title";
    h.textContent = title || "—";

    const bodyNode = document.createElement("div");
    bodyNode.className = "modal__body";
    if (typeof body === "string") bodyNode.innerHTML = body;
    else if (body) bodyNode.append(body);

    const actionRow = document.createElement("div");
    actionRow.className = "modal__actions";

    const backdrop = root.querySelector('[data-role="backdrop"]');
    let resolveClose = () => {};

    function onBackdropClick(event) {
      if (!dismissible) return;
      if (event.target !== backdrop) return;
      resolveClose(dismissValue);
    }

    function onKeyDown(event) {
      if (event.key === "Escape" && dismissible) {
        event.preventDefault();
        resolveClose(dismissValue);
      }
    }

    function cleanup() {
      backdrop?.removeEventListener("click", onBackdropClick);
      window.removeEventListener("keydown", onKeyDown);
    }

    function close(value) {
      cleanup();
      root.hidden = true;
      delete root.dataset.kind;
      document.body.classList.remove("is-info-modal-open");
      modal.remove();
      return value;
    }

    return new Promise((resolve) => {
      resolveClose = (value) => resolve(close(value));

      for (const a of actions || []) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "button " + (a.variant === "primary" ? "button--primary" : "button--ghost");
        btn.textContent = a.label;
        btn.addEventListener("click", () => {
          const value = typeof a.value === "function" ? a.value() : a.value;
          resolveClose(value);
        });
        actionRow.append(btn);
      }

      modal.append(h, bodyNode, actionRow);
      root.append(modal);

      backdrop?.addEventListener("click", onBackdropClick);
      window.addEventListener("keydown", onKeyDown);

      // Focus the first action button for keyboard users.
      const firstButton = actionRow.querySelector("button");
      if (firstButton) firstButton.focus();
    });
  }

  function formatMinutesAsHM(totalMinutes) {
    const m = Math.max(0, Math.round(Number(totalMinutes) || 0));
    const h = Math.floor(m / 60);
    const mins = m % 60;
    if (h <= 0) return `${mins}m`;
    if (mins === 0) return `${h}h`;
    return `${h}h ${mins}m`;
  }

  function setBadge(node, variant, text) {
    if (!node) return;
    node.classList.remove("badge--good", "badge--okay", "badge--poor", "badge--neutral");
    node.classList.add(`badge--${variant || "neutral"}`);
    node.textContent = text || "—";
  }

  SleepApp.ui = {
    showModal,
  };

  function setScoreUI({ score, label, color }) {
    const scoreValue = el("scoreValue");
    const scoreLabel = el("scoreLabel");
    if (!scoreValue || !scoreLabel) return;

    scoreValue.textContent = score === null || score === undefined ? "--" : String(score);
    scoreLabel.textContent = label || "—";

    scoreValue.classList.remove("score--good", "score--okay", "score--poor", "score--neutral");
    scoreValue.classList.add(`score--${color || "neutral"}`);
  }

  function setOverallScoreUI({ score, label, color }) {
    const scoreValue = el("overallScoreValue");
    const scoreLabel = el("overallScoreLabel");
    if (!scoreValue || !scoreLabel) return;

    scoreValue.textContent = score === null || score === undefined ? "--" : String(score);
    scoreLabel.textContent = label || "—";

    scoreValue.classList.remove("score--good", "score--okay", "score--poor", "score--neutral");
    scoreValue.classList.add(`score--${color || "neutral"}`);
  }

  function renderDayStrip() {
    const strip = el("dayStrip");
    if (!strip) return;
    const labels = [
      { key: 1, short: "Mon" },
      { key: 2, short: "Tue" },
      { key: 3, short: "Wed" },
      { key: 4, short: "Thu" },
      { key: 5, short: "Fri" },
      { key: 6, short: "Sat" },
      { key: 0, short: "Sun" },
    ];
    const today = new Date();
    const todayKey = SleepApp.time.toDateKeyLocal(today);
    const todayDay = today.getDay();
    const sessions = SleepApp.storage.getSessions().filter((s) => s?.end);
    const hasSleepToday = sessions.some((s) => (SleepApp.sleepTracker.getSessionDateKey(s) || SleepApp.time.dateKeyFromISO(s.end)) === todayKey);

    strip.innerHTML = "";
    for (const d of labels) {
      const item = document.createElement("div");
      item.className = "day" + (d.key === todayDay ? " is-today" : "") + (d.key === todayDay && hasSleepToday ? " has-sleep" : "");
      const dot = document.createElement("div");
      dot.className = "day__dot";
      const lab = document.createElement("div");
      lab.className = "day__label";
      lab.textContent = d.short;
      item.append(dot, lab);
      strip.append(item);
    }
  }

  function renderLastNightVsGoal() {
    const badge = el("compareBadge");
    const goalNode = el("compareGoal");
    const lastNode = el("compareLast");
    const diffNode = el("compareDiff");
    if (!badge || !goalNode || !lastNode || !diffNode) return;

    const store = SleepApp.storage;
    const latest = SleepApp.sleepTracker.getLatestCompletedSession();
    const goals = store.getGoals();

    if (!latest?.end || !Number.isFinite(latest.durationMinutes)) {
      setBadge(badge, "neutral", "No data");
      goalNode.textContent = "—";
      lastNode.textContent = "—";
      diffNode.textContent = "—";
      return;
    }

    const wakeDate = new Date(latest.end);
    const goalMinutes = SleepApp.sleepTracker.getGoalMinutesForDate(wakeDate, goals);
    const lastMinutes = Number(latest.durationMinutes);
    const diffMinutes = Math.round(lastMinutes - goalMinutes);

    goalNode.textContent = formatMinutesAsHM(goalMinutes);
    lastNode.textContent = formatMinutesAsHM(lastMinutes);
    diffNode.textContent = `${diffMinutes >= 0 ? "+" : ""}${diffMinutes}m`;

    const shortfall = goalMinutes - lastMinutes;
    if (shortfall <= 0) setBadge(badge, "good", "Met goal");
    else if (shortfall <= 30) setBadge(badge, "okay", "Close");
    else setBadge(badge, "poor", "Below");
  }

  function renderHome() {
    const store = SleepApp.storage;
    const active = store.getActiveSession();
    const summary = SleepApp.sleepTracker.getHomeSummary();

    const clockNode = el("clock");
    if (clockNode) SleepApp.time.startLiveClock(clockNode);

    const todaySummary = el("todaySummary");
    if (todaySummary) {
      const today = summary.todaySummary;
      if (!today) todaySummary.textContent = "No session yet";
      else {
        const duration = SleepApp.time.formatDuration(today.totalMs);
        const start = SleepApp.time.formatTimeFromISO(today.firstStartISO);
        const end = SleepApp.time.formatTimeFromISO(today.lastEndISO);
        todaySummary.textContent = `${duration} • ${start} – ${end}`;
      }
    }

    setScoreUI({
      score: summary.score,
      label: summary.scoreLabel,
      color: summary.scoreColor,
    });
    setOverallScoreUI({
      score: summary.overallScore,
      label: summary.overallScoreLabel,
      color: summary.overallScoreColor,
    });

    const streakCount = el("streakCount");
    if (streakCount) streakCount.textContent = String(summary.streak?.count ?? 0);

    const button = el("sleepButton");
    const buttonText = el("sleepButtonText");
    const buttonSubtext = el("sleepButtonSubtext");
    const activeHint = el("activeHint");
    const activeStartTime = el("activeStartTime");

    const isSleeping = Boolean(active?.start);
    if (button) button.classList.toggle("is-sleeping", isSleeping);
    if (buttonText) buttonText.textContent = isSleeping ? "Stop Sleeping" : "Start Sleeping";
    if (buttonSubtext) buttonSubtext.textContent = isSleeping ? "Tap when you wake up" : "Tap to record";
    if (activeHint) activeHint.hidden = !isSleeping;
    if (activeStartTime && active?.start) activeStartTime.textContent = SleepApp.time.formatTimeFromISO(active.start);

    const mini = el("miniGraph");
    if (mini) SleepApp.graphs.renderMiniGraph(mini);

    renderDayStrip();
    renderLastNightVsGoal();
  }

  function attachHomeHandlers() {
    const button = el("sleepButton");
    if (!button) return;

    button.addEventListener("click", async () => {
      const active = SleepApp.storage.getActiveSession();
      if (active?.start) {
        const startTime = SleepApp.time.formatTimeFromISO(active.start);
        const now = new Date();
        const start = new Date(active.start);
        const durationMs = now.getTime() - start.getTime();
        const durationMinutes = Math.max(1, Math.round(durationMs / 60000));

        const stopChoice = await showModal({
          title: "Stop sleeping?",
          body: `
            <div>Started: <strong>${startTime}</strong></div>
            <div>Current duration: <strong>${formatMinutesAsHM(durationMinutes)}</strong></div>
          `,
          actions: [
            { label: "Cancel", value: "cancel", variant: "ghost" },
            { label: "Stop", value: "stop", variant: "primary" },
          ],
        });
        if (stopChoice !== "stop") return;

        let proposed = SleepApp.sleepTracker.buildProposedSessionFromActive({ endDate: now });
        if (!proposed) return;

        const isShort = proposed.durationMinutes < 120;
        const isLong = proposed.durationMinutes > 16 * 60;
        if (isShort || isLong) {
          const wrap = document.createElement("div");
          wrap.className = "field";

          const warn = document.createElement("div");
          warn.className = "muted";
          warn.textContent = isShort
            ? "This looks unusually short. You can edit the duration or confirm anyway."
            : "This looks unusually long. You can edit the duration or confirm anyway.";

          const grid = document.createElement("div");
          grid.className = "form-grid";

          const hoursField = document.createElement("div");
          hoursField.className = "field";
          const hoursLabel = document.createElement("label");
          hoursLabel.className = "label";
          hoursLabel.textContent = "Hours";
          const hoursInput = document.createElement("input");
          hoursInput.className = "input";
          hoursInput.type = "number";
          hoursInput.min = "0";
          hoursInput.max = "24";
          hoursInput.step = "1";
          hoursInput.inputMode = "numeric";
          hoursInput.value = String(Math.floor(proposed.durationMinutes / 60));
          hoursField.append(hoursLabel, hoursInput);

          const minsField = document.createElement("div");
          minsField.className = "field";
          const minsLabel = document.createElement("label");
          minsLabel.className = "label";
          minsLabel.textContent = "Minutes";
          const minsInput = document.createElement("input");
          minsInput.className = "input";
          minsInput.type = "number";
          minsInput.min = "0";
          minsInput.max = "59";
          minsInput.step = "5";
          minsInput.inputMode = "numeric";
          minsInput.value = String(proposed.durationMinutes % 60);
          minsField.append(minsLabel, minsInput);

          grid.append(hoursField, minsField);
          wrap.append(warn, grid);

          const edited = await showModal({
            title: "Check duration",
            body: wrap,
            actions: [
              { label: "Cancel", value: { action: "cancel" }, variant: "ghost" },
              {
                label: "Confirm",
                variant: "primary",
                value: () => {
                  const h = Math.max(0, Math.round(Number(hoursInput.value || 0)));
                  const m = Math.max(0, Math.round(Number(minsInput.value || 0)));
                  return { action: "confirm", minutes: h * 60 + m };
                },
              },
            ],
          });

          if (!edited || edited.action !== "confirm") return;
          const minutes = Math.max(1, Math.round(Number(edited.minutes || 0)));
          proposed = SleepApp.sleepTracker.buildProposedSessionFromActive({
            endDate: now,
            overrideDurationMinutes: minutes,
          });
          if (!proposed) return;
        }

        const result = SleepApp.sleepTracker.saveCompletedSession(proposed);
        if (result.saved) {
          subtleHapticTap(10);
          button.classList.add("did-stop");
          window.setTimeout(() => button.classList.remove("did-stop"), 350);
          renderHome();
        } else {
          setSaveWarningVisible(true, result.reason || "Sleep not saved yet");
        }
      } else {
        // Always confirm on start (with an optional note).
        // Safety check: if starting 3+ hours before scheduled bedtime, show a gentle heads-up.
        const store = SleepApp.storage;
        const hasSchedule = store.hasKey(store.KEYS.schedule);
        let shouldConfirm = false;
        let bedtimeText = null;
        if (hasSchedule) {
          const scheduleState = store.getSchedule();
          const now = new Date();
          const day = now.getDay();
          const schedules = Array.isArray(scheduleState.schedules) ? scheduleState.schedules : [];
          const match = schedules.find((s) => Array.isArray(s.activeDays) && s.activeDays.includes(day));
          const schedule = match || null;
          const bedtimeMinutes = SleepApp.time.parseTimeToMinutes(schedule?.bedtime);
          if (bedtimeMinutes !== null) {
            const nowMinutes = now.getHours() * 60 + now.getMinutes();
            const minutesUntilBed = SleepApp.time.durationBetweenMinutes(nowMinutes, bedtimeMinutes);
            // Treat >12h as "bedtime already passed" rather than "very early".
            if (minutesUntilBed >= 180 && minutesUntilBed <= 12 * 60) {
              shouldConfirm = true;
              bedtimeText = SleepApp.time.minutesToTimeString(bedtimeMinutes);
            }
          }
        }

        const wrap = document.createElement("div");

        const intro = document.createElement("div");
        intro.textContent = "Start sleeping now?";

        const warning = document.createElement("div");
        warning.className = "muted";
        warning.style.marginTop = "10px";
        warning.textContent = shouldConfirm
          ? `This is more than 3 hours before your scheduled bedtime (${bedtimeText}). If this is intentional (early night, nap, travel), you can still log it.`
          : "You can add an optional note. It will be saved to this session and shown in History.";

        const noteField = document.createElement("div");
        noteField.className = "field";
        noteField.style.marginTop = "12px";

        const noteInput = document.createElement("textarea");
        noteInput.className = "input";
        noteInput.placeholder = "Optional note";
        noteInput.maxLength = 140;
        noteInput.rows = 2;
        noteInput.autocomplete = "off";
        noteInput.autocapitalize = "sentences";
        noteInput.spellcheck = true;
        noteInput.setAttribute("aria-label", "Optional note");

        noteField.append(noteInput);
        wrap.append(intro, warning, noteField);

        const choice = await showModal({
          title: "Start Sleeping",
          body: wrap,
          actions: [
            { label: "Cancel", value: { action: "cancel" }, variant: "ghost" },
            {
              label: "Start",
              value: () => ({ action: "start", note: String(noteInput.value || "").trim() }),
              variant: "primary",
            },
          ],
        });
        if (!choice || choice.action !== "start") return;

        SleepApp.sleepTracker.startSleeping({ note: choice.note });
        subtleHapticTap(10);
        button.classList.add("did-start");
        window.setTimeout(() => button.classList.remove("did-start"), 350);
        renderHome();
      }
    });
  }

  function normalizeAnalyticsMetric(value, fallback = "duration") {
    if (value === "consistency") return "consistency";
    if (value === "duration") return "duration";
    return fallback === "consistency" ? "consistency" : "duration";
  }

  function getAnalyticsMetricForView(view, uiState) {
    const metric =
      view === "weekly"
        ? normalizeAnalyticsMetric(uiState?.analyticsWeeklyMetric, "duration")
        : view === "monthly"
          ? normalizeAnalyticsMetric(uiState?.analyticsMonthlyMetric, "duration")
          : "duration";
    return metric === "consistency" ? "duration" : metric;
  }

  function renderAnalyticsPage(view, metric) {
    const canvas = el("analyticsCanvas");
    const legend = el("analyticsLegend");
    const sessionsTitle = el("sessionsTitle");
    const sessionsSubtitle = el("sessionsSubtitle");
    const emptyState = el("analyticsEmptyState");
    const sessions = SleepApp.storage.getSessions().filter((s) => s?.start && s?.end);
    const hasSessions = sessions.length > 0;
    const sessionList = el("sessionList");

    SleepApp.graphs.renderAnalyticsSummary(el("analyticsSummary"));

    if (sessionsTitle) sessionsTitle.textContent = "Sessions";
    if (sessionsSubtitle) sessionsSubtitle.textContent = "Most recent sessions (tap to edit).";
    if (emptyState) emptyState.hidden = hasSessions;
    if (sessionList) sessionList.hidden = !hasSessions;

    if (canvas) canvas.hidden = false;
    if (legend) legend.hidden = false;

    const safeMetric = normalizeAnalyticsMetric(metric, "duration");
    if (canvas) SleepApp.graphs.renderAnalytics(canvas, view, safeMetric);
    SleepApp.graphs.renderLegend(view, safeMetric, legend);
    SleepApp.graphs.renderSessionList(sessionList, { limit: 20, sessions });
  }

  function renderHistoryPage(selectedId = null) {
    const list = el("historyList");
    const details = el("historyDetails");
    const empty = el("historyEmptyState");
    const summary = el("historySummary");
    const editBtn = el("historyEdit");
    const delBtn = el("historyDelete");
    const backBtn = el("historyBack");

    if (!list || !details || !empty || !editBtn || !delBtn) return;

    const store = SleepApp.storage;
    const sessions = store.getSessions().filter((s) => s?.start && s?.end);
    empty.hidden = sessions.length !== 0;

    if (summary) SleepApp.graphs.renderAnalyticsSummary(summary);

    SleepApp.graphs.renderSessionList(list, { limit: null });

    const selected = selectedId ? sessions.find((s) => s.id === selectedId) : null;
    const hasSelected = Boolean(selected);
    editBtn.disabled = !hasSelected;
    delBtn.disabled = !hasSelected;

    if (!hasSelected) {
      details.innerHTML = `
        <div class="kv__k">Tip</div><div class="kv__v">Tap a session above to view details.</div>
      `;
      return;
    }

    const goals = store.getGoals();
    const schedule = store.getSchedule();
    const endKey = SleepApp.sleepTracker.getSessionDateKey(selected) || "—";
    const goalMinutes = SleepApp.sleepTracker.getGoalMinutesForDate(new Date(selected.end), goals);
    const diff = Math.round(Number(selected.durationMinutes) - goalMinutes);
    const consistency = SleepApp.sleepTracker.computeConsistencyScore(selected, schedule, goals);

    const score = Number.isFinite(selected.score) ? Math.round(selected.score) : null;
    const scoreLabel = score === null ? "—" : score >= 80 ? "Great" : score >= 65 ? "Okay" : "Poor";
    const note = typeof selected.note === "string" ? selected.note.trim() : "";
    const noteHTML = note ? escapeHTML(note).replace(/\n/g, "<br>") : null;

    details.innerHTML = `
      <div class="kv__k">Date</div><div class="kv__v">${endKey}</div>
      <div class="kv__k">Start</div><div class="kv__v">${SleepApp.time.formatTimeFromISO(selected.start)} (${selected.start})</div>
      <div class="kv__k">End</div><div class="kv__v">${SleepApp.time.formatTimeFromISO(selected.end)} (${selected.end})</div>
      <div class="kv__k">Duration</div><div class="kv__v">${SleepApp.time.formatDuration(Number(selected.durationMs))}</div>
      ${noteHTML ? `<div class="kv__k">Note</div><div class="kv__v" style="white-space:pre-wrap">${noteHTML}</div>` : ""}
      <div class="kv__k">Goal</div><div class="kv__v">${formatMinutesAsHM(goalMinutes)} (${diff >= 0 ? "+" : ""}${diff}m)</div>
      <div class="kv__k">Consistency</div><div class="kv__v">${consistency === null ? "—" : `${consistency}/100`}</div>
      <div class="kv__k">Score</div><div class="kv__v">${score === null ? "—" : `${score}/100`} • ${scoreLabel}</div>
    `;

    const url = new URL(window.location.href);
    url.searchParams.set("id", selected.id);
    window.history.replaceState(null, "", url.toString());

    // Mobile: show back button if list is scrolled off-screen.
    if (backBtn) backBtn.hidden = false;
  }

  function renderBestDayInsight() {
    const bestDayValue = el("bestDayValue");
    const bestDayDuration = el("bestDayDuration");
    const bestDayScore = el("bestDayScore");
    const empty = el("bestDayEmpty");
    if (!bestDayValue || !bestDayDuration || !bestDayScore || !empty) return;

    const sessions = SleepApp.storage.getSessions().filter((s) => s?.start && s?.end);
    const groups = new Map();

    for (const session of sessions) {
      const times = SleepApp.sleepTracker.computeSessionTimes(session.start, session.end);
      if (!times) continue;
      const dayIndex = times.endDate.getDay();
      const entry = groups.get(dayIndex) || { count: 0, totalMinutes: 0, totalScore: 0, scoreCount: 0 };
      entry.count += 1;
      entry.totalMinutes += times.durationMinutes;
      if (Number.isFinite(Number(session.score))) {
        entry.totalScore += Number(session.score);
        entry.scoreCount += 1;
      }
      groups.set(dayIndex, entry);
    }

    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    let best = null;

    for (let i = 0; i < dayNames.length; i++) {
      const entry = groups.get(i);
      if (!entry || entry.count < 2) continue;
      const avgMinutes = entry.totalMinutes / entry.count;
      if (!best || avgMinutes > best.avgMinutes) {
        best = { dayIndex: i, avgMinutes, scoreCount: entry.scoreCount, avgScore: entry.totalScore / Math.max(1, entry.scoreCount) };
      }
    }

    if (!best) {
      empty.hidden = false;
      bestDayValue.textContent = "—";
      bestDayDuration.textContent = "—";
      bestDayScore.textContent = "—";
      return;
    }

    empty.hidden = true;
    bestDayValue.textContent = dayNames[best.dayIndex];
    bestDayDuration.textContent = formatMinutesAsHM(best.avgMinutes);
    bestDayScore.textContent = best.scoreCount ? `${Math.round(best.avgScore)}` : "—";
  }

  function attachAnalyticsHandlers() {
    const store = SleepApp.storage;
    const ui = store.getUI();
    let view = ui.analyticsView || "daily";
    if (!["daily", "weekly", "monthly"].includes(view)) view = "daily";

    const segmented = document.querySelector(".segmented");
    if (!segmented) return;

    const metricToggle = el("analyticsMetricToggle");
    const metricInputs = metricToggle ? [...metricToggle.querySelectorAll('input[name="analyticsMetric"]')] : [];

    function setMetric(nextMetric) {
      const safe = normalizeAnalyticsMetric(nextMetric, "duration");
      const uiState = store.getUI();
      if (view === "weekly") store.setUI({ ...uiState, analyticsWeeklyMetric: safe });
      else if (view === "monthly") store.setUI({ ...uiState, analyticsMonthlyMetric: safe });
      syncMetricToggle();
      renderAnalyticsPage(view, safe);
    }

    function syncMetricToggle() {
      if (!metricToggle) return;
      const show = view === "weekly" || view === "monthly";
      metricToggle.hidden = !show;
      if (!show) return;

      const uiState = store.getUI();
      const metric = getAnalyticsMetricForView(view, uiState);
      for (const input of metricInputs) {
        input.checked = input.value === metric;
      }
    }

    const sessionList = el("sessionList");
    if (sessionList) {
      sessionList.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const button = target.closest("button[data-session-id]");
        if (!(button instanceof HTMLElement)) return;
        const sessionId = button.dataset.sessionId;
        if (!sessionId) return;

        const sessions = SleepApp.storage.getSessions();
        const session = sessions.find((s) => s?.id === sessionId);
        if (!session?.start || !session?.end) return;

        function isoToLocalInputValue(iso) {
          const d = new Date(iso);
          if (Number.isNaN(d.getTime())) return "";
          const yyyy = d.getFullYear();
          const mm = SleepApp.time.pad2(d.getMonth() + 1);
          const dd = SleepApp.time.pad2(d.getDate());
          const hh = SleepApp.time.pad2(d.getHours());
          const min = SleepApp.time.pad2(d.getMinutes());
          return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
        }

        function localInputValueToISO(value) {
          const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value || ""));
          if (!match) return null;
          const year = Number(match[1]);
          const month = Number(match[2]) - 1;
          const day = Number(match[3]);
          const hour = Number(match[4]);
          const minute = Number(match[5]);
          const d = new Date(year, month, day, hour, minute, 0, 0);
          if (Number.isNaN(d.getTime())) return null;
          return d.toISOString();
        }

        const wrap = document.createElement("div");
        wrap.className = "field";

        const startField = document.createElement("div");
        startField.className = "field";
        const startLabel = document.createElement("label");
        startLabel.className = "label";
        startLabel.textContent = "Start";
        const startInput = document.createElement("input");
        startInput.className = "input";
        startInput.type = "datetime-local";
        startInput.value = isoToLocalInputValue(session.start);
        startField.append(startLabel, startInput);

        const endField = document.createElement("div");
        endField.className = "field";
        const endLabel = document.createElement("label");
        endLabel.className = "label";
        endLabel.textContent = "End";
        const endInput = document.createElement("input");
        endInput.className = "input";
        endInput.type = "datetime-local";
        endInput.value = isoToLocalInputValue(session.end);
        endField.append(endLabel, endInput);

        const hint = document.createElement("div");
        hint.className = "muted";
        hint.style.marginTop = "10px";
        hint.textContent = "Sessions are assigned to the wake-up date (end time).";

        wrap.append(startField, endField, hint);

        const result = await showModal({
          title: "Edit Session",
          body: wrap,
          actions: [
            { label: "Cancel", value: { action: "cancel" }, variant: "ghost" },
            { label: "Delete", value: { action: "delete" }, variant: "ghost" },
            {
              label: "Save",
              variant: "primary",
              value: () => ({
                action: "save",
                startISO: localInputValueToISO(startInput.value),
                endISO: localInputValueToISO(endInput.value),
              }),
            },
          ],
        });

        if (!result || result.action === "cancel") return;

        if (result.action === "delete") {
          const confirmDelete = await showModal({
            title: "Delete session?",
            body: "This will remove the session and update streaks/scores.",
            actions: [
              { label: "Cancel", value: false, variant: "ghost" },
              { label: "Delete", value: true, variant: "primary" },
            ],
          });
          if (!confirmDelete) return;
          SleepApp.sleepTracker.deleteSession(sessionId);
          return;
        }

        if (result.action === "save") {
          if (!result.startISO || !result.endISO) {
            setSaveWarningVisible(true, "Sleep not saved yet");
            return;
          }
          const update = SleepApp.sleepTracker.updateSessionTimes(sessionId, { startISO: result.startISO, endISO: result.endISO });
          if (!update.ok) {
            setSaveWarningVisible(true, update.reason || "Sleep not saved yet");
          }
        }
      });
    }

    function setView(nextView) {
      view = nextView;
      const uiState = store.getUI();
      store.setUI({ ...uiState, analyticsView: view });

      for (const btn of segmented.querySelectorAll("button[data-view]")) {
        btn.classList.toggle("is-active", btn.dataset.view === view);
      }

      syncMetricToggle();
      const metric = getAnalyticsMetricForView(view, store.getUI());
      renderAnalyticsPage(view, metric);
    }

    segmented.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.matches("button[data-view]")) return;
      setView(target.dataset.view);
    });

    if (metricToggle) {
      metricToggle.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (target.name !== "analyticsMetric") return;
        setMetric(target.value);
      });
    }

    setView(view);
  }

  function attachHistoryHandlers() {
    const list = el("historyList");
    const edit = el("historyEdit");
    const del = el("historyDelete");
    const back = el("historyBack");
    const exportBtn = el("historyExport");
    const importBtn = el("historyImport");
    const importInput = el("historyImportInput");
    if (!list || !edit || !del) return;

    const url = new URL(window.location.href);
    let selectedId = url.searchParams.get("id");

    function pick(id) {
      selectedId = id;
      renderHistoryPage(selectedId);
    }

    list.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest("button[data-session-id]");
      if (!(button instanceof HTMLElement)) return;
      const sessionId = button.dataset.sessionId;
      if (!sessionId) return;
      pick(sessionId);

      // On small screens, scroll details into view.
      const detailsCard = el("historyDetailsCard");
      if (detailsCard) detailsCard.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    if (back) {
      back.addEventListener("click", () => {
        const top = el("historyList");
        if (top) top.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    edit.addEventListener("click", async () => {
      if (!selectedId) return;
      const sessions = SleepApp.storage.getSessions();
      const session = sessions.find((s) => s?.id === selectedId);
      if (!session?.start || !session?.end) return;

      // Reuse the analytics edit flow via a small inline modal.
      function isoToLocalInputValue(iso) {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return "";
        const yyyy = d.getFullYear();
        const mm = SleepApp.time.pad2(d.getMonth() + 1);
        const dd = SleepApp.time.pad2(d.getDate());
        const hh = SleepApp.time.pad2(d.getHours());
        const min = SleepApp.time.pad2(d.getMinutes());
        return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
      }
      function localInputValueToISO(value) {
        const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value || ""));
        if (!match) return null;
        const year = Number(match[1]);
        const month = Number(match[2]) - 1;
        const day = Number(match[3]);
        const hour = Number(match[4]);
        const minute = Number(match[5]);
        const d = new Date(year, month, day, hour, minute, 0, 0);
        if (Number.isNaN(d.getTime())) return null;
        return d.toISOString();
      }

      const wrap = document.createElement("div");
      wrap.className = "field";

      const startField = document.createElement("div");
      startField.className = "field";
      const startLabel = document.createElement("label");
      startLabel.className = "label";
      startLabel.textContent = "Start";
      const startInput = document.createElement("input");
      startInput.className = "input";
      startInput.type = "datetime-local";
      startInput.value = isoToLocalInputValue(session.start);
      startField.append(startLabel, startInput);

      const endField = document.createElement("div");
      endField.className = "field";
      const endLabel = document.createElement("label");
      endLabel.className = "label";
      endLabel.textContent = "End";
      const endInput = document.createElement("input");
      endInput.className = "input";
      endInput.type = "datetime-local";
      endInput.value = isoToLocalInputValue(session.end);
      endField.append(endLabel, endInput);

      wrap.append(startField, endField);

      const result = await showModal({
        title: "Edit Session",
        body: wrap,
        actions: [
          { label: "Cancel", value: { action: "cancel" }, variant: "ghost" },
          {
            label: "Save",
            variant: "primary",
            value: () => ({
              action: "save",
              startISO: localInputValueToISO(startInput.value),
              endISO: localInputValueToISO(endInput.value),
            }),
          },
        ],
      });

      if (!result || result.action !== "save") return;
      if (!result.startISO || !result.endISO) {
        setSaveWarningVisible(true, "Sleep not saved yet");
        return;
      }

      const update = SleepApp.sleepTracker.updateSessionTimes(selectedId, { startISO: result.startISO, endISO: result.endISO });
      if (!update.ok) {
        setSaveWarningVisible(true, update.reason || "Sleep not saved yet");
      } else {
        renderHistoryPage(selectedId);
      }
    });

    del.addEventListener("click", async () => {
      if (!selectedId) return;
      const confirmDelete = await showModal({
        title: "Delete session?",
        body: "This will remove the session and update streaks/scores/graphs.",
        actions: [
          { label: "Cancel", value: false, variant: "ghost" },
          { label: "Delete", value: true, variant: "primary" },
        ],
      });
      if (!confirmDelete) return;
      SleepApp.sleepTracker.deleteSession(selectedId);
      selectedId = null;
      const url = new URL(window.location.href);
      url.searchParams.delete("id");
      window.history.replaceState(null, "", url.toString());
      renderHistoryPage(null);
    });

if (exportBtn) {
  exportBtn.addEventListener("click", async () => {
    const data = SleepApp.storage.getAllData();
    const stamp = SleepApp.time.toDateKeyLocal(new Date());
    const filename = `sleepoid_backup_${stamp}.json`;

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const file = new File([blob], filename, { type: "application/json" });

    // 🟢 BEST for iPhone/iPad — opens Share Sheet (Save to Files, AirDrop, etc.)
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      try {
        await navigator.share({
          title: "Sleepoid Backup",
          files: [file],
        });
        return; // Done if user saves
      } catch (err) {
        console.log("Share cancelled, falling back to download.");
      }
    }

    // 🔵 Fallback for desktop & other browsers
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);

    link.click();

    // ⚠️ CRITICAL: iOS needs time before we clean up the file
    setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    }, 8000); // 8 seconds = safe delay for iOS
  });
}


    if (importBtn && importInput) {
      importBtn.addEventListener("click", () => {
        importInput.value = "";
        importInput.click();
      });

      importInput.addEventListener("change", async () => {
        const file = importInput.files?.[0];
        if (!file) return;

        const text = await file.text();
        let raw = null;
        try {
          raw = JSON.parse(text);
        } catch {
          raw = null;
        }
        if (!raw) {
          await showModal({
            title: "Invalid backup",
            body: "That file could not be read as JSON.",
            actions: [{ label: "Close", value: "close", variant: "primary" }],
          });
          return;
        }

        if (!raw || typeof raw !== "object" || !Array.isArray(raw.sessions)) {
          await showModal({
            title: "Invalid backup",
            body: "That backup does not match the Sleepoid data format.",
            actions: [{ label: "Close", value: "close", variant: "primary" }],
          });
          return;
        }

        const normalized = SleepApp.storage.migrateAppData(raw);
        const validation = normalized ? SleepApp.storage.validateAppData(normalized) : { ok: false };
        if (!validation.ok) {
          await showModal({
            title: "Invalid backup",
            body: "That backup does not match the Sleepoid data format.",
            actions: [{ label: "Close", value: "close", variant: "primary" }],
          });
          return;
        }

        const sessionValidation = SleepApp.sleepTracker.validateSessionList(normalized.sessions);
        if (!sessionValidation.ok) {
          await showModal({
            title: "Backup rejected",
            body: sessionValidation.reason || "Sessions overlap or contain invalid dates.",
            actions: [{ label: "Close", value: "close", variant: "primary" }],
          });
          return;
        }

        const confirm = await showModal({
          title: "Import backup?",
          body: "Replace all data with this backup? This cannot be undone.",
          actions: [
            { label: "Cancel", value: false, variant: "ghost" },
            { label: "Replace all data", value: true, variant: "primary" },
          ],
        });
        if (!confirm) return;

        const recalced = SleepApp.sleepTracker.recomputeStreakAndScores(sessionValidation.sessions);
        const nextData = {
          ...normalized,
          sessions: recalced.sessions,
          streak: recalced.streak,
        };
        SleepApp.storage.setAllData(nextData);
        window.dispatchEvent(new CustomEvent("sleepapp:sessionsChanged", { detail: { sessions: nextData.sessions } }));
        window.dispatchEvent(new CustomEvent("sleepapp:goalsChanged", { detail: { goals: nextData.goals } }));
        window.dispatchEvent(new CustomEvent("sleepapp:scheduleChanged", { detail: { schedule: nextData.schedule } }));
        window.dispatchEvent(new CustomEvent("sleepapp:activeSessionChanged", { detail: { activeSession: nextData.activeSession } }));
        renderHistoryPage(null);
      });
    }

    // Initial render
    renderHistoryPage(selectedId);

    window.addEventListener("sleepapp:sessionsChanged", () => renderHistoryPage(selectedId));
    window.addEventListener("sleepapp:goalsChanged", () => renderHistoryPage(selectedId));
    window.addEventListener("sleepapp:scheduleChanged", () => renderHistoryPage(selectedId));
  }

  function init() {
    const page = document.body?.dataset?.page;
    if (!page) return;

    document.body.classList.add("is-ready");

    ensureSaveWarning();
    window.addEventListener("sleepapp:saveStatus", (event) => {
      const detail = event.detail || {};
      if (detail.ok) setSaveWarningVisible(false);
      else setSaveWarningVisible(true, detail.message || "Sleep not saved yet");
    });
    window.addEventListener("sleepapp:dataWarning", (event) => {
      const detail = event.detail || {};
      setSaveWarningVisible(true, detail.message || "Sleep data could not be loaded.");
    });

    // Lightweight data repair: ensure sessions have IDs, durations, and up-to-date scores.
    const store = SleepApp.storage;
    if (SleepApp.sleepTracker && store?.hasKey?.(store.KEYS.sessions)) {
      const sessions = store.getSessions();
      const needsRepair = sessions.some(
        (s) =>
          s &&
          (typeof s.id !== "string" ||
            !s.id ||
            !Number.isFinite(Number(s.durationMinutes)) ||
            !Number.isFinite(Number(s.durationMs)) ||
            (s.end && !Number.isFinite(Number(s.score)))),
      );
      if (needsRepair) {
        const recalced = SleepApp.sleepTracker.recomputeStreakAndScores(sessions);
        store.setSessions(recalced.sessions);
        window.dispatchEvent(new CustomEvent("sleepapp:sessionsChanged", { detail: { sessions: recalced.sessions } }));
      }
    }

    const infoButton = el("infoButton");
    if (infoButton) {
      infoButton.addEventListener("click", () => {
        const body = document.createElement("div");

        const brand = document.createElement("div");
        brand.className = "about-brand";
        brand.innerHTML = `<span class="about-brand__name">Sleepoid</span> <span class="about-brand__version">v1.2</span>`;

        const intro = document.createElement("div");
        intro.className = "muted";
        intro.style.marginTop = "10px";
        intro.textContent = "Sleepoid is a calm, manual sleep tracker.";

        const sectionA = document.createElement("div");
        sectionA.style.marginTop = "14px";
        sectionA.innerHTML = `
          <div class="label">How consistency works</div>
          <div style="height:6px"></div>
          <div>Consistency measures how regular your sleep timing is across days.</div>
          <div class="muted" style="margin-top:8px">
            It uses your schedule as a reference and allows a tolerance window, so small variations don’t hurt much. The goal is a steady rhythm over
            time — not perfection.
          </div>
        `;

        const sectionB = document.createElement("div");
        sectionB.style.marginTop = "14px";
        sectionB.innerHTML = `
          <div class="label">How sleep score works</div>
          <div style="height:6px"></div>
          <div>Your sleep score is a 0–100 summary of how that night compares to your goals.</div>
          <div class="muted" style="margin-top:8px">
            It considers duration vs your goal, timing consistency, and whether you’re building a steady streak. It’s meant as a gentle reference to help
            you notice patterns.
          </div>
        `;

        const sectionC = document.createElement("div");
        sectionC.style.marginTop = "14px";
        sectionC.innerHTML = `
          <div class="label">General app information</div>
          <div style="height:6px"></div>
          <div>This is a manual tracker — you enter sleep by tapping Start/Stop.</div>
          <div class="muted" style="margin-top:8px">
            There are no sensors or wearables, and it works offline-first. All data is stored locally in your browser (no accounts, no cloud sync).
          </div>
        `;

        const changelog = document.createElement("div");
        changelog.className = "about-collapse";
        changelog.style.marginTop = "16px";

        const changelogBtn = document.createElement("button");
        changelogBtn.type = "button";
        changelogBtn.className = "about-collapse__btn";
        changelogBtn.setAttribute("aria-expanded", "false");
        changelogBtn.textContent = "Changelog";

        const changelogContent = document.createElement("div");
        changelogContent.id = `aboutChangelog-${Date.now().toString(36)}`;
        changelogContent.className = "about-collapse__content";
        changelogContent.setAttribute("aria-hidden", "true");
        changelogBtn.setAttribute("aria-controls", changelogContent.id);

        const changelogInner = document.createElement("div");
        changelogInner.className = "about-collapse__inner";
        changelogInner.innerHTML = `
          <div class="label">Version 1.2 (Current)</div>
          <div style="height:8px"></div>
          <div>- Overall sleep score on Home.</div>
          <div>- Mobile schedule dial layout fix.</div>
          <div>- Analytics UI cleanup for metrics.</div>
          <div style="height:12px"></div>
          <div class="label">Version 1.1</div>
          <div style="height:8px"></div>
          <div>- Weekly/Monthly analytics metric toggle (duration vs consistency).</div>
          <div>- Schedule dial drag improvements on mobile + subtle haptics.</div>
          <div>- Optional note when starting sleep (shown in History).</div>
          <div style="height:12px"></div>
          <div class="label">Version 1.0</div>
          <div style="height:8px"></div>
          <div>- Manual sleep sessions with Start/Stop.</div>
          <div>- Goals, schedules, and basic analytics.</div>
          <div>- History with edit and delete.</div>
        `;
        changelogContent.append(changelogInner);

        changelogBtn.addEventListener("click", () => {
          const open = changelog.classList.toggle("is-open");
          changelogBtn.setAttribute("aria-expanded", open ? "true" : "false");
          changelogContent.setAttribute("aria-hidden", open ? "false" : "true");
          // Simple expand/collapse with subtle animation; content is text-only.
        });

        changelog.append(changelogBtn, changelogContent);

        body.append(brand, intro, sectionA, sectionB, sectionC, changelog);

        showModal({
          title: "About",
          kind: "info",
          body,
          actions: [{ label: "Close", value: "close", variant: "primary" }],
        });
      });
    }

    if (page === "home") {
      attachHomeHandlers();
      renderHome();

      window.addEventListener("sleepapp:sessionSaved", () => renderHome());
      window.addEventListener("sleepapp:sessionsChanged", () => renderHome());
      window.addEventListener("sleepapp:activeSessionChanged", () => renderHome());
      window.addEventListener("sleepapp:goalsChanged", () => renderHome());
      window.addEventListener("sleepapp:scheduleChanged", () => renderHome());
      return;
    }

    if (page === "analytics") {
      attachAnalyticsHandlers();
      renderBestDayInsight();
      window.addEventListener("sleepapp:sessionSaved", () => {
        const ui = SleepApp.storage.getUI();
        const view = ui.analyticsView || "daily";
        renderAnalyticsPage(view, getAnalyticsMetricForView(view, ui));
      });
      window.addEventListener("sleepapp:sessionsChanged", () => {
        const ui = SleepApp.storage.getUI();
        const view = ui.analyticsView || "daily";
        renderAnalyticsPage(view, getAnalyticsMetricForView(view, ui));
      });
      return;
    }

    if (page === "history") {
      attachHistoryHandlers();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
