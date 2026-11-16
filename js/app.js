import {
  INSTRUMENTS, ROOT_CHOICES, analyseChord, chordSymbol, degreeSemis, generatePhrase,
  instrumentById, midiOf, noteName, parseChord, soundingMidi,
} from "./theory.js";
import { PRESETS, presetToBars } from "./presets.js";
import { staffSvg } from "./staff.js";
import { Engine } from "./audio.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const STORAGE_KEY = "impro-grille-v1";
const REPEAT = new Set(["%", "/", "-", "."]);
const engine = new Engine();

/* ------------------------------------------------------------------ état */

const rootPc = (name) => parseChord(name).pc;

const DEFAULT = {
  bars: presetToBars(PRESETS[0], 0),
  inst: "bb-bass",
  names: "fr",
  tempo: 100,
  key: "C",
  preset: PRESETS[0].id,
  loop: true,
  click: true,
};

/** Lit un état venu de l'extérieur (lien, stockage) en ne gardant que du valide. */
function sanitize(raw) {
  const s = { ...DEFAULT };
  if (!raw || typeof raw !== "object") return s;
  if (Array.isArray(raw.bars) && raw.bars.length >= 1 && raw.bars.length <= 64) {
    s.bars = raw.bars.map((b) => String(b).slice(0, 40));
  }
  if (INSTRUMENTS.some((i) => i.id === raw.inst)) s.inst = raw.inst;
  if (raw.names === "fr" || raw.names === "en") s.names = raw.names;
  if (Number.isFinite(raw.tempo)) s.tempo = Math.min(220, Math.max(40, Math.round(raw.tempo)));
  if (ROOT_CHOICES.includes(raw.key)) s.key = raw.key;
  if (PRESETS.some((p) => p.id === raw.preset)) s.preset = raw.preset;
  if (typeof raw.loop === "boolean") s.loop = raw.loop;
  if (typeof raw.click === "boolean") s.click = raw.click;
  return s;
}

function decodeHash() {
  try {
    const m = /[#&]g=([^&]+)/.exec(location.hash);
    if (!m) return null;
    const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  } catch {
    return null;
  }
}

function encodeHash(state) {
  const json = JSON.stringify(state);
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function loadState() {
  const fromHash = decodeHash();
  if (fromHash) return sanitize(fromHash);
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return sanitize(JSON.parse(stored));
  } catch {
    /* stockage indisponible : on part du défaut */
  }
  return { ...DEFAULT };
}

let state = loadState();
let sel = { bar: 0, idx: 0 };
let scalePick = 0;
let phrase = null;
let saveTimer = null;

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* pas grave */
    }
    history.replaceState(null, "", "#g=" + encodeHash(state));
  }, 250);
}

/* --------------------------------------------------------- analyse grille */

const instrument = () => instrumentById(state.inst);

/** Découpe une mesure en accords et leur durée en temps (4/4). */
function resolveGrid() {
  const inst = instrument();
  let prev = null;
  return state.bars.map((text) => {
    const tokens = text.trim().split(/\s+/).filter(Boolean).slice(0, 4);
    const implicit = tokens.length === 0;
    if (implicit) tokens.push("%");
    const beats = { 0: [4], 1: [4], 2: [2, 2], 3: [2, 1, 1], 4: [1, 1, 1, 1] }[tokens.length];
    return tokens.map((tok, i) => {
      let a;
      if (REPEAT.has(tok)) a = prev;
      else a = analyseChord(tok, inst);
      if (a) prev = a;
      return { text: tok, beats: beats[i], a, implicit, invalid: !REPEAT.has(tok) && !a };
    });
  });
}

/* ---------------------------------------------------------------- rendu */

function renderControls() {
  $("#inst").innerHTML = INSTRUMENTS.map((i) => `<option value="${i.id}">${esc(i.label)}</option>`).join("");
  $("#inst").value = state.inst;
  $("#key").innerHTML = ROOT_CHOICES.map((r) => `<option>${r}</option>`).join("");
  $("#key").value = state.key;
  $("#preset").innerHTML = PRESETS.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  $("#preset").value = state.preset;
  $("#names").value = state.names;
  $("#tempo").value = state.tempo;
  $("#tempo-out").textContent = state.tempo;
  $("#loop").checked = state.loop;
  $("#click").checked = state.click;
  $("#preset-info").textContent = PRESETS.find((p) => p.id === state.preset).info;
}

