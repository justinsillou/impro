import {
  INSTRUMENTS, ROOT_CHOICES, analyseChord, chordSymbol, degreeSemis, generatePhrase,
  inRange, instrumentById, midiOf, noteName, parseChord, phraseNotes, soundingMidi,
} from "./theory.js";
import { PRESETS, presetToBars } from "./presets.js";
import { phraseSvg, staffSvg } from "./staff.js";
import { Engine } from "./audio.js";
import { MidiIn } from "./midi.js";
import { download, midiFile, musicXml } from "./export.js";
import { initTestUi } from "./test-ui.js";
import { importFile, parseChordText } from "./import.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const STORAGE_KEY = "impro-grille-v1";
const SONGS_KEY = "impro-morceaux-v1";
const REPEAT = new Set(["%", "/", "-", "."]);
const engine = new Engine();
const midiIn = new MidiIn();

/* ------------------------------------------------------------------ état */

const rootPc = (name) => parseChord(name).pc;

/* Morceaux de l'utilisateur (importés ou enregistrés), gardés dans le navigateur. */
function loadSongs() {
  try {
    const raw = JSON.parse(localStorage.getItem(SONGS_KEY) ?? "[]");
    return (Array.isArray(raw) ? raw : [])
      .filter((x) => x && typeof x.id === "string" && typeof x.name === "string" && Array.isArray(x.bars))
      .map((x) => ({ id: x.id, name: x.name.slice(0, 80), bars: x.bars.slice(0, 64).map((b) => String(b).slice(0, 40)) }))
      .filter((x) => x.bars.length);
  } catch {
    return [];
  }
}
let songs = loadSongs();
const saveSongs = () => {
  try {
    localStorage.setItem(SONGS_KEY, JSON.stringify(songs));
  } catch {
    /* stockage plein ou bloqué */
  }
};
const findPreset = (id) => PRESETS.find((p) => p.id === id) ?? songs.find((x) => x.id === id);
const isSong = (id) => songs.some((x) => x.id === id);

