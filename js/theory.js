/**
 * Théorie musicale minimale : accords, gammes, transposition.
 *
 * Tout est pur (pas de DOM, pas d'audio) pour pouvoir être testé avec
 * `node --test`.
 *
 * Une note est un objet `{ letter, acc, oct }` :
 *  - letter : 0..6 pour C D E F G A B (la lettre compte : Do♯ ≠ Ré♭ à l'écrit)
 *  - acc    : altération, -2 (double bémol) .. +2 (double dièse)
 *  - oct    : octave scientifique (C4 = do central = MIDI 60)
 */

export const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
export const NAMES_FR = ["Do", "Ré", "Mi", "Fa", "Sol", "La", "Si"];

const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
const MAJOR_SEMIS = [0, 2, 4, 5, 7, 9, 11];
const ACC_SYMBOL = { "-2": "♭♭", "-1": "♭", 0: "", 1: "♯", 2: "♯♯" };

/* ---------- Notes ---------- */

export function makeNote(letter, acc, oct) {
  return { letter, acc, oct };
}

export function midiOf(n) {
  return 12 * (n.oct + 1) + NATURAL_PC[n.letter] + n.acc;
}

export function noteName(n, style = "fr") {
  const base = style === "fr" ? NAMES_FR[n.letter] : LETTERS[n.letter];
  return base + (ACC_SYMBOL[n.acc] ?? "");
}

/** Index diatonique absolu (sert à placer la note sur la portée). */
export function diatonicIndex(n) {
  return n.oct * 7 + n.letter;
}

/* ---------- Noms de fondamentales ---------- */

/** Nom préféré d'une fondamentale, selon le numéro de demi-ton. */
const ROOTS_MAJOR = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const ROOTS_MINOR = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
export const ROOT_CHOICES = ROOTS_MAJOR;

const MINORISH = new Set(["m", "m7", "m7b5", "dim7", "m6"]);

export function spellRoot(pc, quality) {
  const table = MINORISH.has(quality) ? ROOTS_MINOR : ROOTS_MAJOR;
  const name = table[((pc % 12) + 12) % 12];
  return {
    letter: LETTERS.indexOf(name[0]),
    acc: name[1] === "#" ? 1 : name[1] === "b" ? -1 : 0,
  };
}

/** Place une fondamentale dans l'octave qui tombe dans [low, low + 11]. */
export function placeRoot(root, low) {
  for (let oct = 0; oct <= 8; oct++) {
    const n = makeNote(root.letter, root.acc, oct);
    const m = midiOf(n);
    if (m >= low && m <= low + 11) return n;
  }
  throw new Error("octave introuvable");
}

/* ---------- Degrés et gammes ---------- */

