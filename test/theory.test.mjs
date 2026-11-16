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

test("phrase : 8 notes, toutes dans la gamme", () => {
  const inst = instrumentById("bb-bass");
  const a = analyseChord("Dm7", inst);
  const s = a.scales[0];
  const pcs = new Set(s.notes.map((n) => midiOf(n) % 12));
  for (let k = 0; k < 50; k++) {
    const p = generatePhrase(a.writtenRoot, s.id, a.toneDegrees);
    assert.equal(p.length, 8);
    for (const n of p) assert.ok(pcs.has(midiOf(n) % 12));
  }
});
