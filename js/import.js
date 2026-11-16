/**
 * Import d'un morceau : texte d'accords, MusicXML (.musicxml, .xml, .mxl) ou
 * MuseScore (.mscx, .mscz). On ne garde que les chiffrages d'accords, mesure
 * par mesure (4/4, 4 accords max par mesure, 64 mesures max).
 *
 * Les fonctions « texte » sont pures (testées avec `node --test`) ; la lecture
 * des fichiers XML / ZIP utilise les API du navigateur (DOMParser,
 * DecompressionStream).
 */
import { parseChord } from "./theory.js";

export const MAX_BARS = 64;
const MAX_PER_BAR = 4;

/** Suffixe d'accord quelconque (« -7 », « Δ », « 9 », « ø »…) → l'un des 10 types gérés. */
export function normalizeSuffix(raw) {
  let s = String(raw ?? "").trim().replace(/[()\s]/g, "").replace(/♭/g, "b").replace(/♯/g, "#");
  if (s === "") return "";
  s = s.replace(/\/.*$/, ""); // basse : Cmaj7/E → Cmaj7
  if (/^(maj|ma|M)$/.test(s)) return "";
  if (/^(ø|m7b5|-7b5|min7b5|hdim)/i.test(s) || /^m(in)?7?b5/.test(s)) return "m7b5";
  if (/^(dim|o|°)/i.test(s)) return "dim7";
  if (/^(maj|ma|M|Δ|△)/.test(s)) return "maj7";
  if (/^(m|min|-)/.test(s)) {
    if (/6/.test(s) && !/[79]|11|13/.test(s)) return "m6";
    return /7|9|11|13/.test(s) ? "m7" : "m";
  }
  if (/^(7|9|13).*b9/.test(s)) return "7b9";
  if (/^(7|9|11|13)/.test(s)) return "7";
  if (/^6/.test(s)) return "6";
  return ""; // sus, aug, add… : on garde l'accord majeur
}