/** "b3" -> { alt: -1, step: 3 } */
function parseDegree(token) {
  const m = /^([b#]*)(\d+)$/.exec(token);
  if (!m) throw new Error(`degré invalide : ${token}`);
  const alt = [...m[1]].reduce((a, c) => a + (c === "#" ? 1 : -1), 0);
  return { alt, step: Number(m[2]) };
}

/** Nombre de demi-tons au-dessus de la fondamentale. */
export function degreeSemis(token) {
  const { alt, step } = parseDegree(token);
  const idx = step - 1;
  return MAJOR_SEMIS[idx % 7] + 12 * Math.floor(idx / 7) + alt;
}

/**
 * Note correspondant à un degré, au-dessus d'une fondamentale.
 * La lettre est dictée par le degré (le 3 de Ré est une lettre « F »),
 * l'altération est calculée pour retomber sur le bon demi-ton.
 */
export function degreeNote(root, token) {
  const { step } = parseDegree(token);
  const d = diatonicIndex(root) + (step - 1);
  const letter = ((d % 7) + 7) % 7;
  const oct = Math.floor(d / 7);
  const target = midiOf(root) + degreeSemis(token);
  const natural = 12 * (oct + 1) + NATURAL_PC[letter];
  return makeNote(letter, target - natural, oct);
}

export const SCALES = {
  ionian: { name: "Ionien (gamme majeure)", degrees: ["1", "2", "3", "4", "5", "6", "7"] },
  dorian: { name: "Dorien", degrees: ["1", "2", "b3", "4", "5", "6", "b7"] },
  phrygian: { name: "Phrygien", degrees: ["1", "b2", "b3", "4", "5", "b6", "b7"] },
  lydian: { name: "Lydien", degrees: ["1", "2", "3", "#4", "5", "6", "7"] },
  mixolydian: { name: "Mixolydien", degrees: ["1", "2", "3", "4", "5", "6", "b7"] },
  aeolian: { name: "Éolien (mineur naturel)", degrees: ["1", "2", "b3", "4", "5", "b6", "b7"] },
  locrian: { name: "Locrien", degrees: ["1", "b2", "b3", "4", "b5", "b6", "b7"] },
  melodicMinor: { name: "Mineur mélodique", degrees: ["1", "2", "b3", "4", "5", "6", "7"] },
  phrygDom: { name: "Mixolydien ♭9 ♭13 (phrygien dominant)", degrees: ["1", "b2", "3", "4", "5", "b6", "b7"] },
  dimWH: { name: "Diminuée ton / demi-ton", degrees: ["1", "2", "b3", "4", "b5", "b6", "6", "7"] },
  dimHW: { name: "Diminuée demi-ton / ton", degrees: ["1", "b2", "#2", "3", "#4", "5", "6", "b7"] },
  majPent: { name: "Pentatonique majeure", degrees: ["1", "2", "3", "5", "6"] },
  minPent: { name: "Pentatonique mineure", degrees: ["1", "b3", "4", "5", "b7"] },
  blues: { name: "Gamme blues", degrees: ["1", "b3", "4", "b5", "5", "b7"] },
};

/** Notes d'une gamme, de la fondamentale à son octave incluse. */
export function scaleNotes(root, scaleId) {
  const notes = SCALES[scaleId].degrees.map((t) => degreeNote(root, t));
  notes.push(makeNote(root.letter, root.acc, root.oct + 1));
  return notes;
}

/** Toutes les notes de la gamme comprises dans [lo, hi] (MIDI), triées. */
export function scalePool(root, scaleId, lo, hi) {
  const out = [];
  for (const shift of [-1, 0, 1]) {
    const r = makeNote(root.letter, root.acc, root.oct + shift);
    for (const t of SCALES[scaleId].degrees) {
      const n = degreeNote(r, t);
      const m = midiOf(n);
      if (m >= lo && m <= hi) out.push(n);
    }
  }
  return out.sort((a, b) => midiOf(a) - midiOf(b));
}

/* ---------- Accords ---------- */

/** Pour chaque type d'accord : degrés des notes de l'accord + gammes conseillées. */
export const QUALITIES = {
  "": { symbol: "", label: "accord majeur", tones: ["1", "3", "5"], scales: ["ionian", "lydian", "majPent"] },
  m: { symbol: "m", label: "accord mineur", tones: ["1", "b3", "5"], scales: ["dorian", "aeolian", "minPent"] },
  maj7: { symbol: "maj7", label: "septième majeure", tones: ["1", "3", "5", "7"], scales: ["ionian", "lydian", "majPent"] },
  7: { symbol: "7", label: "septième de dominante", tones: ["1", "3", "5", "b7"], scales: ["mixolydian", "blues", "minPent"] },
  m7: { symbol: "m7", label: "septième mineure", tones: ["1", "b3", "5", "b7"], scales: ["dorian", "minPent", "aeolian"] },
  m7b5: { symbol: "m7♭5", label: "demi-diminué", tones: ["1", "b3", "b5", "b7"], scales: ["locrian"] },
  dim7: { symbol: "dim7", label: "septième diminuée", tones: ["1", "b3", "b5", "bb7"], scales: ["dimWH"] },
  "7b9": { symbol: "7♭9", label: "dominante ♭9", tones: ["1", "3", "5", "b7"], scales: ["phrygDom", "dimHW"] },
  6: { symbol: "6", label: "sixte", tones: ["1", "3", "5", "6"], scales: ["ionian", "majPent"] },
  m6: { symbol: "m6", label: "mineur sixte", tones: ["1", "b3", "5", "6"], scales: ["dorian", "melodicMinor"] },
};

const ALIASES = {
  "": "", maj: "", M: "",
  m: "m", min: "m", "-": "m",
  7: "7", dom7: "7",
  maj7: "maj7", M7: "maj7", ma7: "maj7", "Δ": "maj7", "Δ7": "maj7", "△": "maj7", "△7": "maj7",
  m7: "m7", min7: "m7", "-7": "m7",
  m7b5: "m7b5", "-7b5": "m7b5", min7b5: "m7b5", "ø": "m7b5", "ø7": "m7b5", "m7(b5)": "m7b5", "m7♭5": "m7b5",
  dim7: "dim7", o7: "dim7", "°7": "dim7", dim: "dim7", o: "dim7", "°": "dim7",
  "7b9": "7b9", "7♭9": "7b9",
  6: "6", m6: "m6", "-6": "m6",
};

export function parseChord(text) {
  const m = /^([A-Ga-g])([#b♯♭]?)(.*)$/.exec(String(text).trim());
  if (!m) return null;
  const quality = ALIASES[m[3]];
  if (quality === undefined) return null;
  const letter = LETTERS.indexOf(m[1].toUpperCase());
  const acc = m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0;
  const pc = (((NATURAL_PC[letter] + acc) % 12) + 12) % 12;
  return { letter, acc, pc, quality };
}

export function chordSymbol(root, quality) {
  return LETTERS[root.letter] + (ACC_SYMBOL[root.acc] ?? "") + QUALITIES[quality].symbol;
}

/* ---------- Instruments (transposition) ---------- */

/**
 * `semis` : de combien de demi-tons plus haut on écrit par rapport au son réel.
 * `low`   : MIDI de la note la plus grave où l'on place la fondamentale écrite.
 */
export const INSTRUMENTS = [
  { id: "bb-bass", label: "Sib grave, clé de sol — saxhorn basse, euphonium, baryton, sax ténor", short: "Sib grave (clé de sol)", semis: 14, clef: "treble", low: 55 },
  { id: "bass-fa", label: "Clé de fa, non transposé — tuba, trombone, saxhorn basse en « ut »", short: "Clé de fa (non transposé)", semis: 0, clef: "bass", low: 40 },
  { id: "bb", label: "Sib — trompette, clarinette, sax soprano", short: "Sib (trompette, clarinette)", semis: 2, clef: "treble", low: 60 },
  { id: "eb", label: "Mib — sax alto", short: "Mib (sax alto)", semis: 9, clef: "treble", low: 60 },
  { id: "f", label: "Fa — cor d'harmonie", short: "Fa (cor)", semis: 7, clef: "treble", low: 60 },
  { id: "c", label: "Do, clé de sol — flûte, violon, hautbois, piano", short: "Do (instruments en ut)", semis: 0, clef: "treble", low: 60 },
];

export function instrumentById(id) {
  return INSTRUMENTS.find((i) => i.id === id) ?? INSTRUMENTS[0];
}

/** Hauteur réelle (MIDI) d'une note écrite pour cet instrument. */
export function soundingMidi(writtenNote, inst) {
  return midiOf(writtenNote) - inst.semis;
}

/**
 * Tout ce qu'il faut savoir sur un accord, pour un instrument donné.
 * Les noms et gammes sont donnés tels qu'ils s'ÉCRIVENT sur la partition.
 */
export function analyseChord(text, inst) {
  const c = parseChord(text);
  if (!c) return null;
  const def = QUALITIES[c.quality];
  const writtenPc = (c.pc + inst.semis) % 12;
  const writtenRoot = placeRoot(spellRoot(writtenPc, c.quality), inst.low);
  const concertRoot = spellRoot(c.pc, c.quality);
  return {
    parsed: c,
    quality: c.quality,
    label: def.label,
    concertSymbol: chordSymbol(concertRoot, c.quality),
    writtenSymbol: chordSymbol(writtenRoot, c.quality),
    writtenRoot,
    tones: def.tones.map((t) => degreeNote(writtenRoot, t)),
    toneDegrees: def.tones,
    scales: def.scales.map((id) => ({ id, name: SCALES[id].name, notes: scaleNotes(writtenRoot, id) })),
  };
}

/* ---------- Phrase d'impro ---------- */

/**
 * Propose une phrase de 8 croches : notes de l'accord sur les temps,
 * notes de la gamme entre les deux. Ce n'est PAS de la musique géniale :
 * c'est un point de départ à jouer, déformer, rejeter.
 */
export function generatePhrase(root, scaleId, toneDegrees, rng = Math.random, length = 8) {
  const rootMidi = midiOf(root);
  const pool = scalePool(root, scaleId, rootMidi - 4, rootMidi + 12);
  const tonePcs = new Set(toneDegrees.map((t) => (midiOf(root) + degreeSemis(t)) % 12));
  const isTone = (n) => tonePcs.has(midiOf(n) % 12);

  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  let idx = pool.indexOf(pick(pool.filter(isTone).filter((n) => midiOf(n) <= rootMidi + 7)));
  let dir = rng() < 0.5 ? 1 : -1;
  const out = [pool[idx]];

  for (let i = 1; i < length; i++) {
    if (i % 2 === 0) {
      // temps : on atterrit sur une note d'accord proche, différente de la précédente
      const near = pool
        .map((n, j) => ({ n, j }))
        .filter(({ n, j }) => isTone(n) && j !== idx && Math.abs(j - idx) <= 3);
      if (near.length) idx = pick(near).j;
    } else {
      if (rng() < 0.3) dir = -dir;
      const step = rng() < 0.75 ? 1 : 2;
      let next = idx + dir * step;
      if (next < 0 || next >= pool.length) {
        dir = -dir;
        next = idx + dir * step;
      }
      idx = Math.max(0, Math.min(pool.length - 1, next));
    }
    out.push(pool[idx]);
  }
  return out;
}
