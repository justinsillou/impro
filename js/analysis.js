/**
 * Analyse d'une partition importée : pour chaque partie (instrument), quelques
 * statistiques simples sur ce qu'elle joue (tessiture, mouvement, rythme,
 * densité), puis un « style » qui sert à orienter les phrases proposées.
 *
 * Pur (pas de DOM) : testé avec `node --test`.
 *
 * Une partie : { name, notes: [{ m, t, d }] } avec
 *  - m : hauteur MIDI en sons réels,
 *  - t : position en temps (noires), mesure n = 4 × n + temps dans la mesure,
 *  - d : durée en temps.
 */
import { QUALITIES, degreeSemis, noteFromMidi, noteName, spellRoot } from "./theory.js";

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const share = (arr, pred) => (arr.length ? arr.filter(pred).length / arr.length : 0);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Notes dont le début tombe dans [from, to) (en temps). */
export const notesIn = (part, from, to) => part.notes.filter((n) => n.t >= from && n.t < to);

export function analysePart(part, totalBars) {
  const notes = [...part.notes].sort((a, b) => a.t - b.t || b.m - a.m);
  const bars = Math.max(1, totalBars);
  const perBar = new Array(bars).fill(0);
  for (const n of notes) {
    const b = Math.floor(n.t / 4);
    if (b >= 0 && b < bars) perBar[b]++;
  }
  const active = perBar.filter((x) => x > 0).length;
  const ms = notes.map((n) => n.m);
  const lo = Math.min(...ms);
  const hi = Math.max(...ms);
  // intervalles entre notes successives (ligne mélodique : une note par début)
  const line = notes.filter((n, i) => i === 0 || n.t > notes[i - 1].t + 1e-6);
  const iv = line.slice(1).map((n, i) => n.m - line[i].m);
  const moving = iv.filter((x) => x !== 0);
  const fill = active ? notes.reduce((a, n) => a + n.d, 0) / (active * 4) : 0;
  return {
    name: part.name,
    count: notes.length,
    perBar,
    active,
    density: active ? notes.length / active : 0,
    lo,
    hi,
    median: median(ms),
    step: share(iv, (x) => x !== 0 && Math.abs(x) <= 2),
    leap: share(iv, (x) => Math.abs(x) >= 5),
    repeat: share(iv, (x) => x === 0),
    up: moving.length ? moving.filter((x) => x > 0).length / moving.length : 0.5,
    short: share(notes, (n) => n.d <= 0.5 + 1e-6),
    long: share(notes, (n) => n.d >= 2 - 1e-6),
    off: share(notes, (n) => Math.abs(n.t - Math.round(n.t)) > 0.01),
    fill: Math.min(1, fill),
  };
}

/** Analyse toutes les parties et ajoute rôle + description. */
export function analyseParts(parts, totalBars) {
  const list = parts.filter((p) => p.notes.length >= 4).map((p) => analysePart(p, totalBars));
  if (!list.length) return [];
  const maxCount = Math.max(...list.map((a) => a.count));
  const meanDensity = list.reduce((s, a) => s + a.density, 0) / list.length;
  const lowest = list.reduce((m, a) => (a.median < m.median ? a : m), list[0]);
  const lead = list
    .filter((a) => a !== lowest && a.count >= maxCount * 0.4)
    .reduce((m, a) => (!m || a.median > m.median ? a : m), null);
  for (const a of list) {
    a.role =
      list.length > 1 && a === lowest && a.median < 55 ? "Basse" : a === lead || list.length === 1 ? "Mélodie" : "Accompagnement / harmonie";
    a.vsPiece = meanDensity ? a.density / meanDensity : 1;
    a.text = describe(a);
  }
  return list;
}

const nm = (m) => noteName(noteFromMidi(m), "fr") + (Math.floor(m / 12) - 1);

export function describe(a) {
  const bits = [];
  bits.push(`tessiture ${nm(a.lo)} → ${nm(a.hi)} (sons réels, ${a.hi - a.lo} demi-tons)`);
  if (a.step >= 0.6) bits.push("surtout par degrés conjoints");
  else if (a.leap >= 0.3) bits.push("beaucoup de sauts");
  else bits.push("mélange de degrés conjoints et de sauts");
  if (a.repeat >= 0.35) bits.push("notes souvent répétées");
  if (a.up >= 0.58) bits.push("plutôt ascendante");
  else if (a.up <= 0.42) bits.push("plutôt descendante");
  if (a.short >= 0.6) bits.push("notes courtes (croches)");
  else if (a.long >= 0.5) bits.push("notes longues");
  if (a.off >= 0.25) bits.push("souvent à contretemps");
  if (a.vsPiece >= 1.3) bits.push("plus active que la moyenne du morceau");
  else if (a.vsPiece <= 0.7) bits.push("plus calme que la moyenne du morceau");
  return bits.join(" ; ") + ".";
}

/**
 * Réglages de génération tirés d'une analyse, pour `generatePhrase`.
 * `range` : tessiture écrite de l'instrument de l'utilisateur ; on reporte la
 * hauteur « relative » de la partie modèle dans cette tessiture.
 */
export function styleFromAnalysis(a, range) {
  const span = Math.max(1, a.hi - a.lo);
  const rel = clamp((a.median - a.lo) / span, 0, 1);
  return {
    eighths: clamp(a.short, 0, 1), // part de croches
    off: clamp(a.off, 0, 1), // goût du contretemps
    step: clamp(0.5 + a.step - a.leap, 0.4, 0.95),
    up: clamp(a.up, 0.2, 0.8),
    rest: clamp((1 - a.fill) * 0.6, 0.05, 0.6),
    center: range ? range[0] + rel * (range[1] - range[0]) : null,
  };
}

