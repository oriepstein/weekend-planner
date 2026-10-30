import { firebaseConfig } from "./firebase-config.js";

// ---------- Small helpers ----------

const $ = (selector) => document.querySelector(selector);

// Makes text safe to put inside HTML (so a name like "<b>" shows as text).
const escapeHTML = (text) =>
  String(text ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const newId = () => Math.random().toString(36).slice(2, 10);

function remember(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private window: ignore */ }
}
function recall(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

// ---------- Dates ----------
// A weekend is stored by its Saturday, written as "2026-11-07".

function dateToKey(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function keyToDate(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function weekendKeys(trip) {
  const saturday = keyToDate(trip.startDate);
  saturday.setDate(saturday.getDate() + ((6 - saturday.getDay() + 7) % 7));
  const keys = [];
  for (let i = 0; i < trip.weekendCount; i++) {
    keys.push(dateToKey(saturday));
    saturday.setDate(saturday.getDate() + 7);
  }
  return keys;
}

function weekendLabel(key) {
  const saturday = keyToDate(key);
  const sunday = new Date(saturday);
  sunday.setDate(sunday.getDate() + 1);
  const short = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `Sat ${short(saturday)} – Sun ${short(sunday)}`;
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
let tripId = new URLSearchParams(location.search).get("trip");
let trip = null;   // the whole plan, as last loaded
let me = null;     // the id of the person using this browser

const people = () => trip.people || {};
const iHaveJoined = () => Boolean(me && people()[me]);
const tripPath = (rest = "") => `trips/${tripId}${rest ? "/" + rest : ""}`;

function show(id) {
  for (const screen of ["loading", "start-screen", "missing-screen", "trip-screen"]) {
    $("#" + screen).hidden = screen !== id;
  }
}

// ---------- Start screen ----------

function showStartScreen() {
  show("start-screen");
  $("#create-start").value = dateToKey(new Date());
  $("#create-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = newId();
    await storage.save(`trips/${id}`, {
      name: $("#create-name").value.trim(),
      startDate: $("#create-start").value,
      weekendCount: Number($("#create-count").value),
      createdAt: Date.now(),
    });
    location.search = `?trip=${id}`;
  });
}

// ---------- Plan screen ----------

function openTrip() {
  me = recall(`weekendPlanner.me.${tripId}`);
  setUpTripControls();
  storage.listen(tripId, (data) => {
    trip = data;
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
  document.title = `${trip.name} – Weekend Planner`;
  $("#trip-name").textContent = trip.name;
  renderMe();
  renderWeekends();
  renderRsvp();
  renderItems();
}

// "Who are you?"
function renderMe() {
  const everyone = Object.entries(people()).sort((a, b) => a[1].joinedAt - b[1].joinedAt);
  const known = iHaveJoined() && people()[me];
  $("#join-form").hidden = Boolean(known);

  if (known) {
    $("#me-area").innerHTML = `
      <p>You're <strong>${escapeHTML(known.name)}</strong>.
      <button type="button" class="link" data-action="switch-person">Not you?</button></p>`;
  } else if (everyone.length) {
    $("#me-area").innerHTML = `
      <p class="muted">Tap your name, or add it below if you're new.</p>
      <div class="chips">${everyone.map(([id, person]) =>
        `<button type="button" data-action="pick-person" data-id="${id}">${escapeHTML(person.name)}</button>`).join("")}
      </div>`;
  } else {
    $("#me-area").innerHTML = `<p class="muted">Add your name to get started.</p>`;
  }
}

// Works out yes / maybe / no for one weekend.
function weekendStats(key) {
  const stats = { key, yes: [], maybe: [], no: [] };
  for (const person of Object.values(people())) {
    const answer = person.dates?.[key];
    if (answer) stats[answer].push(person.name);
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

const answerButtons = (kind, current, extra = "") => [
  ["yes", kind === "date" ? "Works" : "Coming"],
  ["maybe", "Maybe"],
  ["no", kind === "date" ? "Can't" : "Can't make it"],
].map(([value, label]) => `
  <button type="button" class="answer ${value}" aria-pressed="${current === value}"
    data-action="answer-${kind}" data-value="${value}" ${extra} ${iHaveJoined() ? "" : "disabled"}>${label}</button>`).join("");

function nameChips(names, kind) {
  return names.map((name) => `<span class="chip ${kind}">${escapeHTML(name)}</span>`).join("");
}

// "Which weekends work?"
function renderWeekends() {
  const best = bestWeekend();
  const final = trip.finalWeekend;
  const myDates = (iHaveJoined() && people()[me].dates) || {};

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
    $("#best-area").innerHTML = `<p class="muted">No answers yet. Mark each weekend: Works, Maybe or Can't.</p>`;
  }

  $("#weekend-list").innerHTML = weekendKeys(trip).map((key) => {
    const stats = weekendStats(key);
    const classes = [key === final && "final", !final && key === best?.key && "best"].filter(Boolean).join(" ");
    return `
      <li class="${classes}">
        <div class="weekend-top">
          <span class="weekend-name">${weekendLabel(key)}</span>
          <span class="muted small">${stats.yes.length} yes · ${stats.maybe.length} maybe · ${stats.no.length} no</span>
        </div>
        <div class="chips">${nameChips(stats.yes, "yes")}${nameChips(stats.maybe, "maybe")}${nameChips(stats.no, "no")}</div>
        <div class="answers">${answerButtons("date", myDates[key], `data-key="${key}"`)}</div>
      </li>`;
  }).join("");
}

// "Who's coming?"
function renderRsvp() {
  const final = trip.finalWeekend;
  if (!final) {
    $("#rsvp-area").innerHTML = `<p class="muted">Once the group locks in a weekend, everyone confirms here.</p>`;
    return;
  }
  // An answer only counts if it was given for the weekend that's locked in now.
  const answerFor = (person) => (person.rsvp?.weekend === final ? person.rsvp.answer : null);
  const groups = { yes: [], maybe: [], no: [], none: [] };
  for (const person of Object.values(people())) groups[answerFor(person) || "none"].push(person.name);
  const mine = iHaveJoined() ? answerFor(people()[me]) : null;

  const group = (title, names, kind) => names.length
    ? `<p><strong>${title} (${names.length})</strong></p><div class="chips">${nameChips(names, kind)}</div>` : "";

  $("#rsvp-area").innerHTML = `
    <p>For <strong>${weekendLabel(final)}</strong>, are you in?</p>
    <div class="answers">${answerButtons("rsvp", mine)}</div>
    ${group("Coming", groups.yes, "yes")}
    ${group("Maybe", groups.maybe, "maybe")}
    ${group("Can't make it", groups.no, "no")}
    ${group("Haven't answered", groups.none, "none")}`;
}

// "Who's bringing what?"
function renderItems() {
  const items = Object.entries(trip.items || {}).sort((a, b) => a[1].createdAt - b[1].createdAt);
  const claimed = items.filter(([, item]) => people()[item.by]).length;
  $("#item-summary").textContent = items.length
    ? `${claimed} of ${items.length} things have someone bringing them.`
    : "Nothing on the list yet. Add what the group needs.";

  $("#item-list").innerHTML = items.map(([id, item]) => {
    const bringer = people()[item.by];
    let status;
    if (bringer && item.by === me) {
      status = `<span class="chip yes">You're bringing it</span>
        <button type="button" class="link" data-action="unclaim" data-id="${id}">Undo</button>`;
    } else if (bringer) {
      status = `<span class="chip yes">${escapeHTML(bringer.name)}</span>`;
    } else {
      status = `<button type="button" data-action="claim" data-id="${id}" ${iHaveJoined() ? "" : "disabled"}>I'll bring it</button>`;
    }
    return `
      <li class="item">
        <span class="item-text">${escapeHTML(item.text)}</span>
        <span class="item-status">${status}
          <button type="button" class="link delete" data-action="delete-item" data-id="${id}" aria-label="Remove ${escapeHTML(item.text)}">✕</button>
        </span>
      </li>`;
  }).join("");
}

// ---------- Buttons and forms on the plan screen ----------

function setUpTripControls() {
  $("#join-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = $("#join-name").value.trim();
    if (!name) return;
    // If that name is already on the plan, treat it as the same person.
    const existing = Object.entries(people()).find(([, p]) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) { setMe(existing[0]); }
    else {
      const id = newId();
      await storage.save(tripPath(`people/${id}`), { name, joinedAt: Date.now() });
      setMe(id);
    }
    $("#join-name").value = "";
  });

  $("#item-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = $("#item-text").value.trim();
    if (!text) return;
    await storage.save(tripPath(`items/${newId()}`), { text, by: null, createdAt: Date.now() });
    $("#item-text").value = "";
  });

  $("#more-weekends").addEventListener("click", () => {
    storage.save(tripPath("weekendCount"), trip.weekendCount + 4);
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
      case "answer-date": {
        const current = people()[me]?.dates?.[key];
        // Tapping the answer you already picked clears it.
        storage.save(tripPath(`people/${me}/dates/${key}`), current === value ? null : value);
        break;
      }
      case "answer-rsvp":
        storage.save(tripPath(`people/${me}/rsvp`), { weekend: trip.finalWeekend, answer: value });
        break;
      case "lock": storage.save(tripPath("finalWeekend"), key); break;
      case "unlock":
        if (confirm("Unlock the weekend so the group can pick again?")) storage.save(tripPath("finalWeekend"), null);
        break;
      case "claim": storage.save(tripPath(`items/${id}/by`), me); break;
      case "unclaim": storage.save(tripPath(`items/${id}/by`), null); break;
      case "delete-item":
        if (confirm("Remove this from the list?")) storage.save(tripPath(`items/${id}`), null);
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
if (tripId) openTrip(); else showStartScreen();
