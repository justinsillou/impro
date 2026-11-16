import test from "node:test";
import assert from "node:assert/strict";
import {
  parseChord, analyseChord, instrumentById, noteName, midiOf, soundingMidi,
  degreeNote, makeNote, scaleNotes, generatePhrase,
} from "../js/theory.js";

const ascii = (s) => s.replaceAll("♭", "b").replaceAll("♯", "#");
const names = (notes) => notes.map((n) => ascii(noteName(n, "en")));

test("parseChord : alias et altérations", () => {
  assert.equal(parseChord("Bbm7").pc, 10);
  assert.equal(parseChord("Bbm7").quality, "m7");
  assert.equal(parseChord("Bm7b5").quality, "m7b5");
  assert.equal(parseChord("F#7b9").quality, "7b9");
  assert.equal(parseChord("CΔ").quality, "maj7");
  assert.equal(parseChord("H7"), null);
  assert.equal(parseChord("C13foo"), null);
});

test("orthographe : Ré♭ majeur et Fa locrien", () => {
  const db = makeNote(1, -1, 4);
  assert.deepEqual(names(scaleNotes(db, "ionian")), ["Db", "Eb", "F", "Gb", "Ab", "Bb", "C", "Db"]);
  const f = makeNote(3, 0, 4);
  assert.deepEqual(names(scaleNotes(f, "locrian")), ["F", "Gb", "Ab", "Bb", "Cb", "Db", "Eb", "F"]);
});

test("degreeNote : double bémol de la septième diminuée", () => {
  assert.equal(ascii(noteName(degreeNote(makeNote(0, 0, 4), "bb7"), "en")), "Bbb");
});

test("Sib (trompette) : C7 concert s'écrit D7, mixolydien de Ré", () => {
  const a = analyseChord("C7", instrumentById("bb"));
  assert.equal(a.writtenSymbol, "D7");
  assert.deepEqual(names(a.scales[0].notes), ["D", "E", "F#", "G", "A", "B", "C", "D"]);
});

test("Sib grave (saxhorn basse, clé de sol) : neuvième majeure", () => {
  const inst = instrumentById("bb-bass");
  const a = analyseChord("Cmaj7", inst);
  assert.equal(a.writtenSymbol, "Dmaj7");
  // Do écrit D4 (62) sonne C3 (48) : une neuvième majeure plus bas
  assert.equal(midiOf(a.writtenRoot), 62);
  assert.equal(soundingMidi(a.writtenRoot, inst), 48);
});

test("Mib (sax alto) : Gm7 concert s'écrit Em7, dorien de Mi", () => {
  const a = analyseChord("Gm7", instrumentById("eb"));
  assert.equal(a.writtenSymbol, "Em7");
  assert.deepEqual(names(a.scales[0].notes), ["E", "F#", "G", "A", "B", "C#", "D", "E"]);
});

test("dominante ♭9 : A7♭9 = La Sib Do# Ré Mi Fa Sol", () => {
  const a = analyseChord("A7b9", instrumentById("c"));
  assert.deepEqual(names(a.scales[0].notes), ["A", "Bb", "C#", "D", "E", "F", "G", "A"]);
});

test("clé de fa : la fondamentale tombe dans le registre du tuba", () => {
  const inst = instrumentById("bass-fa");
  for (const r of ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]) {
    const a = analyseChord(r + "7", inst);
    const m = midiOf(a.writtenRoot);
    assert.ok(m >= 40 && m <= 51, `${r} -> ${m}`);
  }
});

test("noms français : Sol7, Rém7, Sib, Mi♭maj7", () => {
  assert.equal(parseChord("Sol7").pc, 7);
  assert.equal(parseChord("Rém7").quality, "m7");
  assert.equal(parseChord("Re7").pc, 2);
  assert.equal(parseChord("Sib").pc, 10);
  assert.equal(parseChord("Mibmaj7").pc, 3);
});

/* ---------- v2 : tessiture, phrases, exports, quiz ---------- */
import { inRange, phraseNotes, noteFromMidi, RHYTHMS } from "../js/theory.js";
import { midiFile, musicXml } from "../js/export.js";
import { makeQuestion, checkAnswer, scoreImprov } from "../js/quiz.js";

test("tessiture : écrit hors limites détecté", () => {
  const inst = instrumentById("bb-bass");
  assert.ok(inRange(noteFromMidi(60), inst));
  assert.ok(!inRange(noteFromMidi(30), inst));
  assert.ok(!inRange(noteFromMidi(100), inst));
});

test("rythmes : chaque mesure fait 8 croches", () => {
  for (const r of RHYTHMS) assert.equal(r.reduce((a, b) => a + b, 0), 8);
});

