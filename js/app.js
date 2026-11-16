import {
  INSTRUMENTS, ROOT_CHOICES, analyseChord, chordSymbol, degreeSemis, generatePhrase,
  inRange, instrumentById, makeNote, midiOf, noteName, parseChord, phraseNotes, soundingMidi, spellRoot,
} from "./theory.js";
import { PRESETS, presetToBars } from "./presets.js";
import { phraseSvg, scoreSvg, scoreX, staffSvg } from "./staff.js";
import { Engine } from "./audio.js";
import { MidiIn } from "./midi.js";
import { download, midiFile, musicXml } from "./export.js";
import { initTestUi } from "./test-ui.js";
import { importFile, parseChordText } from "./import.js";
import { analyseParts, chordCandidates, guessBars, notesIn, rhythmFromNotes, scaleCoverage, styleFromAnalysis } from "./analysis.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const STORAGE_KEY = "impro-grille-v1";
const SONGS_KEY = "impro-morceaux-v1";
const REPEAT = new Set(["%", "/", "-", "."]);
const GRID_MAX = 16; // mesures affichées et jouées à la fois (au-delà : « sections »)
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
      .map((x) => ({ id: x.id, name: x.name.slice(0, 80), bars: x.bars.slice(0, 64).map((b) => String(b).slice(0, 40)), parts: cleanParts(x.parts), offset: Number.isInteger(x.offset) && x.offset >= 0 && x.offset < 64 ? x.offset : 0 }))
      .filter((x) => x.bars.length);
  } catch {
    return [];
  }
}
/** Parties d'une partition (stockage) : ne garde que des nombres valides. */
function cleanParts(raw) {
  if (!Array.isArray(raw)) return undefined;
  const parts = raw
    .filter((p) => p && typeof p.name === "string" && Array.isArray(p.notes))
    .slice(0, 24)
    .map((p) => ({
      name: p.name.slice(0, 60),
      notes: p.notes
        .filter((n) => n && [n.m, n.t, n.d].every(Number.isFinite))
        .slice(0, 6000)
        .map((n) => ({ m: n.m, t: Math.round(n.t * 1000) / 1000, d: Math.round(n.d * 1000) / 1000 })),
    }))
    .filter((p) => p.notes.length);
  return parts.length ? parts : undefined;
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
  sec: 0,
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
    s.bars = raw.bars.slice(0, GRID_MAX).map((b) => String(b).slice(0, 40));
  }
  if (Number.isInteger(raw.sec) && raw.sec >= 0 && raw.sec < 4) s.sec = raw.sec;
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
let followBar = null; // mesure de la grille jouée en ce moment (suivi de la partition)
let viewFrom = 0; // première mesure affichée dans la partition
let score = null; // partition importée : { title, parts, analysis, model, adapt, echo }

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
  renderSection();
}

/** Grille complète de la source choisie (grille type ou morceau), avant découpe en sections. */
function sourceBars() {
  const p = findPreset(state.preset);
  return isSong(p.id) ? p.bars : presetToBars(p, rootPc(state.key), keyPref());
}

function renderSection() {
  const n = sourceBars().length;
  const count = Math.ceil(n / GRID_MAX);
  $("#section-field").hidden = count <= 1;
  $("#section").innerHTML = Array.from(
    { length: count },
    (_, k) => `<option value="${k}">Mesures ${k * GRID_MAX + 1} – ${Math.min(n, (k + 1) * GRID_MAX)}</option>`,
  ).join("");
  $("#section").value = String(Math.min(state.sec, count - 1));
}

/** Charge dans la grille une section de 16 mesures de la source choisie. */
function loadSection(sec) {
  const p = findPreset(state.preset);
  const song = isSong(p.id);
  state.sec = sec;
  const bars = sourceBars().slice(sec * GRID_MAX, (sec + 1) * GRID_MAX);
  setBars(bars.length ? bars : ["", "", "", ""]);
  setScore(p.name, song ? p.parts : null, song ? (p.offset ?? 0) + sec * GRID_MAX : 0);
  renderSection();
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
  const it = score ? selectedItem() : null;
  scalePick = it ? bestScale(it) : 0;
  phrase = null;
  updateDerived();
}

/* ------------------------------------------------------- partition importée */

/** Mesure de la partition qui correspond à la mesure `n` de la grille (la grille est une section du morceau). */
const absBar = (n) => (score?.offset ?? 0) + n;

