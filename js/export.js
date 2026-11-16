/**
 * Exports : fichier MIDI (SMF) et MusicXML (ouvrable dans MuseScore, etc.).
 * Fonctions pures : elles renvoient des octets / du texte, le navigateur
 * s'occupe du téléchargement.
 */
import { LETTERS, QUALITIES, midiOf } from "./theory.js";

/* ---------------------------------------------------------------- MIDI */

const PPQ = 480;

function vlq(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7) > 0) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >>> 8) & 255, n & 255];
const ascii = (s) => [...s].map((c) => c.charCodeAt(0) & 127);

function chunk(type, data) {
  return [...ascii(type), ...u32(data.length), ...data];
}

/**
 * @param {{tempo: number, title?: string,
 *          tracks: {name: string, channel: number, program: number,
 *                   notes: {t: number, dur: number, midi: number, vel?: number}[]}[]}} song
 *   `t` et `dur` en temps (noires).
 */
export function midiFile({ tempo, title = "Grille d'impro", tracks }) {
  const mpqn = Math.round(60_000_000 / tempo);
  const nameEvent = (name) => {
    const b = ascii(name);
    return [0, 0xff, 0x03, ...vlq(b.length), ...b];
  };
  const conductor = [
    ...nameEvent(title),
    0, 0xff, 0x51, 3, (mpqn >> 16) & 255, (mpqn >> 8) & 255, mpqn & 255,
    0, 0xff, 0x58, 4, 4, 2, 24, 8,
    0, 0xff, 0x2f, 0,
  ];
  const parts = [chunk("MTrk", conductor)];

  for (const tr of tracks) {
    const ev = [];
    for (const n of tr.notes) {
      const on = Math.round(n.t * PPQ);
      const off = on + Math.max(1, Math.round(n.dur * PPQ));
      const midi = Math.max(0, Math.min(127, Math.round(n.midi)));
      ev.push({ tick: on, order: 1, data: [0x90 | tr.channel, midi, n.vel ?? 90] });
      ev.push({ tick: off, order: 0, data: [0x80 | tr.channel, midi, 0] });
    }
    ev.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const body = [...nameEvent(tr.name), 0, 0xc0 | tr.channel, tr.program];
    let last = 0;
    for (const e of ev) {
      body.push(...vlq(e.tick - last), ...e.data);
      last = e.tick;
    }
    body.push(0, 0xff, 0x2f, 0);
    parts.push(chunk("MTrk", body));
  }

  const header = chunk("MThd", [...u16(1), ...u16(parts.length), ...u16(PPQ)]);
  return new Uint8Array([...header, ...parts.flat()]);
}

/* ------------------------------------------------------------ MusicXML */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const KIND = {
  "": "major", m: "minor", 7: "dominant", maj7: "major-seventh", m7: "minor-seventh",
  m7b5: "half-diminished", dim7: "diminished-seventh", "7b9": "dominant", 6: "major-sixth", m6: "minor-sixth",
};

const TYPE = { 1: "eighth", 2: "quarter", 4: "half", 8: "whole" };

/** Demi-tons -> [pas diatoniques, demi-tons] pour <transpose> (écrit -> son). */
const DIATONIC_FOR = { 0: 0, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 5, 9: 5, 10: 6, 11: 6 };

function pitchXml(n) {
  const alter = n.acc ? `<alter>${n.acc}</alter>` : "";
  return `<pitch><step>${LETTERS[n.letter]}</step>${alter}<octave>${n.oct}</octave></pitch>`;
}

function harmonyXml(h) {
  const alter = h.root.acc ? `<root-alter>${h.root.acc}</root-alter>` : "";
  return `<harmony><root><root-step>${LETTERS[h.root.letter]}</root-step>${alter}</root><kind text="${esc(QUALITIES[h.quality].symbol)}">${KIND[h.quality]}</kind></harmony>`;
}

function entryXml(e) {
  const dur = e.dur;
  const base = TYPE[dur] ?? TYPE[dur - 1] ?? "quarter";
  const dot = TYPE[dur] ? "" : "<dot/>";
  const harmony = e.harmony ? harmonyXml(e.harmony) : "";
  const body = e.note ? pitchXml(e.note) : "<rest/>";
  return `${harmony}<note>${body}<duration>${dur}</duration><type>${base}</type>${dot}</note>`;
}

/**
 * Partition MusicXML d'une partie.
 * @param {{title: string, inst: {semis: number, clef: string, short: string},
 *          measures: {entries: {note?: object, dur: number, harmony?: {root: object, quality: string}}[]}[]}} score
 * `dur` en croches (division = 2 par noire). Les notes sont ÉCRITES pour
 * l'instrument ; <transpose> indique le son réel. Les chiffrages d'accords
 * sont ceux du groupe (sons réels).
 */
export function musicXml({ title, inst, measures }) {
  const oct = Math.floor(inst.semis / 12);
  const rem = inst.semis % 12;
  const transpose = inst.semis
    ? `<transpose><diatonic>${-DIATONIC_FOR[rem]}</diatonic><chromatic>${-rem}</chromatic>${oct ? `<octave-change>${-oct}</octave-change>` : ""}</transpose>`
    : "";
  const clef = inst.clef === "bass" ? "<sign>F</sign><line>4</line>" : "<sign>G</sign><line>2</line>";
  const bars = measures
    .map((m, i) => {
      const attrs =
        i === 0
          ? `<attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef>${clef}</clef>${transpose}</attributes>`
          : "";
      return `<measure number="${i + 1}">${attrs}${m.entries.map(entryXml).join("")}</measure>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
<work><work-title>${esc(title)}</work-title></work>
<identification><encoding><software>Grille d'impro</software></encoding></identification>
<part-list><score-part id="P1"><part-name>${esc(inst.short)}</part-name></score-part></part-list>
<part id="P1">${bars}</part>
</score-partwise>
`;
}

/** Hauteur MIDI d'une note, pour les exports. */
export const noteMidi = midiOf;

/** Déclenche le téléchargement d'un fichier généré dans le navigateur. */
export function download(filename, data, mime) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