test("phrase : une mesure, notes dans la gamme et la tessiture", () => {
  const inst = instrumentById("bb-bass");
  const a = analyseChord("Dm7", inst);
  const s = a.scales[0];
  const pcs = new Set(s.notes.map((n) => midiOf(n) % 12));
  for (let k = 0; k < 100; k++) {
    const p = generatePhrase(a.writtenRoot, s.id, a.toneDegrees, Math.random, inst.range);
    assert.equal(p.reduce((t, e) => t + e.len, 0), 8);
    assert.ok(p[0].note, "pas de silence au début");
    for (const n of phraseNotes(p)) {
      assert.ok(pcs.has(midiOf(n) % 12));
      assert.ok(midiOf(n) >= inst.range[0] && midiOf(n) <= inst.range[1]);
    }
  }
});

test("fichier MIDI : en-tête, pistes, notes", () => {
  const bytes = midiFile({
    tempo: 120,
    tracks: [{ name: "Basse", channel: 1, program: 32, notes: [{ t: 0, dur: 1, midi: 36 }, { t: 1, dur: 1, midi: 38 }] }],
  });
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), "MThd");
  assert.equal((bytes[10] << 8) | bytes[11], 2); // chef d'orchestre + 1 piste
  assert.equal((bytes[12] << 8) | bytes[13], 480);
  const on = [...bytes].filter((b, i, a) => b === 0x91 && a[i + 1] === 36).length;
  assert.equal(on, 1);
});

test("MusicXML : transposition de la basse Sib (clé de sol) et accord", () => {
  const inst = instrumentById("bb-bass");
  const a = analyseChord("Cmaj7", inst);
  const xml = musicXml({
    title: "t",
    inst,
    measures: [{ entries: [{ harmony: { root: a.concertRoot, quality: a.quality }, note: a.writtenRoot, dur: 8 }] }],
  });
  assert.match(xml, /<chromatic>-2<\/chromatic>/);
  assert.match(xml, /<octave-change>-1<\/octave-change>/);
  assert.match(xml, /<diatonic>-1<\/diatonic>/);
  assert.match(xml, /<root-step>C<\/root-step>/);
  assert.match(xml, /<kind text="maj7">major-seventh<\/kind>/);
  assert.match(xml, /<step>D<\/step>/);
  assert.equal((xml.match(/<measure /g) || []).length, 1);
});

test("quiz : bonne réponse reconnue, 4 choix distincts", () => {
  const inst = instrumentById("bb-bass");
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const t of ["chord-written", "tone-concert", "read-concert", "scale-name"]) {
    for (let k = 0; k < 30; k++) {
      const q = makeQuestion(t, inst, rng, "fr");
      assert.ok(checkAnswer(q, q.answer), q.prompt);
      if (q.input === "choice") {
        assert.equal(new Set(q.choices.map((c) => c.label)).size, q.choices.length);
        assert.ok(q.choices.length >= 3);
        assert.ok(q.choices.some((c) => c.value === q.answer));
      }
      if (q.input === "pc") assert.ok(checkAnswer(q, q.answer + 12));
    }
  }
});

test("quiz : transposition Sib grave, Cmaj7 -> Dmaj7", () => {
  const inst = instrumentById("bb-bass");
  let found = null;
  for (let k = 0; k < 400 && !found; k++) {
    const q = makeQuestion("chord-written", inst, Math.random, "en");
    if (q.prompt.includes("Cmaj7")) found = q;
  }
  assert.ok(found);
  assert.equal(found.answer, "Dmaj7");
});

test("notation d'impro : accord > gamme > hors gamme", () => {
  const info = { tones: new Set([2, 5, 9, 0]), scale: new Set([2, 4, 5, 7, 9, 11, 0]) };
  const beatInfo = [info, info, info, info];
  const r = scoreImprov(
    [
      { beat: 0.05, midi: 62 }, // Ré sur le temps : accord
      { beat: 1.5, midi: 64 }, // Mi à contretemps : gamme
      { beat: 2.0, midi: 61 }, // Do♯ : hors gamme
      { beat: 3.0, midi: 65 }, // Fa sur le temps : accord
    ],
    beatInfo,
  );
  assert.equal(r.total, 4);
  assert.equal(r.chord, 2);
  assert.equal(r.scale, 1);
  assert.equal(r.out, 1);
  assert.equal(r.strong, 3);
  assert.equal(r.strongChord, 2);
  assert.equal(r.inScalePct, 75);
  assert.equal(r.outList[0].bar, 1);
});