/** Fenêtre (en temps depuis le début) occupée par un accord de la grille. */
function chordWindow(bar, idx, resolved = resolveGrid()) {
  const items = resolved[bar] ?? [];
  const from = absBar(bar) * 4 + items.slice(0, idx).reduce((s, it) => s + it.beats, 0);
  return [from, from + (items[idx]?.beats ?? 4)];
}

const modelPart = () => (score ? score.parts.find((p) => p.name === score.analysis[score.model]?.name) : null);

/** Notes jouées par la partition sur un accord (partie modèle, sinon toutes). */
function scoreNotes(bar, idx) {
  if (!score) return [];
  const [a, b] = chordWindow(bar, idx);
  const own = modelPart() ? notesIn(modelPart(), a, b) : [];
  return own.length ? own : score.parts.flatMap((p) => notesIn(p, a, b));
}

/** Gamme de l'accord qui couvre le mieux la mélodie de la partition. */
function bestScale(item) {
  const notes = scoreNotes(sel.bar, sel.idx);
  if (!notes.length) return 0;
  let best = 0;
  let bestCov = -1;
  item.a.scales.forEach((sc, i) => {
    const c = scaleCoverage(item.a.parsed.pc, sc.degrees, notes) ?? 0;
    if (c > bestCov + 1e-9) {
      best = i;
      bestCov = c;
    }
  });
  return best;
}

function setScore(title, parts, offset = 0) {
  score = null;
  followBar = null;
  if (parts && parts.length) {
    const bars = Math.max(1, ...parts.map((p) => Math.floor(Math.max(...p.notes.map((n) => n.t)) / 4) + 1));
    const analysis = analyseParts(parts, bars);
    if (analysis.length) {
      const model = Math.max(0, analysis.findIndex((a) => a.role === "Mélodie"));
      score = { title, parts, analysis, model, view: model, bars: Math.min(64, bars), offset, adapt: true, echo: false };
    }
  }
  renderScore();
}

const spark = (a) => {
  const max = Math.max(1, ...a.perBar);
  const w = 3;
  const bars = a.perBar.map((n, i) => `<rect x="${i * (w + 1)}" y="${24 - (n / max) * 24}" width="${w}" height="${(n / max) * 24}"/>`).join("");
  return `<svg class="spark" viewBox="0 0 ${a.perBar.length * (w + 1)} 24" preserveAspectRatio="none" role="img" aria-label="Notes par mesure">${bars}</svg>`;
};

function renderScore() {
  const box = $("#score-panel");
  box.hidden = !score;
  if (!score) {
    box.innerHTML = "";
    return;
  }
  const rows = score.analysis
    .map(
      (a, i) => `<tr>
        <td><label><input type="radio" name="model" value="${i}" ${i === score.model ? "checked" : ""}> <strong>${esc(a.name)}</strong></label><br><small>${esc(a.role)}</small></td>
        <td>${spark(a)}<small>${a.count} notes · ${a.density.toFixed(1)} par mesure jouée</small></td>
        <td>${esc(a.text)}</td></tr>`,
    )
    .join("");
  box.innerHTML = `
    <h3>Partition « ${esc(score.title)} » <small>(à suivre en bas, au-dessus de l'accord en détail)</small></h3>
    <h3>Ce que jouent les instruments</h3>
    <p class="hint">Choisis une partie comme <strong>modèle</strong> : les phrases proposées en reprendront le style (tessiture, mouvement, rythme) et la gamme conseillée sera celle qui colle le mieux à ses notes. Les hauteurs sont en sons réels.</p>
    <div class="table-wrap"><table class="score-table"><thead><tr><th>Partie</th><th>Activité par mesure</th><th>Tendance</th></tr></thead><tbody>${rows}</tbody></table></div>
    <label class="inline"><input type="checkbox" id="score-adapt" ${score.adapt ? "checked" : ""}> Adapter mes phrases au style du modèle</label>
    <label class="inline"><input type="checkbox" id="score-echo" ${score.echo ? "checked" : ""}> Reprendre le rythme du modèle sur la mesure</label>
    <button type="button" id="score-forget" class="secondary">Oublier la partition</button>`;
  renderScoreView();
}

/* ---- partition visuelle ---- */

/** Hauteur réelle (MIDI) → note écrite pour l'instrument de l'utilisateur. */
function writtenNote(m) {
  const w = m + instrument().semis;
  const r = spellRoot(((w % 12) + 12) % 12, "", accPref());
  const nat = [0, 2, 4, 5, 7, 9, 11][r.letter];
  return makeNote(r.letter, r.acc, Math.round((w - r.acc - nat) / 12) - 1);
}