const FR_ROOT = /^(Do|Ré|Re|Mi|Fa|Sol|La|Si)([#b♯♭]?)(.*)$/;
const EN_ROOT = /^([A-G])([#b♯♭]?)(.*)$/;

/** « Cmaj7/E », « Sib-7 », « Abm7(b5) » → « Cmaj7 », « Sibm7 », « Abm7b5 » ; null si illisible. */
export function normalizeChord(token) {
  const t = String(token).trim();
  const m = FR_ROOT.exec(t) ?? EN_ROOT.exec(t);
  if (!m) return null;
  const acc = m[2] === "♯" ? "#" : m[2] === "♭" ? "b" : m[2];
  const out = m[1] + acc + normalizeSuffix(m[3]);
  return parseChord(out) ? out : null;
}

/** Texte libre : mesures séparées par `|` ou par des retours à la ligne, accords par des espaces. */
export function parseChordText(text) {
  const bars = [];
  let skipped = 0;
  const parts = String(text).replace(/[‖∣]/g, "|").split(/[|\n\r]+/);
  for (const part of parts) {
    const toks = part.replace(/[:\[\]{}]/g, " ").split(/\s+/).filter(Boolean);
    if (!toks.length) continue;
    const kept = [];
    for (const tok of toks) {
      if (/^[%/.]$/.test(tok)) {
        kept.push("%");
        continue;
      }
      const c = normalizeChord(tok);
      if (c) kept.push(c);
      else skipped++;
    }
    if (kept.length) bars.push(kept.slice(0, MAX_PER_BAR).join(" "));
    if (bars.length >= MAX_BARS) break;
  }
  return { bars, skipped };
}

/* ----------------------------------------------------------- MuseScore */

const FIFTHS = ["F", "C", "G", "D", "A", "E", "B"];
/** Numéro « tpc » de MuseScore (ligne des quintes : 13 = Fa, 14 = Do, 15 = Sol…) → nom de note. */
export function tpcName(tpc) {
  const n = Number(tpc);
  if (!Number.isInteger(n) || n < 6 || n > 26) return null; // de Fa♭ à Si♯ (pas de doubles altérations)
  const acc = Math.floor((n + 1) / 7) - 2;
  return FIFTHS[(n + 1) % 7] + (acc > 0 ? "#" : acc < 0 ? "b" : "");
}

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Fichier XML illisible.");
  return doc;
}

const kids = (el, tag) => [...el.children].filter((c) => c.tagName === tag);
const txt = (el, tag) => kids(el, tag)[0]?.textContent.trim() ?? "";

/** MuseScore : la partition contient des <Measure> avec des <Harmony>. */
export function parseMscx(xmlText) {
  const doc = parseXml(xmlText);
  // les accords sont saisis sur une seule portée : on prend la première qui en a
  const staves = [...doc.querySelectorAll("Staff")].filter((s) => s.querySelector("Measure"));
  const staff = staves.find((s) => s.querySelector("Harmony")) ?? staves[0];
  const list = staff ? kids(staff, "Measure") : [];
  const bars = [];
  let skipped = 0;
  for (const meas of list) {
    const chords = [];
    for (const h of meas.querySelectorAll("Harmony")) {
      const root = txt(h, "root");
      const name = txt(h, "name");
      let c = null;
      if (root !== "") {
        const r = tpcName(root);
        c = r ? normalizeChord(r + name) : null;
      } else if (name) {
        c = normalizeChord(name);
      }
      if (c) chords.push(c);
      else skipped++;
    }
    bars.push(chords.slice(0, MAX_PER_BAR).join(" "));
    if (bars.length >= MAX_BARS) break;
  }
  return { bars: trimBars(bars), skipped };
}

/* ------------------------------------------------------------ MusicXML */

const KIND = {
  major: "", minor: "m", dominant: "7", "major-seventh": "maj7", "minor-seventh": "m7",
  "half-diminished": "m7b5", "diminished-seventh": "dim7", diminished: "dim7",
  "major-sixth": "6", "minor-sixth": "m6", "dominant-ninth": "7", "dominant-11th": "7",
  "dominant-13th": "7", "major-ninth": "maj7", "major-11th": "maj7", "major-13th": "maj7",
  "minor-ninth": "m7", "minor-11th": "m7", "minor-13th": "m7", "major-minor": "m",
  augmented: "", "augmented-seventh": "7", suspended: "", "suspended-second": "", "suspended-fourth": "",
  power: "", pedal: "", none: "", other: "",
};

export function parseMusicXml(xmlText) {
  const doc = parseXml(xmlText);
  const parts = [...doc.querySelectorAll("part")];
  const part = parts.find((p) => p.querySelector("harmony")) ?? parts[0];
  const bars = [];
  let skipped = 0;
  if (part) {
    for (const meas of kids(part, "measure")) {
      const chords = [];
      for (const h of kids(meas, "harmony")) {
        const rootEl = kids(h, "root")[0];
        if (!rootEl) {
          skipped++;
          continue;
        }
        const step = txt(rootEl, "root-step");
        const alter = Number(txt(rootEl, "root-alter") || 0);
        const kindEl = kids(h, "kind")[0];
        const kindText = kindEl?.getAttribute("text") ?? "";
        const kindVal = kindEl?.textContent.trim() ?? "";
        let suffix = kindVal in KIND ? KIND[kindVal] : normalizeSuffix(kindText);
        // 9 abaissée ajoutée à une dominante → 7b9
        const flat9 = kids(h, "degree").some((d) => txt(d, "degree-value") === "9" && txt(d, "degree-alter") === "-1");
        if (suffix === "7" && flat9) suffix = "7b9";
        const c = normalizeChord(step + (alter > 0 ? "#" : alter < 0 ? "b" : "") + suffix);
        if (c) chords.push(c);
        else skipped++;
      }
      bars.push(chords.slice(0, MAX_PER_BAR).join(" "));
      if (bars.length >= MAX_BARS) break;
    }
  }
  return { bars: trimBars(bars), skipped };
}

/** Retire les mesures vides de la fin (reprises, pages blanches). */
function trimBars(bars) {
  const out = [...bars];
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

/* ----------------------------------------------------------------- ZIP */

/** Lit un ZIP (central directory) → [{ name, read: () => Promise<Uint8Array> }]. */
export function listZip(buf) {
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Ce n'est pas un fichier ZIP valide.");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true);
    const elen = v.getUint16(p + 30, true);
    const clen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    entries.push({
      name,
      read: async () => {
        const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
        const raw = u8.subarray(start, start + csize);
        if (method === 0) return raw;
        if (method !== 8) throw new Error("Compression ZIP non gérée.");
        const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      },
    });
    p += 46 + nlen + elen + clen;
  }
  return entries;
}

/** Fichier choisi par l'utilisateur → { bars, skipped, title }. */
export async function importFile(file) {
  const name = file.name.toLowerCase();
  const title = file.name.replace(/\.[^.]+$/, "");
  const dec = new TextDecoder("utf-8");
  let result;
  if (/\.(mscz|mxl)$/.test(name)) {
    const entries = listZip(await file.arrayBuffer());
    const isMs = name.endsWith(".mscz");
    let pick;
    if (isMs) {
      pick = entries.find((e) => e.name.endsWith(".mscx"));
    } else {
      const cont = entries.find((e) => e.name === "META-INF/container.xml");
      const rootPath = cont ? /full-path="([^"]+)"/.exec(dec.decode(await cont.read()))?.[1] : null;
      pick = entries.find((e) => e.name === rootPath) ?? entries.find((e) => /\.(xml|musicxml)$/.test(e.name) && !e.name.startsWith("META-INF"));
    }
    if (!pick) throw new Error("Aucune partition trouvée dans l'archive.");
    const xml = dec.decode(await pick.read());
    result = isMs ? parseMscx(xml) : parseMusicXml(xml);
  } else if (name.endsWith(".mscx")) {
    result = parseMscx(await file.text());
  } else if (/\.(musicxml|xml)$/.test(name)) {
    result = parseMusicXml(await file.text());
  } else {
    result = parseChordText(await file.text());
  }
  if (!result.bars.length) {
    throw new Error("Aucun accord trouvé. Il faut des chiffrages d'accords (« symboles d'accords ») dans la partition.");
  }
  return { ...result, title };
}