function renderGrid() {
  const grid = $("#grid");
  grid.innerHTML = "";
  state.bars.forEach((text, i) => {
    const cell = document.createElement("div");
    cell.className = "bar";
    cell.dataset.bar = i;
    cell.innerHTML = `
      <span class="bar-num">${i + 1}</span>
      <input class="bar-input" type="text" inputmode="text" autocomplete="off" spellcheck="false"
             aria-label="Accords de la mesure ${i + 1}" placeholder="—" maxlength="40">
      <div class="bar-derived"></div>`;
    const input = cell.querySelector("input");
    input.value = text;
    input.addEventListener("input", () => {
      state.bars[i] = input.value;
      sel = { bar: i, idx: 0 };
      scalePick = 0;
      phrase = null;
      updateDerived();
      save();
    });
    input.addEventListener("focus", () => {
      if (sel.bar !== i) {
        sel = { bar: i, idx: 0 };
        scalePick = 0;
        phrase = null;
        updateDerived();
      }
    });
    grid.append(cell);
  });
  $("#bar-count").textContent = state.bars.length;
  updateDerived();
}

function chipLabel(item) {
  if (item.invalid) return `<span class="chip invalid" title="Accord non reconnu">${esc(item.text)} ?</span>`;
  if (!item.a) return `<span class="chip muted">—</span>`;
  const first = item.a.scales[0].name.split(" (")[0];
  return `${item.implicit || REPEAT.has(item.text) ? "↺ " : ""}${esc(chordSymbol(item.a.writtenRoot, item.a.quality, state.names))}<small>${esc(first)}</small>`;
}

function updateDerived() {
  const resolved = resolveGrid();
  const cells = $("#grid").children;
  resolved.forEach((items, i) => {
    const d = cells[i].querySelector(".bar-derived");
    d.innerHTML = items
      .map((item, k) => {
        if (item.invalid || !item.a) return `<span class="chip ${item.invalid ? "invalid" : "muted"}">${item.invalid ? esc(item.text) + " ?" : "—"}</span>`;
        const on = sel.bar === i && sel.idx === k ? " selected" : "";
        return `<button type="button" class="chip${on}" data-bar="${i}" data-idx="${k}">${chipLabel(item)}</button>`;
      })
      .join("");
    cells[i].classList.toggle("selected", sel.bar === i);
  });
  renderDetail(resolved);
}

function selectedItem(resolved) {
  const items = resolved[sel.bar] ?? [];
  return items[sel.idx] && items[sel.idx].a ? items[sel.idx] : null;
}

