import { firebaseConfig } from "./firebase-config.js";

// ---------- The group ----------
// Everyone picks their name from this list. To add someone, add a line here.

const FRIENDS = [
  "Legs Diamond",
  "Dr. Michael Hornycakes",
  'Mike "The Muz" Bernstein',
  "O-dog Epstein",
  'The Honorable Darren "The Blade" Rubin',
  'Seth "The Medford Menace" Kleinman',
  "Topher Grace",
];

// Each friend's color, in the same order as the list above.
const COLORS = ["#d6336c", "#d9480f", "#2b8a3e", "#1971c2", "#6741d9", "#0b7285", "#9c36b5", "#8d5524"];
const colorOf = (name) => COLORS[Math.max(0, FRIENDS.indexOf(name)) % COLORS.length];

// There's only one trip, so everyone uses the same plan, saved under this name.
const MAIN_TRIP_ID = "darrens-weekend";

// Turns a name into a short id for saving, e.g. "O-dog Epstein" -> "o-dog-epstein".
const friendId = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---------- Small helpers ----------

const $ = (selector) => document.querySelector(selector);

// Makes text safe to put inside HTML (so a name like "<b>" shows as text).
const escapeHTML = (text) =>
  String(text ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function remember(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private window: ignore */ }
}
function recall(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

// ---------- Dates ----------
// Each day is stored as text like "2026-11-07". A weekend is named by its Saturday.

function dateToKey(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function keyToDate(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// The calendar's last day.
const DEFAULT_END_DATE = "2027-04-30";

// Moves a day forward (or back, with a negative number) by some days.
function addDays(key, days) {
  const date = keyToDate(key);
  date.setDate(date.getDate() + days);
  return dateToKey(date);
}

// Plans made before there was an end date counted weeks (or, earlier, weekends) instead.
const endDate = (trip) => trip.endDate ?? addDays(trip.startDate, (trip.weekCount ?? trip.weekendCount) * 7 - 1);

// Every day shown on the calendar.
function dayKeys(trip) {
  const keys = [];
  for (let key = trip.startDate; key <= endDate(trip); key = addDays(key, 1)) keys.push(key);
  return keys;
}

// The Saturdays on the calendar whose Sunday is on it too.
function weekendKeys(trip) {
  const last = endDate(trip);
  return dayKeys(trip).filter((key) => keyToDate(key).getDay() === 6 && key < last);
}

// The days of the weekend named by this Saturday that are on the calendar: Friday, Saturday, Sunday.
const weekendDays = (key) => [addDays(key, -1), key, addDays(key, 1)].filter((day) => day >= trip.startDate);

function weekendLabel(key) {
  const days = weekendDays(key).map(keyToDate);
  const short = (d) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return `${short(days[0])} – ${short(days.at(-1))}`;
}

// ---------- Saving and loading ----------
// Both versions offer the same two things:
//   listen(tripId, callback) – calls callback with the plan now and after every change
//   save(path, value)        – saves value at a path like "trips/abc/name" (null deletes it)

async function connectToFirebase() {
  const version = "10.12.2";
  const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`);
  const db = await import(`https://www.gstatic.com/firebasejs/${version}/firebase-database.js`);
  const database = db.getDatabase(initializeApp(firebaseConfig));
  return {
    online: true,
    listen(tripId, callback) {
      db.onValue(db.ref(database, `trips/${tripId}`), (snapshot) => callback(snapshot.val()));
    },
    save(path, value) {
      return db.set(db.ref(database, path), value);
    },
  };
}

// Practice mode: keeps everything in this browser only.
function practiceStorage() {
  const KEY = "weekendPlanner.practiceData";
  const readAll = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  };
  const valueAt = (data, path) => path.split("/").reduce((node, part) => node?.[part], data) ?? null;
  const listeners = [];
  const tellListeners = () => {
    const data = readAll();
    listeners.forEach(({ tripId, callback }) => callback(valueAt(data, `trips/${tripId}`)));
  };
  // Lets two tabs of the same browser see each other's changes.
  window.addEventListener("storage", (event) => { if (event.key === KEY) tellListeners(); });

  return {
    online: false,
    listen(tripId, callback) {
      listeners.push({ tripId, callback });
      callback(valueAt(readAll(), `trips/${tripId}`));
    },
    save(path, value) {
      const data = readAll();
      const parts = path.split("/");
      const last = parts.pop();
      let node = data;
      for (const part of parts) node = node[part] ??= {};
      if (value === null) delete node[last]; else node[last] = value;
      remember(KEY, JSON.stringify(data));
      tellListeners();
      return Promise.resolve();
    },
  };
}

// ---------- App state ----------

let storage;
// Links sent out before there was one fixed plan end in "?trip=...", so they still open that plan.
let tripId = new URLSearchParams(location.search).get("trip") || MAIN_TRIP_ID;
let trip = null;   // the whole plan, as last loaded
let me = null;     // the id of the person using this browser
let calendarMode = "mine";  // "mine" = tap to mark your days, "everyone" = see the group's answers
let selectedDay = null;     // the day whose answers are listed under the calendar
let settingUpPlan = false;  // true while the first visit saves the plan's dates

// Everyone in FRIENDS, with whatever they've saved on this plan.
const people = () => Object.fromEntries(FRIENDS.map((name) => {
  const id = friendId(name);
  return [id, { ...trip.people?.[id], name }];
}));
const iHaveJoined = () => Boolean(me && people()[me]);
const tripPath = (rest = "") => `trips/${tripId}${rest ? "/" + rest : ""}`;

function show(id) {
  for (const screen of ["loading", "missing-screen", "trip-screen"]) {
    $("#" + screen).hidden = screen !== id;
  }
}

// ---------- Plan screen ----------

function openTrip() {
  me = recall(`weekendPlanner.me.${tripId}`);
  setUpTripControls();
  storage.listen(tripId, (data) => {
    trip = data;
    // The very first visit sets up the plan: the calendar runs from that day to DEFAULT_END_DATE.
    // (Saving each part separately never wipes out answers someone else saved meanwhile.)
    // Wait until both dates are saved before drawing, or the calendar has no end.
    if (tripId === MAIN_TRIP_ID && !(trip?.startDate && trip?.endDate)) {
      if (!settingUpPlan) {
        settingUpPlan = true;
        if (!trip?.startDate) storage.save(tripPath("startDate"), dateToKey(new Date()));
        if (!trip?.endDate) storage.save(tripPath("endDate"), DEFAULT_END_DATE);
      }
      return;
    }
    if (!trip) { show("missing-screen"); return; }
    show("trip-screen");
    render();
  });
}

function setMe(personId) {
  me = personId;
  remember(`weekendPlanner.me.${tripId}`, personId ?? "");
  render();
}

function render() {
  renderMe();
  renderBestWeekend();
  renderCalendar();
}

// "Who are you?"
function renderMe() {
  if (iHaveJoined()) {
    $("#me-area").innerHTML = `
      <p>You're ${nameChip(people()[me].name)}
      <button type="button" class="link" data-action="switch-person">Not you?</button></p>`;
  } else {
    $("#me-area").innerHTML = `
      <p class="muted">Tap your name.</p>
      <div class="chips">${Object.entries(people()).map(([id, person]) =>
        `<button type="button" class="person" style="--person: ${colorOf(person.name)}"
          data-action="pick-person" data-id="${id}">${escapeHTML(person.name)}</button>`).join("")}
      </div>`;
  }
}

// Who said ✓ / ? / ✗ for one day, and who hasn't answered.
function dayStats(key) {
  const stats = { yes: [], maybe: [], no: [], none: [] };
  for (const person of Object.values(people())) stats[person.dates?.[key] || "none"].push(person.name);
  return stats;
}

// Works out yes / maybe / no for one weekend (Friday to Sunday):
// ✗ on any of the days = no, ✓ on all of them = yes, anything else marked = maybe.
function weekendStats(key) {
  const days = weekendDays(key);
  const stats = { key, yes: [], maybe: [], no: [] };
  for (const person of Object.values(people())) {
    const answers = days.map((day) => person.dates?.[day]);
    if (answers.includes("no")) stats.no.push(person.name);
    else if (answers.every((a) => a === "yes")) stats.yes.push(person.name);
    else if (answers.some(Boolean)) stats.maybe.push(person.name);
  }
  stats.score = stats.yes.length + stats.maybe.length / 2;
  return stats;
}

function bestWeekend() {
  let best = null;
  for (const key of weekendKeys(trip)) {
    const stats = weekendStats(key);
    if (stats.score > 0 && (!best || stats.score > best.score)) best = stats;
  }
  return best;
}

// A name in its friend's own color.
const nameChip = (name) => `<span class="chip person" style="--person: ${colorOf(name)}">${escapeHTML(name)}</span>`;

const nameChips = (names) => names.map(nameChip).join("");

// The "best weekend so far" box above the calendar.
function renderBestWeekend() {
  const best = bestWeekend();
  const final = trip.finalWeekend;

  if (final) {
    $("#best-area").innerHTML = `
      <div class="highlight final">🎉 It's decided: <strong>${weekendLabel(final)}</strong>
        <button type="button" class="link" data-action="unlock">Change</button></div>`;
  } else if (best) {
    $("#best-area").innerHTML = `
      <div class="highlight">Best so far: <strong>${weekendLabel(best.key)}</strong> —
        ${best.yes.length} can come${best.maybe.length ? `, ${best.maybe.length} maybe` : ""}.
        <button type="button" class="primary" data-action="lock" data-key="${best.key}">Lock it in</button></div>`;
  } else {
    $("#best-area").innerHTML = `<p class="muted">No answers yet. Pick your name, then mark the days on the calendar.</p>`;
  }
}

const MARKS = { yes: "✓", no: "✗", maybe: "?" };
// Tapping a day goes: blank → ✓ → ✗ → ? → blank.
const NEXT_MARK = { none: "yes", yes: "no", no: "maybe", maybe: null };

// The calendar: one grid per month, Sunday to Saturday.
function renderCalendar() {
  const days = dayKeys(trip);
  const shown = new Set(days);
  const myDates = (iHaveJoined() && people()[me].dates) || {};
  const final = trip.finalWeekend;
  const highlighted = final || bestWeekend()?.key;
  const highlightDays = highlighted ? weekendDays(highlighted) : [];
  const mine = calendarMode === "mine";

  $("#calendar-modes").innerHTML = [["mine", "My answers"], ["everyone", "Everyone's answers"]]
    .map(([mode, label]) => `<button type="button" class="answer yes" aria-pressed="${calendarMode === mode}"
      data-action="calendar-mode" data-value="${mode}">${label}</button>`).join("");
  $("#calendar-help").textContent = !mine
    ? "Each day shows how many said ✓ ? ✗. Tap a day to see who."
    : iHaveJoined()
      ? "Tap a day to mark it: ✓ can make it, then ✗ can't, then ? not sure, then blank again."
      : "Pick your name above first.";

  // Group the days into months.
  const months = [];
  for (const key of days) {
    const date = keyToDate(key);
    const monthKey = key.slice(0, 7);
    if (months.at(-1)?.key !== monthKey) months.push({ key: monthKey, first: new Date(date.getFullYear(), date.getMonth(), 1) });
  }

  $("#calendar").innerHTML = months.map(({ first }) => {
    const title = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const cells = Array(first.getDay()).fill(`<span></span>`);
    const day = new Date(first);
    while (day.getMonth() === first.getMonth()) {
      const key = dateToKey(day);
      const number = day.getDate();
      day.setDate(number + 1);
      if (!shown.has(key)) { cells.push(`<span class="day off">${number}</span>`); continue; }

      const classes = ["day", highlightDays.includes(key) && (final ? "final" : "best"), key === selectedDay && !mine && "selected"];
      let inside;
      if (mine) {
        const mark = myDates[key];
        if (mark) classes.push(mark);
        inside = `<span class="mark">${MARKS[mark] || ""}</span>`;
      } else {
        const stats = dayStats(key);
        inside = `<span class="counts">${stats.yes.length ? `<b class="yes">${stats.yes.length}✓</b>` : ""}${
          stats.maybe.length ? `<b class="maybe">${stats.maybe.length}?</b>` : ""}${
          stats.no.length ? `<b class="no">${stats.no.length}✗</b>` : ""}</span>`;
      }
      const action = mine ? "mark-day" : "select-day";
      const disabled = mine && !iHaveJoined() ? "disabled" : "";
      cells.push(`<button type="button" class="${classes.filter(Boolean).join(" ")}" data-action="${action}" data-key="${key}" ${disabled}
        aria-label="${keyToDate(key).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}">
        <span class="number">${number}</span>${inside}</button>`);
    }
    return `
      <div class="month">
        <h3>${title}</h3>
        <div class="grid">${["S", "M", "T", "W", "T", "F", "S"].map((d) => `<span class="weekday">${d}</span>`).join("")}${cells.join("")}</div>
      </div>`;
  }).join("");

  // Who said what on the tapped day.
  if (!mine && selectedDay && shown.has(selectedDay)) {
    const stats = dayStats(selectedDay);
    const group = (title, names) => names.length
      ? `<p class="small"><strong>${title}</strong></p><div class="chips">${nameChips(names)}</div>` : "";
    $("#day-detail").innerHTML = `
      <div class="highlight">
        <p><strong>${keyToDate(selectedDay).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</strong></p>
        ${group("✓ Can make it", stats.yes)}
        ${group("? Not sure", stats.maybe)}
        ${group("✗ Can't", stats.no)}
        ${group("Haven't answered", stats.none)}
      </div>`;
  } else {
    $("#day-detail").innerHTML = "";
  }
}

// ---------- Buttons and forms on the plan screen ----------

function setUpTripControls() {
  $("#more-weeks").addEventListener("click", () => {
    storage.save(tripPath("endDate"), addDays(endDate(trip), 28));
  });

  $("#share-button").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      $("#share-button").textContent = "Link copied!";
      setTimeout(() => ($("#share-button").textContent = "Copy link for friends"), 2000);
    } catch {
      prompt("Copy this link and send it to your friends:", location.href);
    }
  });

  // One listener handles every button that has a data-action.
  $("#trip-screen").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const { action, id, key, value } = button.dataset;

    switch (action) {
      case "pick-person": setMe(id); break;
      case "switch-person": setMe(null); break;
      case "mark-day": {
        const current = people()[me]?.dates?.[key] || "none";
        storage.save(tripPath(`people/${me}/dates/${key}`), NEXT_MARK[current]);
        break;
      }
      case "calendar-mode": calendarMode = value; render(); break;
      case "select-day": selectedDay = key; render(); break;
      case "lock": storage.save(tripPath("finalWeekend"), key); break;
      case "unlock":
        if (confirm("Unlock the weekend so the group can pick again?")) storage.save(tripPath("finalWeekend"), null);
        break;
    }
  });
}

// ---------- Start ----------

try {
  storage = firebaseConfig.databaseURL ? await connectToFirebase() : practiceStorage();
} catch (error) {
  console.error(error);
  $("#loading").textContent = "Couldn't connect to the database. Check the settings in firebase-config.js.";
  throw error;
}
$("#practice-banner").hidden = storage.online;
openTrip();
