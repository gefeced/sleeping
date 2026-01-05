/* ui.js
   Navigation + animations + page bootstrapping + state syncing between modules.
*/

(function () {
  "use strict";

  const SleepApp = (window.SleepApp = window.SleepApp || {});

  function el(id) {
    return document.getElementById(id);
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

  function showModal({ title, body, actions, dismissValue = "cancel", dismissible = true }) {
    const root = ensureModalRoot();
    root.hidden = false;

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

  function renderHomeEmptyStates() {
    const card = el("homeEmptyStates");
    const message = el("homeEmptyMessage");
    const action = el("homeEmptyAction");
    if (!card || !message || !action) return;

    const store = SleepApp.storage;
    const hasSessions = store.hasKey(store.KEYS.sessions) && store.getSessions().some((s) => s?.start && s?.end);
    const hasGoals = store.hasKey(store.KEYS.goals);
    const hasSchedule = store.hasKey(store.KEYS.schedule);

    if (!hasSessions) {
      card.hidden = false;
      message.textContent = "Your sleep journey starts tonight.";
      action.textContent = "Start Sleeping";
      action.href = "#";
      action.onclick = (e) => {
        e.preventDefault();
        const btn = el("sleepButton");
        if (!btn) return;
        btn.scrollIntoView({ behavior: "smooth", block: "center" });
        window.setTimeout(() => btn.click(), 250);
      };
      return;
    }

    if (!hasGoals) {
      card.hidden = false;
      message.textContent = "Set a goal to track your progress.";
      action.textContent = "Set Goal";
      action.href = "goals.html";
      action.onclick = null;
      return;
    }

    if (!hasSchedule) {
      card.hidden = false;
      message.textContent = "Add a schedule to improve consistency scoring.";
      action.textContent = "Set Schedule";
      action.href = "schedule.html";
      action.onclick = null;
      return;
    }

    card.hidden = true;
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

    renderHomeEmptyStates();
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
          button.classList.add("did-stop");
          window.setTimeout(() => button.classList.remove("did-stop"), 350);
          renderHome();
        }
      } else {
        // Safety check: if starting 3+ hours before scheduled bedtime, confirm.
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

        if (shouldConfirm) {
          const choice = await showModal({
            title: "Start sleeping now?",
            body: `
              <div>This is more than 3 hours before your scheduled bedtime (${bedtimeText}).</div>
              <div class="muted" style="margin-top:10px">If this is intentional (early night, nap, travel), you can still log it.</div>
            `,
            actions: [
              { label: "Cancel", value: "cancel", variant: "ghost" },
              { label: "Start", value: "start", variant: "primary" },
            ],
          });
          if (choice !== "start") return;
        }

        SleepApp.sleepTracker.startSleeping();
        button.classList.add("did-start");
        window.setTimeout(() => button.classList.remove("did-start"), 350);
        renderHome();
      }
    });
  }

  function renderAnalyticsPage(view) {
    const canvas = el("analyticsCanvas");
    const legend = el("analyticsLegend");
    const sessionsTitle = el("sessionsTitle");
    const sessionsSubtitle = el("sessionsSubtitle");
    const emptyState = el("analyticsEmptyState");
    const sessions = SleepApp.storage.getSessions().filter((s) => s?.start && s?.end);

    SleepApp.graphs.renderAnalyticsSummary(el("analyticsSummary"));

    const isHistory = view === "history";
    if (canvas) canvas.hidden = isHistory;
    if (legend) legend.hidden = isHistory;

    if (isHistory) {
      if (sessionsTitle) sessionsTitle.textContent = "History";
      if (sessionsSubtitle) sessionsSubtitle.textContent = "Tap a session to edit or delete.";
      if (emptyState) emptyState.hidden = sessions.length !== 0;
      SleepApp.graphs.renderSessionList(el("sessionList"), { limit: null });
      return;
    }

    if (sessionsTitle) sessionsTitle.textContent = "Sessions";
    if (sessionsSubtitle) sessionsSubtitle.textContent = "Most recent sessions (tap to edit).";
    if (emptyState) emptyState.hidden = true;

    if (canvas) SleepApp.graphs.renderAnalytics(canvas, view);
    SleepApp.graphs.renderLegend(view, legend);
    SleepApp.graphs.renderSessionList(el("sessionList"), { limit: 20 });
  }

  function attachAnalyticsHandlers() {
    const store = SleepApp.storage;
    const ui = store.getUI();
    let view = ui.analyticsView || "daily";

    const segmented = document.querySelector(".segmented");
    if (!segmented) return;

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
            await showModal({
              title: "Invalid time",
              body: "Please enter valid start and end times.",
              actions: [{ label: "Close", value: "close", variant: "primary" }],
            });
            return;
          }
          const update = SleepApp.sleepTracker.updateSessionTimes(sessionId, { startISO: result.startISO, endISO: result.endISO });
          if (!update.ok) {
            await showModal({
              title: "Couldn’t save",
              body: update.reason || "Please check the times and try again.",
              actions: [{ label: "Close", value: "close", variant: "primary" }],
            });
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
      renderAnalyticsPage(view);
    }

    segmented.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.matches("button[data-view]")) return;
      setView(target.dataset.view);
    });

    setView(view);
  }

  function init() {
    const page = document.body?.dataset?.page;
    if (!page) return;

    document.body.classList.add("is-ready");

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
        showModal({
          title: "About",
          body: `
            <div class="muted">Sleep is a calm, manual sleep tracker.</div>
            <div style="height:10px"></div>
            <div>- Tap Start/Stop to log sleep sessions.</div>
            <div>- Set goals and schedules to improve scoring.</div>
            <div style="height:10px"></div>
            <div class="muted">All data is stored locally in your browser (no accounts, no cloud sync).</div>
          `,
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
      window.addEventListener("sleepapp:sessionSaved", () => {
        const ui = SleepApp.storage.getUI();
        renderAnalyticsPage(ui.analyticsView || "daily");
      });
      window.addEventListener("sleepapp:sessionsChanged", () => {
        const ui = SleepApp.storage.getUI();
        renderAnalyticsPage(ui.analyticsView || "daily");
      });
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