function renderDetail(resolved = resolveGrid()) {
  const box = $("#detail");
  const item = selectedItem(resolved);
  if (!item) {
    box.innerHTML = `<p class="hint">Tape un accord dans une mesure (ex. <code>Dm7</code>, <code>G7</code>, <code>Cmaj7</code>) puis clique dessus pour voir ses notes et ses gammes.</p>`;
    return;
  }
  const a = item.a;
  const inst = instrument();
  const style = state.names;
  const tonePcs = new Set(a.tones.map((n) => midiOf(n) % 12));
  const scale = a.scales[Math.min(scalePick, a.scales.length - 1)];
  const flagged = (notes) => notes.map((n) => ({ ...n, tone: tonePcs.has(midiOf(n) % 12) }));

  const transposed = inst.semis !== 0;
  const tabs = a.scales
    .map((s, i) => `<button type="button" role="tab" class="tab" aria-selected="${i === scalePick}" data-scale="${i}">${esc(s.name)}</button>`)
    .join("");

  box.innerHTML = `
    <div class="detail-head">
      <h2>${esc(chordSymbol(a.concertRoot, a.quality, style))}
        ${transposed ? `<span class="arrow" aria-hidden="true">→</span> <span class="written">${esc(chordSymbol(a.writtenRoot, a.quality, style))}</span> <small>écrit pour ton instrument</small>` : ""}
      </h2>
      <p class="muted">${esc(a.label)} · notes de l'accord : <strong>${a.tones.map((n) => esc(noteName(n, style))).join(" – ")}</strong></p>
    </div>
    <div class="tabs" role="tablist" aria-label="Gammes possibles">${tabs}</div>
    <div class="scale-help">
      <p><strong>${esc(scale.name)}</strong> — ${esc(scale.plain)}</p>
      <p class="recipe">Recette : <span>${scale.degrees.map((d) => esc(d.replaceAll("b", "♭").replaceAll("#", "♯"))).join(" ")}</span> <small>(numéros des notes de la gamme majeure ; ♭ = un demi-ton plus bas, ♯ = un demi-ton plus haut)</small></p>
    </div>
    <div class="staff-wrap">${staffSvg(flagged(scale.notes), inst.clef, style)}</div>
    <p class="legend"><span class="dot tone"></span> note de l'accord (à viser sur les temps forts) <span class="dot"></span> note de passage</p>
    <div class="actions">
      <button type="button" id="play-scale">▶ Écouter la gamme</button>
      <button type="button" id="new-phrase">🎲 Idée de phrase</button>
    </div>
    ${
      phrase
        ? `<div class="phrase"><h3>Phrase proposée</h3>
           <div class="staff-wrap">${staffSvg(flagged(phrase.notes), inst.clef, style)}</div>
           <div class="actions"><button type="button" id="play-phrase">▶ Écouter la phrase</button></div>
           <p class="hint">Huit croches : les notes d'accord tombent sur les temps. Joue-la, puis change-la.</p></div>`
        : ""
    }`;
}

/* ----------------------------------------------------------------- audio */

const bassMidi = (pc) => 36 + (((pc - 36) % 12) + 12) % 12;
const padBase = (pc) => 55 + (((pc - 55) % 12) + 12) % 12;

function voicing(a) {
  const base = padBase(a.parsed.pc);
  return a.toneDegrees.map((t) => base + degreeSemis(t));
}

function chordEvents(item, start, next) {
  const a = item.a;
  const ev = [];
  const root = bassMidi(a.parsed.pc);
  const tones = a.toneDegrees.map((t) => root + degreeSemis(t));
  for (const m of voicing(a)) ev.push({ t: start, dur: item.beats, midi: m, kind: "pad" });
  for (let k = 0; k < item.beats; k++) {
    let m;
    if (k === 0) m = root;
    else if (k === item.beats - 1 && next && next.a && bassMidi(next.a.parsed.pc) !== root) m = bassMidi(next.a.parsed.pc) - 1;
    else m = tones[(k + (item.beats === 2 ? 2 : 0)) % tones.length] ?? root;
    ev.push({ t: start + k, dur: 0.9, midi: m, kind: "bass" });
  }
  return ev;
}

function gridEvents() {
  const resolved = resolveGrid().flat();
  const events = [];
  const beatMap = [];
  let beat = 0;
  resolved.forEach((item, i) => {
    if (item.a) events.push(...chordEvents(item, beat, resolved[(i + 1) % resolved.length]));
    beatMap.push({ start: beat, end: beat + item.beats });
    beat += item.beats;
  });
  if (state.click) for (let b = 0; b < beat; b++) events.push({ t: b, dur: 0, kind: "click", accent: b % 4 === 0 });
  return { events, total: beat };
}

function setPlayButton(on) {
  $("#play").textContent = on ? "■ Arrêter" : "▶ Jouer la grille";
  $("#play").setAttribute("aria-pressed", String(on));
}

function clearPlaying() {
  document.querySelectorAll(".bar.playing").forEach((el) => el.classList.remove("playing"));
}

function playGrid() {
  if (engine.playing) {
    engine.stop();
    return;
  }
  const { events, total } = gridEvents();
  if (!total) return;
  // temps -> mesure (chaque mesure fait 4 temps, quelle que soit sa découpe)
  setPlayButton(true);
  engine.play({
    events,
    totalBeats: total,
    tempo: state.tempo,
    loop: state.loop,
    onBeat: (beat) => {
      clearPlaying();
      const el = $("#grid").children[Math.floor(beat / 4)];
      if (el) el.classList.add("playing");
    },
    onEnd: () => {
      setPlayButton(false);
      clearPlaying();
    },
  });
}

function playSnippet(kind) {
  const item = selectedItem(resolveGrid());
  if (!item) return;
  const a = item.a;
  const inst = instrument();
  const root = bassMidi(a.parsed.pc);
  const events = [];
  let lead;
  let total;
  if (kind === "scale") {
    const notes = a.scales[Math.min(scalePick, a.scales.length - 1)].notes;
    const up = notes.map((n) => soundingMidi(n, inst));
    lead = [...up, ...up.slice(0, -1).reverse()];
    total = Math.ceil(lead.length / 2);
  } else {
    lead = phrase.notes.map((n) => soundingMidi(n, inst));
    total = 4;
  }
  for (const m of voicing(a)) events.push({ t: 0, dur: total, midi: m, kind: "pad" });
  for (let t = 0; t < total; t += 2) events.push({ t, dur: 1.8, midi: root, kind: "bass" });
  lead.forEach((m, i) => events.push({ t: i / 2, dur: 0.45, midi: m, kind: "lead" }));
  engine.play({ events, totalBeats: total + 1, tempo: state.tempo });
}

/* ------------------------------------------------------------ évènements */

function setBars(bars) {
  state.bars = bars;
  sel = { bar: 0, idx: 0 };
  scalePick = 0;
  phrase = null;
  engine.stop();
  renderGrid();
  save();
}

function init() {
  renderControls();
  renderGrid();

  $("#inst").addEventListener("change", (e) => {
    state.inst = e.target.value;
    phrase = null;
    scalePick = 0;
    updateDerived();
    save();
  });
  $("#names").addEventListener("change", (e) => {
    state.names = e.target.value;
    updateDerived();
    save();
  });
  $("#key").addEventListener("change", (e) => {
    state.key = e.target.value;
    save();
  });
  $("#preset").addEventListener("change", (e) => {
    state.preset = e.target.value;
    $("#preset-info").textContent = PRESETS.find((p) => p.id === state.preset).info;
    save();
  });
  $("#apply-preset").addEventListener("click", () => {
    const preset = PRESETS.find((p) => p.id === state.preset);
    setBars(presetToBars(preset, rootPc(state.key)));
  });
  $("#tempo").addEventListener("input", (e) => {
    state.tempo = Number(e.target.value);
    $("#tempo-out").textContent = state.tempo;
    save();
  });
  $("#loop").addEventListener("change", (e) => {
    state.loop = e.target.checked;
    save();
  });
  $("#click").addEventListener("change", (e) => {
    state.click = e.target.checked;
    save();
  });
  $("#play").addEventListener("click", playGrid);

  $("#add-bars").addEventListener("click", () => {
    if (state.bars.length >= 64) return;
    state.bars = [...state.bars, "", "", "", ""].slice(0, 64);
    renderGrid();
    save();
  });
  $("#remove-bars").addEventListener("click", () => {
    if (state.bars.length <= 4) return;
    state.bars = state.bars.slice(0, -4);
    if (sel.bar >= state.bars.length) sel = { bar: 0, idx: 0 };
    renderGrid();
    save();
  });
  $("#clear").addEventListener("click", () => setBars(state.bars.map(() => "")));

  $("#share").addEventListener("click", async () => {
    history.replaceState(null, "", "#g=" + encodeHash(state));
    const btn = $("#share");
    try {
      await navigator.clipboard.writeText(location.href);
      btn.textContent = "Lien copié ✓";
    } catch {
      window.prompt("Copie ce lien :", location.href);
    }
    setTimeout(() => (btn.textContent = "🔗 Copier le lien"), 2000);
  });
  $("#print").addEventListener("click", () => window.print());

  $("#grid").addEventListener("click", (e) => {
    const chip = e.target.closest("button.chip");
    if (!chip) return;
    sel = { bar: Number(chip.dataset.bar), idx: Number(chip.dataset.idx) };
    scalePick = 0;
    phrase = null;
    updateDerived();
  });

  $("#detail").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-scale]");
    if (tab) {
      scalePick = Number(tab.dataset.scale);
      phrase = null;
      renderDetail();
      return;
    }
    const id = e.target.closest("button")?.id;
    if (id === "play-scale") playSnippet("scale");
    if (id === "play-phrase") playSnippet("phrase");
    if (id === "new-phrase") {
      const item = selectedItem(resolveGrid());
      if (!item) return;
      const a = item.a;
      const scale = a.scales[Math.min(scalePick, a.scales.length - 1)];
      phrase = { notes: generatePhrase(a.writtenRoot, scale.id, a.toneDegrees) };
      renderDetail();
    }
  });
}

init();