/** Une mesure d'une partie, prête pour `scoreSvg` (notes écrites + symboles d'accords de la grille). */
function scoreBar(part, n, resolved) {
  let at = 0;
  const label = [];
  for (const it of resolved[n] ?? []) {
    if (it.a && !it.implicit && !REPEAT.has(it.text)) label.push({ at, text: chordSymbol(it.a.writtenRoot, it.a.quality, state.names) });
    at += it.beats;
  }
  return {
    n,
    label,
    notes: notesIn(part, absBar(n) * 4, absBar(n) * 4 + 4).map((x) => ({ note: writtenNote(x.m), t: x.t - absBar(n) * 4, d: x.d })),
  };
}

const VIEW_BARS = 8;

function guessLabel(name) {
  const c = parseChord(name);
  return chordSymbol(spellRoot(c.pc, c.quality, accPref()), c.quality, state.names);
}

function renderScoreView() {
  const panel = $("#follow");
  const box = $("#score-view");
  if (!panel || !box) return;
  panel.hidden = !score;
  if (!score) {
    box.innerHTML = "";
    return;
  }
  const part = score.parts.find((p) => p.name === score.analysis[score.view]?.name) ?? score.parts[0];
  const resolved = resolveGrid();
  const total = state.bars.length;
  viewFrom = Math.floor((followBar ?? sel.bar) / VIEW_BARS) * VIEW_BARS;
  const from = viewFrom;
  const to = Math.min(total, from + VIEW_BARS);
  const rows = [];
  for (let n = from; n < to; n += 4) {
    const bars = [];
    for (let k = n; k < Math.min(n + 4, to); k++) bars.push(scoreBar(part, k, resolved));
    rows.push(`<div class="staff-wrap rel">${scoreSvg(bars, instrument().clef, { selected: sel.bar, playing: followBar ?? -1 })}<span class="cursor" hidden></span></div>`);
  }
  const barNotes = score.parts.flatMap((p) => notesIn(p, absBar(sel.bar) * 4, absBar(sel.bar) * 4 + 4));
  const guesses = chordCandidates(barNotes, accPref(), 4);
  const current = state.bars[sel.bar]?.trim();
  const empty = !state.bars.some((b) => b.trim());
  box.innerHTML = `
    <div class="follow-head">
      <button type="button" id="play2" aria-pressed="${engine.playing}">${engine.playing ? "■ Arrêter" : "▶ Jouer la grille"}</button>
      <span class="follow-now" id="follow-now" aria-live="off"></span>
      <label class="field wide"><span>Partie affichée (écrite pour ton instrument)</span>
        <select id="score-view-part">${score.analysis.map((a, i) => `<option value="${i}" ${i === score.view ? "selected" : ""}>${esc(a.name)} — ${esc(a.role)}</option>`).join("")}</select>
      </label>
    </div>
    <div class="controls">
      <button type="button" class="secondary" data-page="-1" ${from === 0 ? "disabled" : ""}>◀ Mesures précédentes</button>
      <button type="button" class="secondary" data-page="1" ${to >= total ? "disabled" : ""}>Mesures suivantes ▶</button>
    </div>
    <p class="hint">« ${esc(score.title)} » · mesures de la grille ${from + 1} à ${to} (mesures ${absBar(from) + 1} à ${absBar(to - 1) + 1} du morceau). Pendant la lecture, le trait orange avance et les mesures se tournent toutes seules. <strong>Clique une mesure</strong> pour la choisir : la grille et le détail de l'accord suivent.</p>
    ${rows.join("")}
    <div class="guess">
      <p><strong>Mesure ${sel.bar + 1}</strong>${current ? ` : grille actuelle <code>${esc(current)}</code>` : " : pas encore d'accord"}.
        ${guesses.length ? "Accords qui collent aux notes (clique pour l'écrire dans la grille) :" : "Aucune note ici."}
        ${guesses.map((g) => `<button type="button" class="chip" data-guess="${esc(g.name)}">${esc(guessLabel(g.name))}</button>`).join(" ")}
      </p>
      <p class="actions">
        <button type="button" id="score-guess">🎼 Deviner la grille depuis les notes</button>
        ${empty ? `<small class="muted">La grille est vide : ce bouton la remplit (accords en sons réels, à corriger à la main).</small>` : ""}
      </p>
    </div>`;
  updateNow();
}

/* ---- suivi de la lecture ---- */

function updateNow() {
  const el = $("#follow-now");
  if (!el) return;
  if (followBar === null || !currentItem?.a) {
    el.textContent = "";
    return;
  }
  const a = currentItem.a;
  el.innerHTML = `Mesure ${followBar + 1} · ${esc(chordSymbol(a.writtenRoot, a.quality, state.names))} <small>(son réel : ${esc(chordSymbol(a.concertRoot, a.quality, state.names))})</small>`;
}

