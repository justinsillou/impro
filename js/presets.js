/**
 * Grilles classiques, écrites en DEGRÉS (chiffres romains) et non en notes :
 * [demi-tons au-dessus de la tonique, type d'accord].
 * On les « plaque » ensuite dans la tonalité de son choix.
 * Chaque mesure est une liste d'accords (1, 2 ou 4 accords par mesure).
 */
import { spellRoot, QUALITIES, LETTERS } from "./theory.js";

const I = (q = "") => [0, q];
const II = (q = "m7") => [2, q];
const III = (q = "m7") => [4, q];
const IV = (q = "") => [5, q];
const V = (q = "7") => [7, q];
const VI = (q = "m7") => [9, q];
const VII = (q = "m7b5") => [11, q];
// degrés altérés (en demi-tons au-dessus de la tonique)
const bVI = (q = "7") => [8, q];

export const PRESETS = [
  {
    id: "blues",
    name: "Blues en 12 mesures",
    info: "La grille de base : I7 – IV7 – V7. Une seule gamme (blues ou pentatonique mineure) marche presque partout.",
    bars: [
      [I("7")], [I("7")], [I("7")], [I("7")],
      [IV("7")], [IV("7")], [I("7")], [I("7")],
      [V("7")], [IV("7")], [I("7")], [I("7")],
    ],
  },
  {
    id: "blues-jazz",
    name: "Blues jazz (avec II–V)",
    info: "Même forme, mais avec un VI7 qui prépare le II–V final : plus d'accords, donc plus de gammes à changer.",
    bars: [
      [I("7")], [IV("7")], [I("7")], [I("7")],
      [IV("7")], [IV("7")], [I("7")], [VI("7")],
      [II()], [V()], [I("7"), VI("7")], [II(), V()],
    ],
  },
  {
    id: "ii-v-i",
    name: "II–V–I majeur",
    info: "Le mouvement de base du jazz : Dorien sur le II, Mixolydien sur le V, Ionien sur le I.",
    bars: [[II()], [V()], [I("maj7")], [I("maj7")]],
  },
  {
    id: "ii-v-i-minor",
    name: "II–V–I mineur",
    info: "Le II est demi-diminué (Locrien), le V a un ♭9 (phrygien dominant), le I est mineur.",
    bars: [[II("m7b5")], [V("7b9")], [I("m6")], [I("m6")]],
  },
  {
    id: "fourths",
    name: "Cycle de quartes (style « Les feuilles mortes »)",
    info: "II–V–I puis IV–VII–III–VI : chaque racine descend d'une quinte. Une succession de II–V à enchaîner.",
    bars: [
      [II()], [V()], [I("maj7")], [IV("maj7")],
      [VII()], [III("7b9")], [VI()], [VI()],
    ],
  },
  {
    id: "autumn-leaves",
    name: "Les feuilles mortes (Autumn Leaves, 32 mesures)",
    info: "Forme AABC du standard. Tonique = la tonalité majeure relative (Sib pour sol mineur) : la grille est écrite en degrés, donc choisis Sib pour la version habituelle. Mineur sur le VI.",
    bars: [
      [II()], [V()], [I("maj7")], [IV("maj7")], [VII()], [III("7b9")], [VI("m")], [VI("m")],
      [II()], [V()], [I("maj7")], [IV("maj7")], [VII()], [III("7b9")], [VI("m")], [VI("m")],
      [VII()], [III("7b9")], [VI("m")], [VI("m")], [II()], [V()], [I("maj7")], [IV("maj7")],
      [II()], [V()], [I("maj7")], [IV("maj7")], [VII()], [III("7b9")], [VI("m")], [VI("m")],
    ],
  },
  {
    id: "rhythm-changes",
    name: "Rhythm changes (I Got Rhythm, 32 mesures)",
    info: "AABA : trois fois la même grille de 8 mesures (I–VI–II–V), et un pont de dominantes qui montent par quartes (III7–VI7–II7–V7). Classique des jam sessions.",
    bars: [
      [I("6"), VI("7")], [II(), V()], [III(), VI("7")], [II(), V()],
      [I("7")], [IV("7")], [I("6"), VI("7")], [II(), V()],
      [I("6"), VI("7")], [II(), V()], [III(), VI("7")], [II(), V()],
      [I("7")], [IV("7")], [I("6")], [I("6")],
      [III("7")], [III("7")], [VI("7")], [VI("7")],
      [II("7")], [II("7")], [V("7")], [V("7")],
      [I("6"), VI("7")], [II(), V()], [III(), VI("7")], [II(), V()],
      [I("7")], [IV("7")], [I("6")], [I("6")],
    ],
  },
  {
    id: "blues-minor",
    name: "Blues mineur (12 mesures)",
    info: "Même forme que le blues, mais en mineur : Im7 – IVm7 – ♭VI7 – V7♭9. La pentatonique mineure ou le dorien passent sur les accords mineurs.",
    bars: [
      [I("m7")], [I("m7")], [I("m7")], [I("m7")],
      [IV("m7")], [IV("m7")], [I("m7")], [I("m7")],
      [bVI("7")], [V("7b9")], [I("m7")], [V("7b9")],
    ],
  },
  {
    id: "pop",
    name: "Pop (I–V–VI–IV)",
    info: "Les quatre accords de centaines de chansons pop. Gamme majeure ou pentatonique majeure sur tout, ou pentatonique mineure sur le VIm.",
    bars: [[I()], [V("")], [VI("m")], [IV()]],
  },
  {
    id: "anatole",
    name: "Anatole (I–VI–II–V)",
    info: "La boucle qui sert de base à des centaines de standards. 4 mesures, à répéter.",
    bars: [[I("maj7")], [VI()], [II()], [V()]],
  },
  {
    id: "canon",
    name: "Canon (I–V–VI–III–IV–I–IV–V)",
    info: "Que des accords simples : idéal pour débuter avec la gamme majeure ou la pentatonique majeure.",
    bars: [
      [I()], [V("")], [VI("m")], [III("m")],
      [IV()], [I()], [IV()], [V("")],
    ],
  },
];

/** Transpose un preset dans une tonalité (pc de la tonique) -> liste de mesures en texte. */
export function presetToBars(preset, tonicPc, pref) {
  return preset.bars.map((chords) =>
    chords
      .map(([semis, quality]) => {
        const root = spellRoot((tonicPc + semis) % 12, quality, pref);
        const acc = root.acc === 1 ? "#" : root.acc === -1 ? "b" : "";
        return LETTERS[root.letter] + acc + QUALITIES[quality].symbol.replace("♭", "b");
      })
      .join(" "),
  );
}