/**
 * Rythme d'une mesure de la partition, en croches : [{ len, rest }] qui
 * totalise 8, ou null s'il y a trop peu de notes. Durées limitées à 3 croches.
 */
export function rhythmFromNotes(notes, barStart) {
  const slots = [];
  for (const n of [...notes].sort((a, b) => a.t - b.t)) {
    const s = clamp(Math.round((n.t - barStart) * 2), 0, 7);
    if (!slots.length || s > slots[slots.length - 1].s) slots.push({ s, e: clamp(Math.round((n.t + n.d - barStart) * 2), s + 1, 8) });
  }
  if (slots.length < 2) return null;
  const out = [];
  let pos = 0;
  slots.forEach((sl, i) => {
    if (sl.s > pos) out.push({ len: sl.s - pos, rest: true });
    const next = i + 1 < slots.length ? slots[i + 1].s : 8;
    const len = Math.min(sl.e, next) - sl.s;
    const kept = Math.min(len, 3);
    out.push({ len: kept, rest: false });
    pos = sl.s + kept;
    if (next > pos && i + 1 < slots.length) {
      out.push({ len: next - pos, rest: true });
      pos = next;
    }
  });
  if (pos < 8) out.push({ len: 8 - pos, rest: true });
  // découpe les silences longs en morceaux de 1 à 3 croches (affichage)
  const flat = [];
  for (const e of out) {
    let left = e.len;
    while (left > 0) {
      const l = e.rest ? Math.min(left, 2) : left;
      flat.push({ len: l, rest: e.rest });
      left -= l;
    }
  }
  return flat;
}

/* ------------------------------------------------- accords déduits des notes */

// petit malus de complexité : à notes égales, on préfère l'accord le plus simple
const COMPLEXITY = { "": 0, m: 0.02, 7: 0.04, m7: 0.03, maj7: 0.05, 6: 0.1, m6: 0.1, m7b5: 0.08, dim7: 0.1, "7b9": 0.12 };
const TEMPLATES = Object.entries(QUALITIES).map(([q, d]) => ({
  q,
  tones: d.tones.map((t) => ((degreeSemis(t) % 12) + 12) % 12),
  fifth: ((degreeSemis(d.tones.find((t) => /5$/.test(t))) % 12) + 12) % 12,
}));

/**
 * Accords qui collent le mieux à des notes (sons réels) : [{ name, score }],
 * du meilleur au moins bon. Les notes longues et sur les temps forts comptent
 * plus, la note la plus grave donne un bonus à la fondamentale.
 * `name` est un texte d'accord lisible par `parseChord` (ex. « Bb7 »).
 */
export function chordCandidates(notes, pref, count = 3) {
  if (!notes.length) return [];
  const hist = new Array(12).fill(0);
  let total = 0;
  for (const n of notes) {
    const beat = ((n.t % 4) + 4) % 4;
    const w = clamp(n.d, 0.25, 4) * (beat % 2 === 0 ? 1.5 : beat % 1 === 0 ? 1.25 : 1);
    hist[((n.m % 12) + 12) % 12] += w;
    total += w;
  }
  const bass = ((Math.min(...notes.map((n) => n.m)) % 12) + 12) % 12;
  const out = [];
  for (let root = 0; root < 12; root++) {
    for (const t of TEMPLATES) {
      const set = new Set(t.tones.map((s) => (root + s) % 12));
      let inside = 0;
      for (let pc = 0; pc < 12; pc++) if (set.has(pc)) inside += hist[pc];
      let missing = 0;
      for (const s of t.tones) if (s !== t.fifth && hist[(root + s) % 12] === 0) missing++;
      const score = inside / total - 0.8 * ((total - inside) / total) - 0.1 * missing + (bass === root ? 0.2 : 0) - COMPLEXITY[t.q];
      const r = spellRoot(root, t.q, pref);
      const name = ["C", "D", "E", "F", "G", "A", "B"][r.letter] + (r.acc > 0 ? "#" : r.acc < 0 ? "b" : "") + t.q;
      out.push({ name, score });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, count);
}

/**
 * Grille déduite d'une partition : une chaîne par mesure (un accord, ou deux
 * si la mesure change d'harmonie à mi-chemin ; vide s'il n'y a aucune note).
 */
export function guessBars(parts, totalBars, pref) {
  const all = parts.flatMap((p) => p.notes);
  const win = (a, b) => all.filter((n) => n.t >= a && n.t < b);
  const bars = [];
  for (let b = 0; b < totalBars; b++) {
    const whole = win(b * 4, b * 4 + 4);
    const [best] = chordCandidates(whole, pref, 1);
    if (!best) {
      bars.push("");
      continue;
    }
    const h1 = win(b * 4, b * 4 + 2);
    const h2 = win(b * 4 + 2, b * 4 + 4);
    const [c1] = chordCandidates(h1, pref, 1);
    const [c2] = chordCandidates(h2, pref, 1);
    const split = h1.length >= 2 && h2.length >= 2 && c1.name !== c2.name && (c1.score + c2.score) / 2 > best.score + 0.2;
    bars.push(split ? `${c1.name} ${c2.name}` : best.name);
  }
  return bars;
}

/**
 * Part (0..1) des notes jouées par la partition qui appartiennent à une gamme
 * donnée (degrés relatifs à la fondamentale `rootPc`), pondérée par la durée.
 */
export function scaleCoverage(rootPc, degrees, notes) {
  const pcs = new Set(degrees.map((d) => (rootPc + degreeSemis(d)) % 12));
  let total = 0;
  let inside = 0;
  for (const n of notes) {
    const w = Math.max(0.25, n.d);
    total += w;
    if (pcs.has(((n.m % 12) + 12) % 12)) inside += w;
  }
  return total ? inside / total : null;
}