let followRaf = 0;
let followLast = -1;

function hideCursors() {
  document.querySelectorAll("#score-view .cursor").forEach((c) => (c.hidden = true));
}

function followTick() {
  if (!engine.playing) return stopTimer();
  const beat = engine.beatNow();
  if (beat !== null && beat >= 0 && score) {
    const bar = Math.floor(beat / 4);
    if (bar !== followLast) {
      followLast = bar;
      followBar = bar;
      if (Math.floor(bar / VIEW_BARS) * VIEW_BARS !== viewFrom) renderScoreView();
      document.querySelectorAll("#score-view .bar-bg").forEach((r) => r.classList.toggle("playing", Number(r.dataset.n) === bar));
      updateNow();
    }
    const idx = bar - viewFrom;
    const wraps = document.querySelectorAll("#score-view .staff-wrap");
    wraps.forEach((w, r) => {
      const c = w.querySelector(".cursor");
      if (!c) return;
      if (Math.floor(idx / 4) !== r) {
        c.hidden = true;
        return;
      }
      const x = scoreX(idx % 4, beat % 4);
      c.hidden = false;
      c.style.left = `${x}px`;
      if (x < w.scrollLeft + 40 || x > w.scrollLeft + w.clientWidth - 60) w.scrollLeft = Math.max(0, x - 80);
    });
  }
}

const stopTimer = () => {
  clearInterval(followRaf);
  followRaf = 0;
};

function startFollow() {
  followLast = -1;
  stopTimer();
  // minuteur plutôt que requestAnimationFrame : continue si l'onglet est masqué
  if (score) followRaf = setInterval(followTick, 40);
}

