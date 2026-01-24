/* goals.js
   Goals blocks UI + saving to localStorage.

   v2 goals model:
   - defaultGoalMinutes: baseline for any day without a matching block
   - goalBlocks: [{ id, minutes, days:[0..6] }] (first match wins)
   - toleranceMinutes: used for consistency scoring + streak qualification
*/

(function () {
  "use strict";

  const SleepApp = (window.SleepApp = window.SleepApp || {});

  const DAYS = [
    { key: 1, short: "Mon" },
    { key: 2, short: "Tue" },
    { key: 3, short: "Wed" },
    { key: 4, short: "Thu" },
    { key: 5, short: "Fri" },
    { key: 6, short: "Sat" },
    { key: 0, short: "Sun" },
  ];

  function el(id) {
    return document.getElementById(id);
  }

  function uuid() {
    return `goal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function minutesFromParts(hours, minutes) {
    const h = Number(hours);
    const m = Number(minutes);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return Math.max(0, Math.round(h * 60 + m));
  }

  function partsFromMinutes(totalMinutes) {
    const minutes = Math.max(0, Math.round(Number(totalMinutes) || 0));
    return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
  }

  function setStatus(message) {
    const node = el("goalsStatus");
    if (!node) return;
    node.textContent = message;
    node.classList.remove("is-ok");
    if (message) node.classList.add("is-ok");
    window.setTimeout(() => {
      if (node.textContent === message) node.textContent = "";
      node.classList.remove("is-ok");
    }, 1800);
  }

  function renderDayChips(container, selectedDays) {
    container.innerHTML = "";
    for (const day of DAYS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip" + (selectedDays.includes(day.key) ? " is-on" : "");
      button.textContent = day.short;
      button.dataset.day = String(day.key);
      button.setAttribute("aria-pressed", selectedDays.includes(day.key) ? "true" : "false");
      container.append(button);
    }
  }

  function computeOverlapWarning(goalBlocks) {
    const counts = new Map();
    for (const b of goalBlocks) {
      for (const d of b.days || []) counts.set(d, (counts.get(d) || 0) + 1);
    }
    const overlaps = [...counts.entries()].filter(([, c]) => c > 1).map(([d]) => d);
    if (overlaps.length === 0) return "";
    const labels = { 0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };
    return `Overlapping days: ${overlaps.sort().map((d) => labels[d]).join(", ")} (first matching block wins)`;
  }

  function formatHM(totalMinutes) {
    const { hours, minutes } = partsFromMinutes(totalMinutes);
    if (hours <= 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
  }

  function renderBlocks(container, goals, state, onChange) {
    container.innerHTML = "";

    for (const block of state.goalBlocks) {
      const details = document.createElement("details");
      details.className = "session";

      const summary = document.createElement("summary");
      summary.className = "session__summary";

      const daysText =
        Array.isArray(block.days) && block.days.length
          ? block.days
              .slice()
              .sort()
              .map((d) => DAYS.find((x) => x.key === d)?.short || "")
              .filter(Boolean)
              .join(", ")
          : "No days selected";

      summary.innerHTML = `
        <div class="session__date">Goal Block</div>
        <div class="session__meta">
          <span class="session__duration">${formatHM(block.minutes)}</span>
          <span class="session__score">${daysText}</span>
        </div>
      `;

      const body = document.createElement("div");
      body.className = "session__body";

      const parts = partsFromMinutes(block.minutes);

      const grid = document.createElement("div");
      grid.className = "form-grid";

      const hField = document.createElement("div");
      hField.className = "field";
      const hLabel = document.createElement("label");
      hLabel.className = "label";
      hLabel.textContent = "Hours";
      const hInput = document.createElement("input");
      hInput.className = "input";
      hInput.type = "number";
      hInput.min = "0";
      hInput.max = "16";
      hInput.step = "1";
      hInput.inputMode = "numeric";
      hInput.value = String(parts.hours);
      hField.append(hLabel, hInput);

      const mField = document.createElement("div");
      mField.className = "field";
      const mLabel = document.createElement("label");
      mLabel.className = "label";
      mLabel.textContent = "Minutes";
      const mInput = document.createElement("input");
      mInput.className = "input";
      mInput.type = "number";
      mInput.min = "0";
      mInput.max = "59";
      mInput.step = "5";
      mInput.inputMode = "numeric";
      mInput.value = String(parts.minutes);
      mField.append(mLabel, mInput);

      grid.append(hField, mField);

      const chips = document.createElement("div");
      chips.className = "chips";
      renderDayChips(chips, block.days || []);

      const footer = document.createElement("div");
      footer.className = "row row--left";
      footer.style.marginTop = "10px";

      const del = document.createElement("button");
      del.type = "button";
      del.className = "button button--ghost";
      del.textContent = "Delete Block";

      footer.append(del);

      body.append(grid);
      body.append(document.createElement("div"));
      body.append(chips);
      body.append(footer);
      details.append(summary, body);
      container.append(details);

      hInput.addEventListener("change", () => {
        const minutes = minutesFromParts(hInput.value, mInput.value);
        if (minutes === null) return;
        block.minutes = minutes;
        renderAll();
        onChange?.();
      });
      mInput.addEventListener("change", () => {
        const minutes = minutesFromParts(hInput.value, mInput.value);
        if (minutes === null) return;
        block.minutes = minutes;
        renderAll();
        onChange?.();
      });

      chips.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.matches("button[data-day]")) return;
        const day = Number(target.dataset.day);
        if (!Number.isFinite(day)) return;
        const days = Array.isArray(block.days) ? block.days : [];
        block.days = days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort();
        renderAll();
        onChange?.();
      });

      del.addEventListener("click", async () => {
        const ok = await SleepApp.ui?.showModal?.({
          title: "Delete goal block?",
          body: "This removes the block but keeps your default goal.",
          actions: [
            { label: "Cancel", value: false, variant: "ghost" },
            { label: "Delete", value: true, variant: "primary" },
          ],
        });
        if (!ok) return;
        state.goalBlocks = state.goalBlocks.filter((b) => b.id !== block.id);
        renderAll();
        onChange?.();
      });
    }

    function renderAll() {
      // Re-render blocks + warnings and keep current state.
      renderBlocks(container, goals, state, onChange);
      const warning = el("goalBlocksWarning");
      if (warning) warning.textContent = computeOverlapWarning(state.goalBlocks);
      updateDefaultSummary(state.defaultGoalMinutes);
    }
  }

  function updateDefaultSummary(defaultGoalMinutes) {
    const summary = el("defaultGoalSummary");
    if (summary) summary.textContent = formatHM(defaultGoalMinutes);
  }

  function initGoalsPage() {
    const store = SleepApp.storage;
    let goals = store.getGoals();

    const contentSections = [...document.querySelectorAll("main.content > section")].filter(
      (s) => s.id !== "goalsEmptyState",
    );

    const emptyState = el("goalsEmptyState");
    const emptyAction = el("goalsEmptyAction");
    const hasGoalsKey = store.hasKey(store.KEYS.goals);
    if (emptyState) emptyState.hidden = hasGoalsKey;
    for (const s of contentSections) s.hidden = !hasGoalsKey;

    if (emptyAction) {
      emptyAction.addEventListener("click", () => {
        const next = store.defaults().goals;
        store.setGoals(next);
        goals = store.getGoals();
        if (emptyState) emptyState.hidden = true;
        for (const s of contentSections) s.hidden = false;
        loadGoalsIntoUI(goals);
        // Changing goals impacts streak qualification + scores.
        const recalced = SleepApp.sleepTracker?.recomputeStreakAndScores?.(store.getSessions());
        if (recalced?.sessions) {
          store.setSessions(recalced.sessions);
          window.dispatchEvent(new CustomEvent("sleepapp:sessionsChanged", { detail: { sessions: recalced.sessions } }));
        }
        setStatus("Saved.");
        window.dispatchEvent(new CustomEvent("sleepapp:goalsChanged", { detail: { goals } }));
      });
    }

    function loadGoalsIntoUI(goalsValue) {
      const defaultParts = partsFromMinutes(goalsValue.defaultGoalMinutes);
      el("defaultGoalHours").value = String(defaultParts.hours);
      el("defaultGoalMinutes").value = String(defaultParts.minutes);
      updateDefaultSummary(goalsValue.defaultGoalMinutes);

      const toleranceRange = el("toleranceRange");
      const toleranceValue = el("toleranceValue");
      if (toleranceRange) toleranceRange.value = String(goalsValue.toleranceMinutes ?? 45);
      if (toleranceValue) toleranceValue.textContent = String(goalsValue.toleranceMinutes ?? 45);

      state.defaultGoalMinutes = goalsValue.defaultGoalMinutes;
      state.goalBlocks = Array.isArray(goalsValue.goalBlocks) ? goalsValue.goalBlocks.map((b) => ({ ...b })) : [];

      el("goalBlocksWarning").textContent = computeOverlapWarning(state.goalBlocks);
      renderBlocks(el("goalBlocks"), goalsValue, state, () => commitGoals({ announce: false }));
    }

    const state = { defaultGoalMinutes: goals.defaultGoalMinutes, goalBlocks: [] };

    loadGoalsIntoUI(goals);

    function buildGoalsFromState() {
      const next = {
        ...goals,
        version: 2,
        defaultGoalMinutes: state.defaultGoalMinutes,
        goalBlocks: state.goalBlocks.map((b) => ({
          id: b.id || uuid(),
          minutes: Math.max(0, Math.round(Number(b.minutes) || goals.defaultGoalMinutes)),
          days: [...new Set((b.days || []).filter((d) => Number.isFinite(d) && d >= 0 && d <= 6))].sort(),
        })),
        toleranceMinutes: Math.max(0, Math.round(Number(el("toleranceRange").value || 0))),
      };
      return next;
    }

    function commitGoals({ announce } = { announce: false }) {
      const next = buildGoalsFromState();
      store.setGoals(next);
      goals = store.getGoals();
      const recalced = SleepApp.sleepTracker?.recomputeStreakAndScores?.(store.getSessions());
      if (recalced?.sessions) {
        store.setSessions(recalced.sessions);
        window.dispatchEvent(new CustomEvent("sleepapp:sessionsChanged", { detail: { sessions: recalced.sessions } }));
      }
      if (announce) setStatus("Saved.");
      window.dispatchEvent(new CustomEvent("sleepapp:goalsChanged", { detail: { goals } }));
    }

    el("defaultGoalHours").addEventListener("change", () => {
      const minutes = minutesFromParts(el("defaultGoalHours").value, el("defaultGoalMinutes").value);
      if (minutes === null) return;
      state.defaultGoalMinutes = minutes;
      updateDefaultSummary(minutes);
      commitGoals({ announce: false });
    });
    el("defaultGoalMinutes").addEventListener("change", () => {
      const minutes = minutesFromParts(el("defaultGoalHours").value, el("defaultGoalMinutes").value);
      if (minutes === null) return;
      state.defaultGoalMinutes = minutes;
      updateDefaultSummary(minutes);
      commitGoals({ announce: false });
    });

    el("toleranceRange").addEventListener("input", () => {
      el("toleranceValue").textContent = String(el("toleranceRange").value);
    });
    el("toleranceRange").addEventListener("change", () => {
      commitGoals({ announce: false });
    });

    el("addGoalBlock").addEventListener("click", () => {
      const used = new Set();
      for (const b of state.goalBlocks) for (const d of b.days || []) used.add(d);
      const allDays = [1, 2, 3, 4, 5, 6, 0];
      const unusedDays = allDays.filter((d) => !used.has(d));

      state.goalBlocks = [
        ...state.goalBlocks,
        { id: uuid(), minutes: state.defaultGoalMinutes, days: unusedDays.length ? unusedDays : [] },
      ];
      el("goalBlocksWarning").textContent = computeOverlapWarning(state.goalBlocks);
      renderBlocks(el("goalBlocks"), goals, state, () => commitGoals({ announce: false }));
      commitGoals({ announce: false });
    });

    el("saveGoals").addEventListener("click", () => {
      commitGoals({ announce: true });
    });

    el("resetGoals").addEventListener("click", async () => {
      const ok = await SleepApp.ui?.showModal?.({
        title: "Reset goals?",
        body: "This restores the default goal and clears all goal blocks.",
        actions: [
          { label: "Cancel", value: false, variant: "ghost" },
          { label: "Reset", value: true, variant: "primary" },
        ],
      });
      if (!ok) return;
      const next = store.defaults().goals;
      store.setGoals(next);
      goals = store.getGoals();
      loadGoalsIntoUI(goals);
      const recalced = SleepApp.sleepTracker?.recomputeStreakAndScores?.(store.getSessions());
      if (recalced?.sessions) {
        store.setSessions(recalced.sessions);
        window.dispatchEvent(new CustomEvent("sleepapp:sessionsChanged", { detail: { sessions: recalced.sessions } }));
      }
      setStatus("Reset.");
      window.dispatchEvent(new CustomEvent("sleepapp:goalsChanged", { detail: { goals } }));
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (document.body?.dataset?.page !== "goals") return;
    initGoalsPage();
  });
})();
