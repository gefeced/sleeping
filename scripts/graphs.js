/* graphs.js
   Canvas graph rendering for home + analytics.
*/

(function () {
  "use strict";

  const SleepApp = (window.SleepApp = window.SleepApp || {});

  function clear(canvas) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return ctx;
  }

  function withHiDPIScaling(canvas, draw) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const cssWidth = canvas.clientWidth || canvas.width;
    const cssHeight = canvas.clientHeight || canvas.height;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, cssWidth, cssHeight);
  }

  function theme() {
    return {
      bg: "#060914",
      panel: "#0a1024",
      grid: "rgba(130,170,255,0.14)",
      text: "rgba(235,245,255,0.9)",
      muted: "rgba(235,245,255,0.55)",
      blue: "rgba(95,170,255,0.95)",
      blueGlow: "rgba(95,170,255,0.38)",
      yellow: "rgba(255,205,95,0.9)",
      red: "rgba(255,95,110,0.9)",
      line: "rgba(255,255,255,0.22)",
    };
  }

  function aggregateMinutesByDateKey(sessions) {
    const out = new Map();
    for (const s of sessions) {
      if (!s?.end) continue;
      const key = SleepApp.sleepTracker?.getSessionDateKey?.(s) || SleepApp.time.dateKeyFromISO(s.end);
      if (!key) continue;
      const minutes = Number(s.durationMinutes);
      if (!Number.isFinite(minutes) || minutes <= 0) continue;
      out.set(key, (out.get(key) || 0) + minutes);
    }
    return out;
  }

  function lastNDays(n) {
    const days = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      days.push(SleepApp.time.toDateKeyLocal(d));
    }
    return days;
  }

  function dayLabel(dateKey) {
    // dateKey: YYYY-MM-DD
    const d = new Date(dateKey + "T00:00:00");
    const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return labels[d.getDay()];
  }

  function niceHoursLabel(minutes) {
    const hours = minutes / 60;
    if (hours % 1 === 0) return `${hours}h`;
    return `${hours.toFixed(1)}h`;
  }

  function drawGrid(ctx, width, height, plot, yTicks = 4) {
    const t = theme();
    ctx.save();
    ctx.strokeStyle = t.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    for (let i = 0; i <= yTicks; i++) {
      const y = plot.top + (plot.height * i) / yTicks;
      ctx.beginPath();
      ctx.moveTo(plot.left, y);
      ctx.lineTo(plot.left + plot.width, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBars(ctx, width, height, data, options) {
    const t = theme();
    const padding = 18;
    const plot = { left: padding, top: padding, width: width - padding * 2, height: height - padding * 2 - 18 };

    const maxValue = Math.max(1, ...data.map((d) => d.value));
    const maxY = options?.maxY ?? maxValue;

    drawGrid(ctx, width, height, plot, 4);

    const barGap = 8;
    const barWidth = (plot.width - barGap * (data.length - 1)) / data.length;

    ctx.save();
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = t.muted;
    ctx.textAlign = "center";

    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const x = plot.left + i * (barWidth + barGap);
      const h = plot.height * (item.value / maxY);
      const y = plot.top + plot.height - h;

      ctx.shadowColor = t.blueGlow;
      ctx.shadowBlur = 12;
      ctx.fillStyle = item.color || t.blue;
      ctx.fillRect(x, y, barWidth, h);
      ctx.shadowBlur = 0;

      if (item.label) {
        ctx.fillStyle = t.muted;
        ctx.fillText(item.label, x + barWidth / 2, plot.top + plot.height + 16);
      }
    }
    ctx.restore();

    if (options?.targetValue) {
      const y = plot.top + plot.height - (plot.height * options.targetValue) / maxY;
      ctx.save();
      ctx.strokeStyle = t.line;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(plot.left, y);
      ctx.lineTo(plot.left + plot.width, y);
      ctx.stroke();
      ctx.restore();
    }
  }

  function startOfWeekMonday(date) {
    const d = new Date(date);
    const day = (d.getDay() + 6) % 7; // Mon=0 .. Sun=6
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - day);
    return d;
  }

  function weekKey(date) {
    const start = startOfWeekMonday(date);
    return SleepApp.time.toDateKeyLocal(start);
  }

  function monthKey(date) {
    const year = date.getFullYear();
    const month = SleepApp.time.pad2(date.getMonth() + 1);
    return `${year}-${month}`;
  }

  function pickScheduleForDate(scheduleState, date) {
    if (!scheduleState) return null;
    const day = date.getDay();
    if (Array.isArray(scheduleState.schedules)) {
      const schedules = scheduleState.schedules.filter((s) => s && typeof s === "object");
      return schedules.find((s) => Array.isArray(s.activeDays) && s.activeDays.includes(day)) || schedules[0] || null;
    }
    if (typeof scheduleState === "object") return scheduleState;
    return null;
  }

  function computeConsistencyMinutes(sessions, scheduleState) {
    const diffs = [];
    const cache = new Map(); // scheduleId/name -> {bed,wake}

    for (const s of sessions) {
      if (!s?.start || !s?.end) continue;
      const start = new Date(s.start);
      const end = new Date(s.end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;

      const schedule = pickScheduleForDate(scheduleState, end);
      if (!schedule) continue;

      const key = schedule.id || schedule.name || "schedule";
      let parsed = cache.get(key);
      if (!parsed) {
        const bed = SleepApp.time.parseTimeToMinutes(schedule.bedtime);
        const wake = SleepApp.time.parseTimeToMinutes(schedule.wakeTime);
        parsed = bed === null || wake === null ? null : { bed, wake };
        cache.set(key, parsed);
      }
      if (!parsed) continue;

      const startMinutes = start.getHours() * 60 + start.getMinutes();
      const endMinutes = end.getHours() * 60 + end.getMinutes();
      diffs.push(Math.abs(SleepApp.time.diffMinutesWrap(parsed.bed, startMinutes)));
      diffs.push(Math.abs(SleepApp.time.diffMinutesWrap(parsed.wake, endMinutes)));
    }

    if (diffs.length === 0) return null;
    return diffs.reduce((a, b) => a + b, 0) / diffs.length;
  }

  function renderMiniGraph(canvas) {
    const sessions = SleepApp.storage.getSessions();
    const map = aggregateMinutesByDateKey(sessions);
    const days = lastNDays(14);

    const items = days.map((key) => ({
      label: dayLabel(key).slice(0, 1),
      value: map.get(key) || 0,
      color: theme().blue,
    }));

    withHiDPIScaling(canvas, (ctx, width, height) => {
      ctx.fillStyle = "transparent";
      ctx.clearRect(0, 0, width, height);

      const goals = SleepApp.storage.getGoals();
      const target = goals?.defaultGoalMinutes || 8 * 60;
      drawBars(ctx, width, height, items, { maxY: Math.max(target * 1.3, 10), targetValue: target });
    });
  }

  function renderAnalytics(canvas, view, metric = null) {
    const sessions = SleepApp.storage.getSessions();
    const goals = SleepApp.storage.getGoals();
    const schedule = SleepApp.storage.getSchedule();
    const t = theme();
    const safeMetric = metric === "consistency" ? "consistency" : "duration";

    withHiDPIScaling(canvas, (ctx, width, height) => {
      ctx.clearRect(0, 0, width, height);

      if (sessions.length === 0) {
        ctx.save();
        ctx.fillStyle = t.muted;
        ctx.font = "15px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("No sessions yet. Record sleep on Home.", width / 2, height / 2);
        ctx.restore();
        return;
      }

      if (view === "daily") {
        const map = aggregateMinutesByDateKey(sessions);
        const days = lastNDays(14);
        const target = goals?.defaultGoalMinutes || 8 * 60;
        const items = days.map((key) => ({
          label: dayLabel(key),
          value: map.get(key) || 0,
          color: t.blue,
        }));
        drawBars(ctx, width, height, items, { maxY: Math.max(target * 1.3, 10), targetValue: target });
        return;
      }

      if (view === "weekly") {
        const byWeek = new Map();
        for (const s of sessions) {
          if (!s?.end) continue;
          const end = new Date(s.end);
          const key = weekKey(end);
          const arr = byWeek.get(key) || [];
          arr.push(s);
          byWeek.set(key, arr);
        }

        const weeks = [...byWeek.keys()].sort().slice(-12);
        const items = weeks.map((key) => {
          const arr = byWeek.get(key) || [];
          if (safeMetric === "consistency") {
            // Consistency: lower avg diff -> higher score.
            const avgDiff = computeConsistencyMinutes(arr, schedule);
            const value = avgDiff === null ? 0 : Math.round(SleepApp.time.clamp(100 - (avgDiff / 180) * 100, 0, 100));
            return { label: key.slice(5), value, color: t.blue };
          }
          const values = arr.map((s) => Number(s.durationMinutes)).filter((m) => Number.isFinite(m) && m > 0);
          const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
          return { label: key.slice(5), value: avg, color: t.blue };
        });

        if (safeMetric === "consistency") drawBars(ctx, width, height, items, { maxY: 100, targetValue: 85 });
        else {
          const target = goals?.defaultGoalMinutes || 8 * 60;
          drawBars(ctx, width, height, items, { maxY: Math.max(target * 1.3, 10), targetValue: target });
        }
        return;
      }

      // monthly
      const byMonth = new Map();
      for (const s of sessions) {
        if (!s?.end) continue;
        const end = new Date(s.end);
        const key = monthKey(end);
        const arr = byMonth.get(key) || [];
        arr.push(s);
        byMonth.set(key, arr);
      }

      const months = [...byMonth.keys()].sort().slice(-12);
      const items = months.map((key) => {
        const arr = byMonth.get(key) || [];
        if (safeMetric === "consistency") {
          const avgDiff = computeConsistencyMinutes(arr, schedule);
          const value = avgDiff === null ? 0 : Math.round(SleepApp.time.clamp(100 - (avgDiff / 180) * 100, 0, 100));
          return { label: key.slice(5), value, color: t.blue };
        }
        const values = arr.map((s) => Number(s.durationMinutes)).filter((m) => Number.isFinite(m) && m > 0);
        const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        return { label: key.slice(5), value: avg, color: t.blue };
      });

      if (safeMetric === "consistency") drawBars(ctx, width, height, items, { maxY: 100, targetValue: 85 });
      else {
        const target = goals?.defaultGoalMinutes || 8 * 60;
        drawBars(ctx, width, height, items, { maxY: Math.max(target * 1.3, 10), targetValue: target });
      }
    });
  }

  function renderLegend(view, metric, node) {
    if (!node) return;
    const safeMetric = metric === "consistency" ? "consistency" : "duration";
    if (safeMetric === "consistency") node.innerHTML = `<span class="legend__swatch"></span>Consistency (higher is better)`;
    else node.innerHTML = `<span class="legend__swatch"></span>${view === "daily" ? "Duration" : "Avg duration"}`;
  }

  function renderAnalyticsSummary(node) {
    if (!node) return;
    const sessions = SleepApp.storage
      .getSessions()
      .filter((s) => s?.end && Number.isFinite(s?.durationMinutes))
      .sort((a, b) => new Date(a.end).getTime() - new Date(b.end).getTime());
    if (sessions.length === 0) {
      node.textContent = "No data yet";
      return;
    }
    const recent = sessions.slice(-7);
    const avg = recent.reduce((a, s) => a + Number(s.durationMinutes), 0) / recent.length;
    node.textContent = `7-day avg: ${niceHoursLabel(avg)}`;
  }

  function renderSessionList(container, options = {}) {
    if (!container) return;
    const sessionsSource = Array.isArray(options.sessions)
      ? options.sessions
      : SleepApp.storage.getSessions().filter((s) => s?.start && s?.end);
    const sessions = sessionsSource.filter((s) => s?.start && s?.end);
    const sortedAll = sessions.sort((a, b) => new Date(b.end).getTime() - new Date(a.end).getTime());
    const limit = options.limit === undefined ? 20 : options.limit;
    const sorted = limit === null ? sortedAll : sortedAll.slice(0, Math.max(0, limit));

    container.innerHTML = "";
    if (sorted.length === 0) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "No sessions yet.";
      container.append(empty);
      return;
    }

    container.classList.toggle("session-list--history", limit === null || (typeof limit === "number" && limit > 20));

    for (const s of sorted) {
      const endKey = (SleepApp.sleepTracker?.getSessionDateKey?.(s) || SleepApp.time.dateKeyFromISO(s.end)) || "—";
      const duration = SleepApp.time.formatDuration(Number(s.durationMs));
      const score = Number.isFinite(s.score) ? Math.round(s.score) : null;
      const scoreText = score === null ? "—" : String(score);
      const scoreClass = score === null ? "" : score >= 80 ? "is-good" : score >= 65 ? "is-okay" : "is-poor";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "history-item";
      btn.dataset.sessionId = s.id;
      btn.setAttribute("aria-label", `Edit session ${endKey}`);

      const left = document.createElement("div");
      left.className = "history-item__left";
      const date = document.createElement("div");
      date.className = "history-item__date";
      date.textContent = endKey;
      const times = document.createElement("div");
      times.className = "history-item__times";
      times.textContent = `${SleepApp.time.formatTimeFromISO(s.start)} – ${SleepApp.time.formatTimeFromISO(s.end)} • ${duration}`;
      left.append(date, times);

      const right = document.createElement("div");
      right.className = "history-item__right";

      const scorePill = document.createElement("span");
      scorePill.className = "pill-score " + scoreClass;
      scorePill.textContent = scoreText;
      scorePill.title = "Sleep score";

      right.append(scorePill);
      btn.append(left, right);
      container.append(btn);
    }
  }

  SleepApp.graphs = {
    renderMiniGraph,
    renderAnalytics,
    renderLegend,
    renderAnalyticsSummary,
    renderSessionList,
  };
})();