function stopFollow() {
  stopTimer();
  followBar = null;
  if (score) renderScoreView();
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
  renderScoreView();
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
    ${coverageHint(a, scale)}
    <div class="staff-wrap">${staffSvg(scaleDeco, inst.clef, style)}</div>
    <p class="legend"><span class="dot tone"></span> note de l'accord (à viser sur les temps forts) <span class="dot"></span> note de passage${anyOut ? ` · <span class="dot out"></span> hors tessiture` : ""}</p>
    ${excerpt(resolved)}
    <div class="actions">
      <button type="button" id="play-scale">▶ Écouter la gamme</button>
      <button type="button" id="new-phrase">🎲 Idée de phrase</button>
    </div>
    ${
      phrase
        ? `<div class="phrase"><h3>Phrase proposée <small>(une mesure, 4 temps${phrase.style ? ` · dans le style de « ${esc(phrase.style)} »` : ""})</small></h3>
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

/** Extrait de la partition (partie modèle) sur la mesure de l'accord choisi. */
function excerpt(resolved) {
  if (!score) return "";
  const part = modelPart() ?? score.parts[0];
  const bar = scoreBar(part, sel.bar, resolved);
  if (!bar.notes.length) return "";
  return `<div class="excerpt"><h3>Extrait de la partition <small>(mesure ${sel.bar + 1}, ${esc(part.name)}, écrit pour ton instrument)</small></h3>
    <div class="staff-wrap">${scoreSvg([bar], instrument().clef, { selected: -1 })}</div></div>`;
}

function coverageHint(a, scale) {
  if (!score) return "";
  const notes = scoreNotes(sel.bar, sel.idx);
  const c = notes.length ? scaleCoverage(a.parsed.pc, scale.degrees, notes) : null;
  if (c === null) return `<p class="hint">Pas de note de la partition sur cet accord.</p>`;
  return `<p class="hint">Sur la partition, ${Math.round(c * 100)} % des notes jouées sur cet accord (${notes.length} notes) appartiennent à cette gamme.</p>`;
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
  for (const b of [$("#play"), $("#play2")]) {
    if (!b) continue;
    b.textContent = on ? "■ Arrêter" : "▶ Jouer la grille";
    b.setAttribute("aria-pressed", String(on));
  }
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
  startFollow();
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
      stopFollow();
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
function addSong(name, bars, parts, offset = 0) {
  const id = "song-" + Date.now().toString(36);
  songs.push({ id, name: name.trim().slice(0, 80) || "Sans titre", bars: bars.slice(0, 64), parts: cleanParts(parts), offset });
  saveSongs();
  state.preset = id;
  state.sec = 0;
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
      const { bars, skipped, title, parts } = await importFile(file);
      addSong(title, bars, parts, 0);
      setBars(bars.slice(0, GRID_MAX));
      setScore(title, parts, 0);
      songStatus(
        `« ${title} » importé : ${bars.length} mesures` + (bars.length > GRID_MAX ? ` (la grille en montre ${GRID_MAX} à la fois : choisis la « Section » pour la suite)` : "") + (skipped ? ` (${skipped} accord(s) non reconnu(s) ignoré(s))` : "") +
          (score ? ` et ${score.analysis.length} partie(s) analysée(s) (voir plus bas)` : "") +
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
    addSong(name, bars, score?.parts, score?.offset ?? 0);
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
  if (isSong(state.preset)) {
    const p = findPreset(state.preset);
    setScore(p.name, p.parts, (p.offset ?? 0) + state.sec * GRID_MAX);
  }

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
    state.sec = 0;
    renderPresetInfo();
    save();
  });
  bind("#acc", (e) => {
    state.acc = e.target.value;
    phrase = null;
    updateDerived();
    save();
  });
  bind("#apply-preset", () => loadSection(state.sec), "click");
  bind("#section", (e) => {
    const sec = Number(e.target.value);
    const here = sourceBars().slice(state.sec * GRID_MAX, (state.sec + 1) * GRID_MAX).map((b) => b.trim());
    const dirty = state.bars.some((b, i) => b.trim() !== (here[i] ?? ""));
    if (dirty && !window.confirm("Tu as modifié la grille : la remplacer par cette section ?")) {
      e.target.value = String(state.sec);
      return;
    }
    loadSection(sec);
  });
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
    if (state.bars.length >= GRID_MAX) return;
    state.bars = [...state.bars, "", "", "", ""].slice(0, GRID_MAX);
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

  const onScoreChange = (e) => {
    if (!score) return;
    if (e.target.id === "score-view-part") {
      score.view = Number(e.target.value);
      renderScoreView();
    } else if (e.target.name === "model") {
      score.model = Number(e.target.value);
      phrase = null;
      select(sel.bar, sel.idx);
    } else if (e.target.id === "score-adapt") score.adapt = e.target.checked;
    else if (e.target.id === "score-echo") score.echo = e.target.checked;
  };
  const onScoreClick = (e) => {
    if (e.target.id === "play2") return playGrid();
    const hit = e.target.closest("[data-bar]");
    if (hit && score) return select(Number(hit.dataset.bar), 0);
    const page = e.target.closest("[data-page]");
    if (page && score) {
      const next = viewFrom + Number(page.dataset.page) * VIEW_BARS;
      return select(Math.max(0, Math.min(next, state.bars.length - 1)), 0);
    }
    const guess = e.target.closest("[data-guess]");
    if (guess && score) {
      state.bars[sel.bar] = guess.dataset.guess;
      renderGrid();
      save();
      return;
    }
    if (e.target.id === "score-guess" && score) {
      if (state.bars.some((b) => b.trim()) && !window.confirm("Remplacer les accords actuels de la grille par ceux déduits des notes ?")) return;
      const n = Math.min(GRID_MAX, Math.ceil(Math.max(1, score.bars - score.offset) / 4) * 4);
      const bars = guessBars(score.parts, n, accPref(), score.offset);
      if (!bars.some(Boolean)) return songStatus("Pas assez de notes pour deviner des accords.", true);
      setBars(bars);
      songStatus(`Grille déduite des notes : ${bars.filter(Boolean).length} mesures remplies. Vérifie à l'oreille (▶) et corrige ; clique « Enregistrer la grille » pour la garder.`);
      $("#grid").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (e.target.id === "score-forget") {
      score = null;
      renderScore();
      select(sel.bar, sel.idx);
    }
  };
  $("#score-panel").addEventListener("change", onScoreChange);
  $("#score-panel").addEventListener("click", onScoreClick);
  $("#follow").addEventListener("change", onScoreChange);
  $("#follow").addEventListener("click", onScoreClick);

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
      let style = {};
      if (score) {
        const an = score.analysis[score.model];
        if (score.adapt && an) style = styleFromAnalysis(an, instrument().range);
        if (score.echo && modelPart()) {
          const rhythm = rhythmFromNotes(notesIn(modelPart(), absBar(sel.bar) * 4, absBar(sel.bar) * 4 + 4), absBar(sel.bar) * 4);
          if (rhythm) style.rhythm = rhythm;
        }
      }
      const used = score && (score.adapt || score.echo) ? score.analysis[score.model]?.name : null;
      phrase = { events: generatePhrase(a.writtenRoot, scale.id, a.toneDegrees, Math.random, instrument().range, style), style: used };
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