const DEFAULT = {
  bars: presetToBars(PRESETS[0], 0),
  inst: "bb-bass",
  names: "fr",
  acc: "auto",
  tempo: 100,
  key: "C",
  preset: PRESETS[0].id,
  loop: true,
  click: true,
  swing: true,
  drums: true,
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
  if (["auto", "sharp", "flat"].includes(raw.acc)) s.acc = raw.acc;
  if (Number.isFinite(raw.tempo)) s.tempo = Math.min(220, Math.max(40, Math.round(raw.tempo)));
  if (ROOT_CHOICES.includes(raw.key)) s.key = raw.key;
  if (findPreset(raw.preset)) s.preset = raw.preset;
  for (const k of ["loop", "click", "swing", "drums"]) if (typeof raw[k] === "boolean") s[k] = raw[k];
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
let phrase = null; // { events, scaleId }
let saveTimer = null;
let currentItem = null; // accord en cours pendant la lecture

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

/** Orthographe imposée : "sharp", "flat", ou rien (on suit ce que l'utilisateur a tapé). */
const accPref = () => (state.acc === "sharp" || state.acc === "flat" ? state.acc : undefined);
/** Pour une grille type : « auto » suit la tonalité (Sol♭ → bémols, Fa♯ → dièses). */
const keyPref = () => accPref() ?? (state.key.includes("#") ? "sharp" : state.key.includes("b") ? "flat" : undefined);

/** Découpe une mesure en accords et leur durée en temps (4/4). */
function resolveGrid() {
  const inst = instrument();
  let prev = null;
  return state.bars.map((text) => {
    const tokens = text.trim().split(/\s+/).filter(Boolean).slice(0, 4);
    const implicit = tokens.length === 0;
    if (implicit) tokens.push("%");
    const beats = { 1: [4], 2: [2, 2], 3: [2, 1, 1], 4: [1, 1, 1, 1] }[tokens.length];
    return tokens.map((tok, i) => {
      let a;
      if (REPEAT.has(tok)) a = prev;
      else a = analyseChord(tok, inst, accPref());
      if (a) prev = a;
      return { text: tok, beats: beats[i], a, implicit, invalid: !REPEAT.has(tok) && !a };
    });
  });
}

const selectedItem = (resolved = resolveGrid()) => {
  const it = (resolved[sel.bar] ?? [])[sel.idx];
  return it && it.a ? it : null;
};

/* ---------------------------------------------------------------- rendu */

function renderControls() {
  $("#inst").innerHTML = INSTRUMENTS.map((i) => `<option value="${i.id}">${esc(i.label)}</option>`).join("");
  $("#inst").value = state.inst;
  $("#key").innerHTML = ROOT_CHOICES.map((r) => `<option value="${r}">${r.replace("#", "♯").replace("b", "♭")}</option>`).join("");
  $("#key").value = state.key;
  renderPresets();
  $("#names").value = state.names;
  $("#acc").value = state.acc;
  $("#tempo").value = state.tempo;
  $("#tempo-out").textContent = state.tempo;
  for (const k of ["loop", "click", "swing", "drums"]) $("#" + k).checked = state[k];
  renderPresetInfo();
}

function renderPresets() {
  const opt = (p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`;
  $("#preset").innerHTML =
    `<optgroup label="Grilles types">${PRESETS.map(opt).join("")}</optgroup>` +
    (songs.length ? `<optgroup label="Mes morceaux">${songs.map(opt).join("")}</optgroup>` : "");
  $("#preset").value = state.preset;
}

function renderPresetInfo() {
  const p = findPreset(state.preset);
  $("#preset-info").textContent = isSong(state.preset)
    ? `Ton morceau « ${p.name} » : ${p.bars.length} mesures, accords en sons réels (la tonalité ne les change pas).`
    : p.info;
  $("#delete-song").hidden = !isSong(state.preset);
  $("#key").disabled = isSong(state.preset);
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
      select(i, 0);
      save();
    });
    input.addEventListener("focus", () => {
      if (sel.bar !== i) select(i, 0);
    });
    grid.append(cell);
  });
  $("#bar-count").textContent = state.bars.length;
  updateDerived();
}

function select(bar, idx) {
  sel = { bar, idx };
  scalePick = 0;
  phrase = null;
  updateDerived();
}

function chipLabel(item) {
  const first = item.a.scales[0].name.split(" (")[0];
  const arrow = item.implicit || REPEAT.has(item.text) ? "↺ " : "";
  return `${arrow}${esc(chordSymbol(item.a.writtenRoot, item.a.quality, state.names))}<small>${esc(first)}</small>`;
}

function updateDerived() {
  const resolved = resolveGrid();
  const cells = $("#grid").children;
  resolved.forEach((items, i) => {
    const d = cells[i].querySelector(".bar-derived");
    d.innerHTML = items
      .map((item, k) => {
        if (item.invalid) return `<span class="chip invalid" title="Accord non reconnu">${esc(item.text)} ?</span>`;
        if (!item.a) return `<span class="chip muted">—</span>`;
        const on = sel.bar === i && sel.idx === k ? " selected" : "";
        return `<button type="button" class="chip${on}" data-bar="${i}" data-idx="${k}">${chipLabel(item)}</button>`;
      })
      .join("");
    cells[i].classList.toggle("selected", sel.bar === i);
  });
  renderDetail(resolved);
  document.dispatchEvent(new CustomEvent("impro:chord-changed"));
}

/** Note de gamme/phrase avec drapeaux d'affichage : note d'accord, hors tessiture. */
function decorate(note, tonePcs) {
  const inst = instrument();
  return { ...note, tone: tonePcs.has(midiOf(note) % 12), out: !inRange(note, inst) };
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
  const scaleDeco = scale.notes.map((n) => decorate(n, tonePcs));
  const transposed = inst.semis !== 0;
  const anyOut = scaleDeco.some((n) => n.out) || (phrase && phrase.events.some((e) => e.note && !inRange(e.note, inst)));

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
    <div class="staff-wrap">${staffSvg(scaleDeco, inst.clef, style)}</div>
    <p class="legend"><span class="dot tone"></span> note de l'accord (à viser sur les temps forts) <span class="dot"></span> note de passage${anyOut ? ` · <span class="dot out"></span> hors tessiture` : ""}</p>
    <div class="actions">
      <button type="button" id="play-scale">▶ Écouter la gamme</button>
      <button type="button" id="new-phrase">🎲 Idée de phrase</button>
    </div>
    ${
      phrase
        ? `<div class="phrase"><h3>Phrase proposée <small>(une mesure, 4 temps)</small></h3>
           <div class="staff-wrap">${phraseSvg(
             phrase.events.map((e) => (e.note ? { ...e, ...decorate(e.note, tonePcs), note: e.note } : e)),
             inst.clef,
             style,
           )}</div>
           <div class="actions">
             <button type="button" id="play-phrase">▶ Écouter la phrase</button>
             <button type="button" class="secondary" id="phrase-midi">⬇ MIDI</button>
             <button type="button" class="secondary" id="phrase-xml">⬇ MusicXML</button>
           </div>
           <p class="hint">Notes d'accord sur les temps, notes de gamme entre les deux, parfois un silence. Joue-la, puis change-la.</p></div>`
        : ""
    }`;
}

/* ----------------------------------------------------------------- audio */

const bassMidi = (pc) => 36 + (((pc - 36) % 12) + 12) % 12;
const padBase = (pc) => 55 + (((pc - 55) % 12) + 12) % 12;
const SWING = 1 / 6; // décalage des croches à contretemps (rapport 2:1)

function voicing(a) {
  const base = padBase(a.parsed.pc);
  return a.toneDegrees.map((t) => base + degreeSemis(t));
}

function chordEvents(item, start, next, index) {
  const a = item.a;
  const ev = [];
  const root = bassMidi(a.parsed.pc);
  const tones = a.toneDegrees.map((t) => root + degreeSemis(t));
  for (const m of voicing(a)) ev.push({ t: start, dur: item.beats, midi: m, kind: "pad" });
  for (let k = 0; k < item.beats; k++) {
    let m;
    if (k === 0) m = root;
    else if (k === item.beats - 1 && next && next.a && bassMidi(next.a.parsed.pc) !== root) m = bassMidi(next.a.parsed.pc) - 1;
    else if (item.beats === 4) m = tones[k === 1 ? 1 + (index % 2) : 2 - (index % 2)] ?? root;
    else m = tones[(k + (item.beats === 2 ? 2 : 0)) % tones.length] ?? root;
    ev.push({ t: start + k, dur: 0.9, midi: m, kind: "bass" });
  }
  return ev;
}

/** Ride, charleston au pied sur 2 et 4, grosse caisse discrète. */
function drumEvents(totalBeats) {
  const ev = [];
  const skip = state.swing ? 2 / 3 : 0.5;
  for (let b = 0; b < totalBeats; b++) {
    const beatInBar = b % 4;
    ev.push({ t: b, dur: 0, kind: "ride", accent: beatInBar === 1 || beatInBar === 3 });
    if (beatInBar === 1 || beatInBar === 3) {
      ev.push({ t: b + skip, dur: 0, kind: "ride" });
      ev.push({ t: b, dur: 0, kind: "hat" });
    }
    if (beatInBar === 0) ev.push({ t: b, dur: 0, kind: "kick" });
  }
  return ev;
}

function gridEvents() {
  const flat = resolveGrid().flat();
  const events = [];
  const beatItems = [];
  let beat = 0;
  flat.forEach((item, i) => {
    if (item.a) events.push(...chordEvents(item, beat, flat[(i + 1) % flat.length], i));
    for (let k = 0; k < item.beats; k++) beatItems.push(item.a ? item : null);
    beat += item.beats;
  });
  if (state.click) for (let b = 0; b < beat; b++) events.push({ t: b, dur: 0, kind: "click", accent: b % 4 === 0 });
  if (state.drums) events.push(...drumEvents(beat));
  return { events, total: beat, beatItems };
}

/** Pour chaque temps de la grille : notes de l'accord et de ses gammes (sons réels). */
function beatInfo() {
  return gridEvents().beatItems.map((item) => {
    if (!item) return null;
    const a = item.a;
    const pcs = (degrees) => new Set(degrees.map((d) => (a.parsed.pc + degreeSemis(d)) % 12));
    const scale = new Set();
    for (const s of a.scales) for (const pc of pcs(s.degrees)) scale.add(pc);
    return { tones: pcs(a.toneDegrees), scale };
  });
}

function setPlayButton(on) {
  $("#play").textContent = on ? "■ Arrêter" : "▶ Jouer la grille";
  $("#play").setAttribute("aria-pressed", String(on));
}

function clearPlaying() {
  document.querySelectorAll(".bar.playing").forEach((el) => el.classList.remove("playing"));
  currentItem = null;
}

/** Joue la grille. `opts.loop`, `opts.countIn`, `opts.onEnd` pour le mode test. */
function playGrid(opts = {}) {
  if (engine.playing) {
    engine.stop();
    return;
  }
  const { events, total, beatItems } = gridEvents();
  if (!total) return;
  setPlayButton(true);
  engine.play({
    events,
    totalBeats: total,
    tempo: state.tempo,
    loop: opts.loop ?? state.loop,
    countIn: opts.countIn ?? 0,
    onBeat: (beat) => {
      clearPlaying();
      currentItem = beatItems[beat] ?? null;
      const el = $("#grid").children[Math.floor(beat / 4)];
      if (el) el.classList.add("playing");
      document.dispatchEvent(new CustomEvent("impro:chord-changed"));
    },
    onEnd: (ended) => {
      setPlayButton(false);
      clearPlaying();
      opts.onEnd?.(ended);
      document.dispatchEvent(new CustomEvent("impro:chord-changed"));
    },
  });
}

/** Position (t) d'un événement de phrase, avec le swing sur les croches à contretemps. */
const phraseT = (start) => start / 2 + (state.swing && start % 2 === 1 ? SWING : 0);

function snippetEvents(kind) {
  const item = selectedItem();
  const a = item.a;
  const inst = instrument();
  const root = bassMidi(a.parsed.pc);
  const events = [];
  let total;
  if (kind === "scale") {
    const notes = a.scales[Math.min(scalePick, a.scales.length - 1)].notes;
    const up = notes.map((n) => soundingMidi(n, inst));
    const lead = [...up, ...up.slice(0, -1).reverse()];
    total = Math.ceil(lead.length / 2);
    lead.forEach((m, i) => events.push({ t: phraseT(i), dur: 0.45, midi: m, kind: "lead" }));
  } else {
    total = 4;
    for (const e of phrase.events) {
      if (e.note) events.push({ t: phraseT(e.start), dur: Math.max(0.2, e.len / 2 - 0.05), midi: soundingMidi(e.note, inst), kind: "lead" });
    }
  }
  for (const m of voicing(a)) events.push({ t: 0, dur: total, midi: m, kind: "pad" });
  for (let t = 0; t < total; t += 2) events.push({ t, dur: 1.8, midi: root, kind: "bass" });
  if (state.drums) events.push(...drumEvents(total));
  return { events, total };
}

function playSnippet(kind) {
  if (!selectedItem()) return;
  const { events, total } = snippetEvents(kind);
  engine.play({ events, totalBeats: total + 1, tempo: state.tempo });
}

/* --------------------------------------------------------------- exports */

const fileSlug = () => `grille-impro-${state.key.replace("#", "s")}`;

function exportGridMidi() {
  const { events } = gridEvents();
  const pick = (kind, vel) => events.filter((e) => e.kind === kind).map((e) => ({ t: e.t, dur: e.dur, midi: e.midi, vel }));
  const bytes = midiFile({
    tempo: state.tempo,
    tracks: [
      { name: "Accords", channel: 0, program: 4, notes: pick("pad", 60) },
      { name: "Basse", channel: 1, program: 32, notes: pick("bass", 85) },
    ],
  });
  download(`${fileSlug()}.mid`, bytes, "audio/midi");
}

function exportGridXml() {
  const inst = instrument();
  const measures = resolveGrid().map((items) => ({
    entries: items.map((it) => ({
      dur: it.beats * 2,
      harmony: it.a && !it.implicit && !REPEAT.has(it.text) ? { root: it.a.concertRoot, quality: it.a.quality } : undefined,
    })),
  }));
  download(`${fileSlug()}.musicxml`, musicXml({ title: "Grille d'impro", inst, measures }), "application/vnd.recordare.musicxml+xml");
}

function exportPhraseMidi() {
  const { events } = snippetEvents("phrase");
  const pick = (kind, vel) => events.filter((e) => e.kind === kind).map((e) => ({ t: e.t, dur: e.dur, midi: e.midi, vel }));
  const bytes = midiFile({
    tempo: state.tempo,
    tracks: [
      { name: "Phrase", channel: 2, program: 65, notes: pick("lead", 95) },
      { name: "Accord", channel: 0, program: 4, notes: pick("pad", 55) },
      { name: "Basse", channel: 1, program: 32, notes: pick("bass", 85) },
    ],
  });
  download("phrase-impro.mid", bytes, "audio/midi");
}

function exportPhraseXml() {
  const item = selectedItem();
  const inst = instrument();
  const entries = phrase.events.map((e, i) => ({
    note: e.note ?? undefined,
    dur: e.len,
    harmony: i === 0 ? { root: item.a.concertRoot, quality: item.a.quality } : undefined,
  }));
  download("phrase-impro.musicxml", musicXml({ title: "Phrase d'impro", inst, measures: [{ entries }] }), "application/vnd.recordare.musicxml+xml");
}

/* -------------------------------------------------- morceaux de l'utilisateur */

function songStatus(msg, error = false) {
  const el = $("#song-status");
  el.textContent = msg;
  el.classList.toggle("error", error);
}

/** Enregistre une grille dans « Mes morceaux » et la sélectionne. */
function addSong(name, bars) {
  const id = "song-" + Date.now().toString(36);
  songs.push({ id, name: name.trim().slice(0, 80) || "Sans titre", bars: bars.slice(0, 64) });
  saveSongs();
  state.preset = id;
  renderPresets();
  renderPresetInfo();
  save();
}

function initSongs() {
  $("#import-btn").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const { bars, skipped, title } = await importFile(file);
      setBars(bars);
      addSong(title, bars);
      songStatus(
        `« ${title} » importé : ${bars.length} mesures` + (skipped ? ` (${skipped} accord(s) non reconnu(s) ignoré(s))` : "") +
          ". Les accords sont lus en sons réels ; corrige à la main si besoin.",
      );
    } catch (err) {
      songStatus(err.message || "Import impossible.", true);
    }
  });
  $("#save-song").addEventListener("click", () => {
    const bars = state.bars.map((b) => b.trim());
    if (!bars.some(Boolean)) return songStatus("La grille est vide.", true);
    const name = window.prompt("Nom du morceau :", "Mon morceau");
    if (name === null) return;
    addSong(name, bars);
    songStatus(`« ${name.trim() || "Sans titre"} » enregistré dans « Mes morceaux » (dans ce navigateur).`);
  });
  $("#paste-song").addEventListener("click", () => {
    const text = window.prompt("Colle tes accords (mesures séparées par | ou par des retours à la ligne) :", "Dm7 G7 | Cmaj7 | Am7 D7 | Gmaj7");
    if (!text) return;
    const { bars, skipped } = parseChordText(text);
    if (!bars.length) return songStatus("Aucun accord reconnu.", true);
    setBars(bars);
    songStatus(`${bars.length} mesures chargées` + (skipped ? ` (${skipped} élément(s) ignoré(s))` : "") + ". Clique « Enregistrer » pour les garder.");
  });
  $("#delete-song").addEventListener("click", () => {
    const p = findPreset(state.preset);
    if (!isSong(p.id) || !window.confirm(`Supprimer « ${p.name} » de tes morceaux ?`)) return;
    songs = songs.filter((x) => x.id !== p.id);
    saveSongs();
    state.preset = PRESETS[0].id;
    renderPresets();
    renderPresetInfo();
    save();
    songStatus("Morceau supprimé.");
  });
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

  const bind = (id, fn, evt = "change") => $(id).addEventListener(evt, fn);
  bind("#inst", (e) => {
    state.inst = e.target.value;
    phrase = null;
    scalePick = 0;
    updateDerived();
    save();
  });
  bind("#names", (e) => {
    state.names = e.target.value;
    updateDerived();
    save();
  });
  bind("#key", (e) => {
    state.key = e.target.value;
    save();
  });
  bind("#preset", (e) => {
    state.preset = e.target.value;
    renderPresetInfo();
    save();
  });
  bind("#acc", (e) => {
    state.acc = e.target.value;
    phrase = null;
    updateDerived();
    save();
  });
  bind("#apply-preset", () => {
    const p = findPreset(state.preset);
    setBars(isSong(p.id) ? [...p.bars] : presetToBars(p, rootPc(state.key), keyPref()));
  }, "click");
  initSongs();
  bind(
    "#tempo",
    (e) => {
      state.tempo = Number(e.target.value);
      $("#tempo-out").textContent = state.tempo;
      save();
    },
    "input",
  );
  for (const k of ["loop", "click", "swing", "drums"]) {
    bind("#" + k, (e) => {
      state[k] = e.target.checked;
      save();
    });
  }
  bind("#play", () => playGrid(), "click");

  bind("#add-bars", () => {
    if (state.bars.length >= 64) return;
    state.bars = [...state.bars, "", "", "", ""].slice(0, 64);
    renderGrid();
    save();
  }, "click");
  bind("#remove-bars", () => {
    if (state.bars.length <= 4) return;
    state.bars = state.bars.slice(0, -4);
    if (sel.bar >= state.bars.length) sel = { bar: 0, idx: 0 };
    renderGrid();
    save();
  }, "click");
  bind("#clear", () => setBars(state.bars.map(() => "")), "click");

  bind("#share", async () => {
    history.replaceState(null, "", "#g=" + encodeHash(state));
    const btn = $("#share");
    try {
      await navigator.clipboard.writeText(location.href);
      btn.textContent = "Lien copié ✓";
    } catch {
      window.prompt("Copie ce lien :", location.href);
    }
    setTimeout(() => (btn.textContent = "🔗 Copier le lien"), 2000);
  }, "click");
  bind("#print", () => window.print(), "click");
  bind("#dl-midi", exportGridMidi, "click");
  bind("#dl-xml", exportGridXml, "click");

  $("#grid").addEventListener("click", (e) => {
    const chip = e.target.closest("button.chip");
    if (chip) select(Number(chip.dataset.bar), Number(chip.dataset.idx));
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
    if (id === "phrase-midi") exportPhraseMidi();
    if (id === "phrase-xml") exportPhraseXml();
    if (id === "new-phrase") {
      const item = selectedItem();
      if (!item) return;
      const a = item.a;
      const scale = a.scales[Math.min(scalePick, a.scales.length - 1)];
      phrase = { events: generatePhrase(a.writtenRoot, scale.id, a.toneDegrees, Math.random, instrument().range) };
      renderDetail();
    }
  });

  initTestUi({
    engine,
    midi: midiIn,
    state: () => state,
    instrument,
    names: () => state.names,
    chordForLive: () => (currentItem ?? selectedItem())?.a ?? null,
    beatInfo,
    playGrid,
    playing: () => engine.playing,
    phraseNotes,
  });
}

init();
