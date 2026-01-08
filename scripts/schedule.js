/* schedule.js
   Schedule UI + circular time selector (touch + mouse via Pointer Events).
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

  function setStatus(message) {
    const node = el("scheduleStatus");
    if (!node) return;
    node.textContent = message;
    node.classList.remove("is-ok");
    if (message) node.classList.add("is-ok");
    window.setTimeout(() => {
      if (node.textContent === message) node.textContent = "";
      node.classList.remove("is-ok");
    }, 1800);
  }

  function minutesToAngle(minutes) {
    return (minutes / 1440) * Math.PI * 2 - Math.PI / 2;
  }

  function angleToMinutes(angle) {
    const normalized = (angle + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
    return (normalized / (Math.PI * 2)) * 1440;
  }

  function snapMinutes(minutes, step = 5) {
    return Math.round(minutes / step) * step;
  }

  function polarToCartesian(cx, cy, r, angleRadians) {
    return { x: cx + r * Math.cos(angleRadians), y: cy + r * Math.sin(angleRadians) };
  }

  function arcPathMinutes(startMinutes, endMinutes) {
    const cx = 100;
    const cy = 100;
    const r = 74;
    const duration = SleepApp.time.durationBetweenMinutes(startMinutes, endMinutes);
    if (duration <= 0) return "";

    const startAngle = minutesToAngle(startMinutes);
    const endAngle = minutesToAngle(endMinutes);

    const start = polarToCartesian(cx, cy, r, startAngle);
    const end = polarToCartesian(cx, cy, r, endAngle);

    const largeArcFlag = duration > 720 ? 1 : 0;
    const sweepFlag = 1;
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${end.x.toFixed(
      2,
    )} ${end.y.toFixed(2)}`;
  }

  function renderDayChips(container, activeDays) {
    container.innerHTML = "";
    for (const day of DAYS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip" + (activeDays.includes(day.key) ? " is-on" : "");
      button.textContent = day.short;
      button.dataset.day = String(day.key);
      button.setAttribute("aria-pressed", activeDays.includes(day.key) ? "true" : "false");
      container.append(button);
    }
  }

  function setHandlePosition(dial, handle, minutes) {
    const rect = dial.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    const radius = size * 0.37;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const angle = minutesToAngle(minutes);
    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);
    handle.style.left = `${x}px`;
    handle.style.top = `${y}px`;
  }

  function findClosestHandle(pointerX, pointerY, handles) {
    let best = null;
    let bestDist = Infinity;
    for (const h of handles) {
      const rect = h.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const dx = pointerX - x;
      const dy = pointerY - y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        best = h;
        bestDist = dist;
      }
    }
    return best;
  }

  function initSchedulePage() {
    const store = SleepApp.storage;
    let scheduleState = store.getSchedule();

    const scheduleEmptyState = el("scheduleEmptyState");
    const createWeekdayWeekend = el("createWeekdayWeekend");
    const scheduleKeyExists = store.hasKey(store.KEYS.schedule);
    if (scheduleEmptyState) scheduleEmptyState.hidden = scheduleKeyExists;

    const dayChips = el("dayChips");
    const dial = el("timeDial");
    const handleBed = el("handleBed");
    const handleWake = el("handleWake");
    const arc = el("sleepArc");
    const bedText = el("bedText");
    const wakeText = el("wakeText");
    const bedtimeInput = el("bedtimeInput");
    const wakeInput = el("wakeInput");
    const dialDuration = el("dialDuration");

    const scheduleSelect = el("scheduleSelect");
    const scheduleName = el("scheduleName");
    const addScheduleBtn = el("addSchedule");
    const duplicateScheduleBtn = el("duplicateSchedule");
    const deleteScheduleBtn = el("deleteSchedule");
    const overlapWarning = el("overlapWarning");

    let activeScheduleId = scheduleState.activeScheduleId;
    let bedMinutes = 23 * 60;
    let wakeMinutes = 7 * 60;
    let activeDays = [1, 2, 3, 4, 5];

    function recomputeSessionsAfterScheduleChange() {
      // Schedule affects scoring; keep existing sessions consistent after edits.
      const recalced = SleepApp.sleepTracker?.recomputeStreakAndScores?.(store.getSessions());
      if (recalced?.sessions) {
        store.setSessions(recalced.sessions);
        window.dispatchEvent(new CustomEvent("sleepapp:sessionsChanged", { detail: { sessions: recalced.sessions } }));
      }
    }

    function uuid() {
      return `schedule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function getActiveSchedule() {
      const schedules = scheduleState.schedules || [];
      return schedules.find((s) => s.id === activeScheduleId) || schedules[0];
    }

    function setActiveScheduleId(id) {
      const schedules = scheduleState.schedules || [];
      const nextId = schedules.some((s) => s.id === id) ? id : schedules[0]?.id;
      if (!nextId) return;
      activeScheduleId = nextId;
      scheduleState.activeScheduleId = nextId;
      store.setSchedule(scheduleState);
      if (scheduleEmptyState) scheduleEmptyState.hidden = true;
      window.dispatchEvent(new CustomEvent("sleepapp:scheduleChanged", { detail: { schedule: scheduleState } }));
    }

    function saveActiveScheduleFromUI() {
      const schedules = scheduleState.schedules || [];
      const idx = schedules.findIndex((s) => s.id === activeScheduleId);
      if (idx < 0) return;

      const trimmedName = String(scheduleName.value || "").trim();
      schedules[idx] = {
        ...schedules[idx],
        name: trimmedName || schedules[idx].name || "Schedule",
        activeDays: [...activeDays].sort(),
        bedtime: SleepApp.time.minutesToTimeString(bedMinutes),
        wakeTime: SleepApp.time.minutesToTimeString(wakeMinutes),
      };
      scheduleState.schedules = schedules;
      store.setSchedule(scheduleState);
      if (scheduleEmptyState) scheduleEmptyState.hidden = true;
      recomputeSessionsAfterScheduleChange();
      window.dispatchEvent(new CustomEvent("sleepapp:scheduleChanged", { detail: { schedule: scheduleState } }));
    }

    function renderScheduleSelect() {
      const schedules = scheduleState.schedules || [];
      scheduleSelect.innerHTML = "";
      for (const s of schedules) {
        const option = document.createElement("option");
        option.value = s.id;
        option.textContent = s.name || "Schedule";
        scheduleSelect.append(option);
      }
      scheduleSelect.value = activeScheduleId;

      const disableDelete = schedules.length <= 1;
      deleteScheduleBtn.disabled = disableDelete;
      deleteScheduleBtn.setAttribute("aria-disabled", disableDelete ? "true" : "false");
    }

    function renderOverlapWarning() {
      if (!overlapWarning) return;
      const schedules = scheduleState.schedules || [];
      const active = getActiveSchedule();
      if (!active) {
        overlapWarning.textContent = "";
        return;
      }
      const overlaps = new Set();
      for (const s of schedules) {
        if (s.id === active.id) continue;
        for (const d of s.activeDays || []) {
          if ((active.activeDays || []).includes(d)) overlaps.add(d);
        }
      }
      if (overlaps.size === 0) {
        overlapWarning.textContent = "";
        return;
      }
      const labels = { 0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };
      overlapWarning.textContent = `Overlapping days: ${[...overlaps].sort().map((d) => labels[d]).join(", ")} (avoid overlaps)`;
    }

    function loadActiveScheduleIntoUI() {
      const active = getActiveSchedule();
      if (!active) return;
      activeScheduleId = active.id;
      scheduleSelect.value = active.id;
      scheduleName.value = active.name || "";

      bedMinutes = SleepApp.time.parseTimeToMinutes(active.bedtime) ?? 23 * 60;
      wakeMinutes = SleepApp.time.parseTimeToMinutes(active.wakeTime) ?? 7 * 60;
      activeDays = Array.isArray(active.activeDays) ? [...active.activeDays] : [];

      renderDayChips(dayChips, activeDays);
      renderScheduleSelect();
      renderDial();
      renderOverlapWarning();
    }

    function renderDial() {
      bedText.textContent = SleepApp.time.minutesToTimeString(bedMinutes);
      wakeText.textContent = SleepApp.time.minutesToTimeString(wakeMinutes);
      bedtimeInput.value = SleepApp.time.minutesToTimeString(bedMinutes);
      wakeInput.value = SleepApp.time.minutesToTimeString(wakeMinutes);
      setHandlePosition(dial, handleBed, bedMinutes);
      setHandlePosition(dial, handleWake, wakeMinutes);
      arc.setAttribute("d", arcPathMinutes(bedMinutes, wakeMinutes));

      const durationMin = SleepApp.time.durationBetweenMinutes(bedMinutes, wakeMinutes);
      dialDuration.textContent = `${Math.floor(durationMin / 60)}h ${SleepApp.time.pad2(durationMin % 60)}m`;

      handleBed.setAttribute("aria-valuetext", bedText.textContent);
      handleWake.setAttribute("aria-valuetext", wakeText.textContent);
    }

    renderScheduleSelect();
    loadActiveScheduleIntoUI();

    if (createWeekdayWeekend) {
      createWeekdayWeekend.addEventListener("click", () => {
        // Only used for first-time setup; does not delete any existing user data.
        if (store.hasKey(store.KEYS.schedule)) return;

        scheduleState = {
          version: 2,
          activeScheduleId: "weekdays",
          schedules: [
            { id: "weekdays", name: "Weekdays", activeDays: [1, 2, 3, 4, 5], bedtime: "23:00", wakeTime: "07:00" },
            { id: "weekend", name: "Weekend", activeDays: [6, 0], bedtime: "00:00", wakeTime: "08:00" },
          ],
        };
        store.setSchedule(scheduleState);
        if (scheduleEmptyState) scheduleEmptyState.hidden = true;
        recomputeSessionsAfterScheduleChange();
        activeScheduleId = scheduleState.activeScheduleId;
        renderScheduleSelect();
        loadActiveScheduleIntoUI();
        setStatus("Created.");
        window.dispatchEvent(new CustomEvent("sleepapp:scheduleChanged", { detail: { schedule: scheduleState } }));
      });
    }

    // Keep handles positioned on resize.
    const ro = new ResizeObserver(() => renderDial());
    ro.observe(dial);

    dayChips.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.matches("button[data-day]")) return;
      const day = Number(target.dataset.day);
      if (!Number.isFinite(day)) return;
      if (activeDays.includes(day)) activeDays = activeDays.filter((d) => d !== day);
      else activeDays = [...activeDays, day];
      renderDayChips(dayChips, activeDays);
      renderOverlapWarning();
    });

    function minutesFromPointer(event) {
      const rect = dial.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = event.clientX - cx;
      const dy = event.clientY - cy;
      const angle = Math.atan2(dy, dx);
      return angleToMinutes(angle);
    }

    let dragging = null; // "bed" | "wake"
    let pendingDrag = null; // { pointerId, startX, startY, kind, handleEl }
    let activeHandleEl = null;
    const isCoarsePointer = Boolean(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    const DRAG_ACTIVATION_DISTANCE_PX = 10;
    const VERTICAL_SCROLL_CANCEL_RATIO = 1.25;

    // Mobile-only subtle haptics (optional).
    function subtleHapticTap(ms = 10) {
      if (!isCoarsePointer) return;
      if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
      try {
        navigator.vibrate(Math.max(1, Math.round(Number(ms) || 10)));
      } catch {
        // no-op
      }
    }

    function onPointerDown(event) {
      if (!(event instanceof PointerEvent)) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;

      // Mobile gesture handling:
      // - Only start tracking if the user touches a handle (prevents accidental drags while scrolling).
      // - Wait for a small movement threshold before confirming drag (avoids scroll-locking).
      // - If the initial movement is mostly vertical, cancel drag so the page can scroll.
      if (isCoarsePointer) {
        if (!event.isPrimary) return;
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const handle = target.closest(".time-dial__handle");
        if (!(handle instanceof HTMLElement)) return;
        const kind = handle === handleWake ? "wake" : "bed";
        pendingDrag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, kind, handleEl: handle };
        return;
      }

      event.preventDefault();
      const closest = findClosestHandle(event.clientX, event.clientY, [handleBed, handleWake]);
      dragging = closest === handleWake ? "wake" : "bed";
      dial.setPointerCapture(event.pointerId);
      dial.classList.add("is-dragging");
      onPointerMove(event);
    }

    function onPointerMove(event) {
      if (!(event instanceof PointerEvent)) return;
      if (!dragging && pendingDrag && pendingDrag.pointerId === event.pointerId) {
        const dx = event.clientX - pendingDrag.startX;
        const dy = event.clientY - pendingDrag.startY;
        const dist = Math.hypot(dx, dy);
        if (dist < DRAG_ACTIVATION_DISTANCE_PX) return;

        if (Math.abs(dy) > Math.abs(dx) * VERTICAL_SCROLL_CANCEL_RATIO) {
          pendingDrag = null;
          return;
        }

        event.preventDefault();
        dragging = pendingDrag.kind;
        activeHandleEl = pendingDrag.handleEl || null;
        pendingDrag = null;
        subtleHapticTap(10);
        dial.classList.add("is-dragging");
        dial.style.touchAction = "none";
        if (activeHandleEl) activeHandleEl.style.touchAction = "none";
        try {
          dial.setPointerCapture(event.pointerId);
        } catch {
          // no-op
        }
      }

      if (!dragging) return;

      const minutes = snapMinutes(minutesFromPointer(event), 5);
      if (dragging === "bed") bedMinutes = ((minutes % 1440) + 1440) % 1440;
      else wakeMinutes = ((minutes % 1440) + 1440) % 1440;
      renderDial();
    }

    function onPointerUp(event) {
      if (!(event instanceof PointerEvent)) return;
      if (pendingDrag && pendingDrag.pointerId === event.pointerId) pendingDrag = null;
      if (!dragging) return;
      dragging = null;
      dial.classList.remove("is-dragging");
      dial.style.touchAction = "";
      if (activeHandleEl) activeHandleEl.style.touchAction = "";
      activeHandleEl = null;
      try {
        dial.releasePointerCapture(event.pointerId);
      } catch {
        // no-op
      }
    }

    dial.addEventListener("pointerdown", onPointerDown);
    dial.addEventListener("pointermove", onPointerMove);
    dial.addEventListener("pointerup", onPointerUp);
    dial.addEventListener("pointercancel", onPointerUp);

    bedtimeInput.addEventListener("change", () => {
      const minutes = SleepApp.time.parseTimeToMinutes(bedtimeInput.value);
      if (minutes === null) return;
      bedMinutes = minutes;
      renderDial();
    });
    wakeInput.addEventListener("change", () => {
      const minutes = SleepApp.time.parseTimeToMinutes(wakeInput.value);
      if (minutes === null) return;
      wakeMinutes = minutes;
      renderDial();
    });

    scheduleSelect.addEventListener("change", () => {
      // Save any edits on the previous schedule before switching.
      saveActiveScheduleFromUI();
      setActiveScheduleId(scheduleSelect.value);
      loadActiveScheduleIntoUI();
      setStatus("Switched.");
    });

    scheduleName.addEventListener("input", () => {
      const schedules = scheduleState.schedules || [];
      const idx = schedules.findIndex((s) => s.id === activeScheduleId);
      if (idx >= 0) schedules[idx].name = String(scheduleName.value || "").trim() || schedules[idx].name;
      scheduleState.schedules = schedules;
      renderScheduleSelect();
      scheduleSelect.value = activeScheduleId;
    });

    addScheduleBtn.addEventListener("click", () => {
      // Create a new schedule by copying times but leaving days empty (so it won't conflict by default).
      const active = getActiveSchedule();
      const used = new Set();
      for (const s of scheduleState.schedules || []) {
        for (const d of s.activeDays || []) used.add(d);
      }
      const allDays = [1, 2, 3, 4, 5, 6, 0];
      const unusedDays = allDays.filter((d) => !used.has(d));
      const nameHint =
        unusedDays.length === 2 && unusedDays.includes(6) && unusedDays.includes(0)
          ? "Weekend"
          : unusedDays.length === 5 && [1, 2, 3, 4, 5].every((d) => unusedDays.includes(d))
            ? "Weekdays"
            : null;
      const next = {
        id: uuid(),
        name: nameHint || `Schedule ${(scheduleState.schedules?.length || 0) + 1}`,
        activeDays: unusedDays,
        bedtime: active?.bedtime || "23:00",
        wakeTime: active?.wakeTime || "07:00",
      };
      scheduleState.schedules = [...(scheduleState.schedules || []), next];
      scheduleState.activeScheduleId = next.id;
      store.setSchedule(scheduleState);
      if (scheduleEmptyState) scheduleEmptyState.hidden = true;
      recomputeSessionsAfterScheduleChange();
      activeScheduleId = next.id;
      renderScheduleSelect();
      loadActiveScheduleIntoUI();
      setStatus("Added.");
      window.dispatchEvent(new CustomEvent("sleepapp:scheduleChanged", { detail: { schedule: scheduleState } }));
    });

    duplicateScheduleBtn.addEventListener("click", () => {
      const active = getActiveSchedule();
      if (!active) return;
      const next = {
        ...active,
        id: uuid(),
        name: `${active.name || "Schedule"} Copy`,
      };
      scheduleState.schedules = [...(scheduleState.schedules || []), next];
      scheduleState.activeScheduleId = next.id;
      store.setSchedule(scheduleState);
      if (scheduleEmptyState) scheduleEmptyState.hidden = true;
      recomputeSessionsAfterScheduleChange();
      activeScheduleId = next.id;
      renderScheduleSelect();
      loadActiveScheduleIntoUI();
      setStatus("Duplicated.");
      window.dispatchEvent(new CustomEvent("sleepapp:scheduleChanged", { detail: { schedule: scheduleState } }));
    });

    deleteScheduleBtn.addEventListener("click", () => {
      const schedules = scheduleState.schedules || [];
      if (schedules.length <= 1) return;
      const nextSchedules = schedules.filter((s) => s.id !== activeScheduleId);
      scheduleState.schedules = nextSchedules;
      scheduleState.activeScheduleId = nextSchedules[0].id;
      store.setSchedule(scheduleState);
      if (scheduleEmptyState) scheduleEmptyState.hidden = true;
      recomputeSessionsAfterScheduleChange();
      activeScheduleId = scheduleState.activeScheduleId;
      renderScheduleSelect();
      loadActiveScheduleIntoUI();
      setStatus("Deleted.");
      window.dispatchEvent(new CustomEvent("sleepapp:scheduleChanged", { detail: { schedule: scheduleState } }));
    });

    el("saveSchedule").addEventListener("click", () => {
      saveActiveScheduleFromUI();
      setStatus("Saved.");
    });

    el("resetSchedule").addEventListener("click", () => {
      // Reset only the currently selected schedule to defaults.
      const defaults = store.defaults().schedule;
      const defSchedule = defaults.schedules[0];
      const schedules = scheduleState.schedules || [];
      const idx = schedules.findIndex((s) => s.id === activeScheduleId);
      if (idx >= 0) {
        schedules[idx] = {
          ...schedules[idx],
          bedtime: defSchedule.bedtime,
          wakeTime: defSchedule.wakeTime,
          // Keep days as-is; only reset times.
          activeDays: Array.isArray(schedules[idx].activeDays) ? schedules[idx].activeDays : [],
        };
        scheduleState.schedules = schedules;
        store.setSchedule(scheduleState);
        recomputeSessionsAfterScheduleChange();
      }
      loadActiveScheduleIntoUI();
      setStatus("Reset.");
      window.dispatchEvent(new CustomEvent("sleepapp:scheduleChanged", { detail: { schedule: scheduleState } }));
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (document.body?.dataset?.page !== "schedule") return;
    initSchedulePage();
  });
})();
