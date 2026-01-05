/* time.js
   Live clock + time/date formatting helpers.
*/

(function () {
  "use strict";

  const SleepApp = (window.SleepApp = window.SleepApp || {});

  function pad2(number) {
    return String(number).padStart(2, "0");
  }

  function clamp(number, min, max) {
    return Math.min(max, Math.max(min, number));
  }

  function toDateKeyLocal(date) {
    const year = date.getFullYear();
    const month = pad2(date.getMonth() + 1);
    const day = pad2(date.getDate());
    return `${year}-${month}-${day}`;
  }

  function dateKeyFromISO(isoString) {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return null;
    return toDateKeyLocal(date);
  }

  function formatClock(date) {
    const hours24 = date.getHours();
    const minutes = pad2(date.getMinutes());
    const ampm = hours24 >= 12 ? "PM" : "AM";
    const hours12 = hours24 % 12 || 12;
    return `${hours12}:${minutes} ${ampm}`;
  }

  function formatTimeFromISO(isoString) {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return "—";
    return formatClock(date);
  }

  function parseTimeToMinutes(timeString) {
    if (typeof timeString !== "string") return null;
    const match = /^(\d{1,2}):(\d{2})$/.exec(timeString.trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  function minutesToTimeString(totalMinutes) {
    const minutes = ((totalMinutes % 1440) + 1440) % 1440;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${pad2(hours)}:${pad2(mins)}`;
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "—";
    const totalMinutes = Math.round(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours <= 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
  }

  function diffMinutesWrap(fromMinutes, toMinutes) {
    // Signed shortest difference in minutes on a 24h clock (-720..720).
    const a = ((fromMinutes % 1440) + 1440) % 1440;
    const b = ((toMinutes % 1440) + 1440) % 1440;
    let diff = b - a;
    if (diff > 720) diff -= 1440;
    if (diff < -720) diff += 1440;
    return diff;
  }

  function durationBetweenMinutes(startMinutes, endMinutes) {
    // Duration moving forward from start to end (0..1440).
    const s = ((startMinutes % 1440) + 1440) % 1440;
    const e = ((endMinutes % 1440) + 1440) % 1440;
    if (e >= s) return e - s;
    return 1440 - s + e;
  }

  function startLiveClock(element, options = {}) {
    if (!element) return () => {};
    const updateIntervalMs = Number.isFinite(options.updateIntervalMs) ? options.updateIntervalMs : 1000;

    function tick() {
      element.textContent = formatClock(new Date());
    }

    tick();
    const id = window.setInterval(tick, updateIntervalMs);
    return () => window.clearInterval(id);
  }

  SleepApp.time = {
    pad2,
    clamp,
    toDateKeyLocal,
    dateKeyFromISO,
    formatClock,
    formatTimeFromISO,
    parseTimeToMinutes,
    minutesToTimeString,
    formatDuration,
    diffMinutesWrap,
    durationBetweenMinutes,
    startLiveClock,
  };
})();

