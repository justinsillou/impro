/**
 * Interface du clavier MIDI et du mode test (quiz + test d'improvisation).
 * Reçoit de app.js un petit objet de contexte pour rester découplé.
 */
import { chordSymbol, degreeSemis, inRange, noteFromMidi, noteName } from "./theory.js";
import { QUIZ_TYPES, checkAnswer, makeQuestion, noteLabel, scoreImprov } from "./quiz.js";
import { staffSvg } from "./staff.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const QUIZ_LENGTH = 10;
const BEST_KEY = "impro-quiz-best";

export function initTestUi(ctx) {
  const { engine, midi } = ctx;

  /* ------------------------------------------------------- clavier MIDI */

  let lastMidi = null;
  let recording = false;
  let recorded = [];

  function setStatus(text, ok = true) {
    const el = $("#midi-status");
    el.textContent = text;
    el.classList.toggle("bad", !ok);
  }

  function fillDevices(list, selectedId) {
    const sel = $("#midi-device");
    sel.innerHTML = list.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join("");
    if (selectedId) sel.value = selectedId;
    setStatus(
      list.length ? `Clavier connecté : ${list.find((d) => d.id === selectedId)?.name ?? list[0].name}. Joue une note !` : "Aucun clavier détecté. Branche-le en USB puis réessaie.",
      list.length > 0,
    );
  }

  midi.onDevices = fillDevices;

  $("#midi-connect").addEventListener("click", async () => {
    if (!midi.supported) {
      setStatus("Ton navigateur ne gère pas le MIDI. Utilise Chrome, Edge ou Opera (Firefox : à autoriser dans les réglages).", false);
      return;
    }
    try {
      fillDevices(await midi.connect(), midi.input?.id ?? null);
    } catch {
      setStatus("Accès MIDI refusé. Autorise-le dans la barre d'adresse du navigateur, puis réessaie.", false);
    }
  });
  $("#midi-device").addEventListener("change", (e) => midi.select(e.target.value));

  const tonesAndScale = (a) => {
    const pcs = (degrees) => new Set(degrees.map((d) => (a.parsed.pc + degreeSemis(d)) % 12));
    const scale = new Set();
    for (const s of a.scales) for (const pc of pcs(s.degrees)) scale.add(pc);
    return { tones: pcs(a.toneDegrees), scale };
  };

  function showLive(m) {
    const box = $("#midi-live");
    const inst = ctx.instrument();
    const style = ctx.names();
    const written = noteFromMidi(m + inst.semis);
    const deco = { ...written, out: !inRange(written, inst) };
    const a = ctx.chordForLive();
    let verdict = `<span class="verdict muted">Sélectionne un accord pour voir si la note colle.</span>`;
    if (a) {
      const { tones, scale } = tonesAndScale(a);
      const pc = m % 12;
      verdict = tones.has(pc)
        ? `<span class="verdict ok">✔ note de l'accord (${esc(chordSymbol(a.concertRoot, a.quality, style))})</span>`
        : scale.has(pc)
          ? `<span class="verdict mid">◯ dans la gamme, note de passage</span>`
          : `<span class="verdict bad">✖ hors gamme sur ${esc(chordSymbol(a.concertRoot, a.quality, style))}</span>`;
    }
    box.innerHTML = `
      <p>Tu joues <strong>${esc(noteName(noteFromMidi(m), style))}</strong> <small>(son réel)</small>
      ${inst.semis ? `→ tu lis <strong>${esc(noteName(written, style))}</strong> <small>(écrit pour ton instrument)</small>` : ""}
      ${deco.out ? ` <span class="verdict bad">hors tessiture</span>` : ""}</p>
      <div class="staff-wrap">${staffSvg([deco], inst.clef, style)}</div>
      <p>${verdict}</p>`;
  }

  midi.onNote = (e) => {
    if (e.type === "off") {
      engine.liveOff(e.midi);
      return;
    }
    if ($("#midi-monitor").checked) engine.liveOn(e.midi, e.vel);
    lastMidi = e.midi;
    showLive(e.midi);
    if (recording) {
      const beat = engine.beatNow();
      if (beat !== null && beat >= 0) recorded.push({ beat, midi: e.midi });
    }
    if (quiz.active && quiz.q && !quiz.answered && quiz.q.input === "pc") answer(e.midi % 12);
  };

  // si l'accord courant change, on remet à jour le verdict de la dernière note
  document.addEventListener("impro:chord-changed", () => {
    if (lastMidi !== null && $("#midi-live").innerHTML) showLive(lastMidi);
  });

  /* ------------------------------------------------------------- onglets */

  for (const tab of document.querySelectorAll("[data-mode]")) {
    tab.addEventListener("click", () => {
      for (const t of document.querySelectorAll("[data-mode]")) t.setAttribute("aria-selected", String(t === tab));
      $("#mode-quiz").hidden = tab.dataset.mode !== "quiz";
      $("#mode-improv").hidden = tab.dataset.mode !== "improv";
    });
  }

  /* ---------------------------------------------------------------- quiz */

  const quiz = { active: false, n: 0, score: 0, q: null, answered: false };
  $("#quiz-type").innerHTML = QUIZ_TYPES.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join("");

  function best() {
    try {
      return Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch {
      return 0;
    }
  }

  function startQuiz() {
    Object.assign(quiz, { active: true, n: 0, score: 0, answered: false });
    nextQuestion();
  }

  function nextQuestion() {
    if (quiz.n >= QUIZ_LENGTH) return finishQuiz();
    quiz.q = makeQuestion($("#quiz-type").value, ctx.instrument(), Math.random, ctx.names());
    quiz.answered = false;
    quiz.n++;
    renderQuestion();
  }

  function renderQuestion() {
    const q = quiz.q;
    const style = ctx.names();
    let input;
    if (q.input === "choice") {
      input = `<div class="choices">${q.choices
        .map((c, i) => `<button type="button" class="choice" data-choice="${i}">${esc(c.label)}</button>`)
        .join("")}</div>`;
    } else {
      input = `<div class="choices pcs">${Array.from({ length: 12 }, (_, pc) => `<button type="button" class="choice" data-pc="${pc}">${esc(noteLabel(pc, style))}</button>`).join("")}</div>
        <p class="hint">${midi.input ? "Ton clavier est actif : joue la note." : "Clique la note, ou connecte ton clavier MIDI (panneau 4) pour la jouer."}</p>`;
    }
    $("#quiz-box").innerHTML = `
      <p class="q-progress">Question ${quiz.n}/${QUIZ_LENGTH} · ${quiz.score} bonne${quiz.score > 1 ? "s" : ""} réponse${quiz.score > 1 ? "s" : ""}</p>
      <p class="q-prompt">${esc(q.prompt)}</p>
      ${q.staff ? `<div class="staff-wrap">${staffSvg(q.staff.notes, q.staff.clef, style, { hideNames: true })}</div>` : ""}
      ${input}
      <div id="quiz-feedback" aria-live="polite"></div>`;
  }

  function answer(given) {
    if (!quiz.active || !quiz.q || quiz.answered) return;
    quiz.answered = true;
    const q = quiz.q;
    const ok = checkAnswer(q, given);
    if (ok) quiz.score++;
    for (const b of document.querySelectorAll("#quiz-box .choice")) {
      const value = b.dataset.pc !== undefined ? Number(b.dataset.pc) : q.choices[Number(b.dataset.choice)].value;
      const isAnswer = q.input === "pc" ? value === q.answer : value === q.answer;
      const isGiven = q.input === "pc" ? value === ((given % 12) + 12) % 12 : value === given;
      b.classList.toggle("ok", isAnswer);
      b.classList.toggle("bad", isGiven && !isAnswer);
      b.disabled = true;
    }
    const last = quiz.n >= QUIZ_LENGTH;
    $("#quiz-feedback").innerHTML = `
      <p class="${ok ? "fb-ok" : "fb-bad"}">${ok ? "✔ Bonne réponse." : "✖ Raté."} ${esc(q.explain)}</p>
      <button type="button" id="quiz-next">${last ? "Voir le résultat" : "Question suivante →"}</button>`;
  }

  function finishQuiz() {
    quiz.active = false;
    const prev = best();
    const record = quiz.score > prev;
    if (record) {
      try {
        localStorage.setItem(BEST_KEY, String(quiz.score));
      } catch {
        /* pas grave */
      }
    }
    $("#quiz-box").innerHTML = `
      <p class="score-big">${quiz.score}/${QUIZ_LENGTH}</p>
      <p>${quiz.score >= 9 ? "Excellent." : quiz.score >= 7 ? "Bien joué." : quiz.score >= 5 ? "Pas mal, ça vient." : "Continue : la transposition, ça s'apprend à force."}
        ${record ? "Nouveau record !" : `Ton record : ${Math.max(prev, quiz.score)}/${QUIZ_LENGTH}.`}</p>
      <button type="button" id="quiz-again">Rejouer</button>`;
  }

  $("#quiz-start").addEventListener("click", startQuiz);
  $("#quiz-box").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.id === "quiz-next") nextQuestion();
    else if (b.id === "quiz-again") startQuiz();
    else if (b.dataset.pc !== undefined) answer(Number(b.dataset.pc));
    else if (b.dataset.choice !== undefined) answer(quiz.q.choices[Number(b.dataset.choice)].value);
  });

  /* --------------------------------------------------- test d'impro (MIDI) */

  function showImprovResult(result) {
    const style = ctx.names();
    if (!result.total) {
      $("#improv-box").innerHTML = `<p class="fb-bad">Aucune note reçue pendant la grille. Vérifie que ton clavier est bien sélectionné (panneau 4), puis recommence.</p>`;
      return;
    }
    const verdict =
      result.scorePct >= 85
        ? "Très propre : tu restes dans l'harmonie."
        : result.scorePct >= 65
          ? "Bien : quelques notes à surveiller."
          : "À retravailler : essaie de ne jouer que les notes d'accord sur les temps, et la gamme entre les deux.";
    const outs = result.outList
      .slice(0, 8)
      .map((o) => `mesure ${o.bar} (${esc(noteName(noteFromMidi(o.midi), style))})`)
      .join(", ");
    $("#improv-box").innerHTML = `
      <p class="score-big">${result.scorePct}%</p>
      <p>${verdict}</p>
      <ul class="stats">
        <li><strong>${result.total}</strong> notes jouées</li>
        <li><strong>${result.inScalePct}%</strong> dans l'accord ou la gamme</li>
        <li><strong>${result.strongChordPct}%</strong> des notes posées sur un temps tombent sur une note d'accord</li>
        <li><strong>${result.out}</strong> note${result.out > 1 ? "s" : ""} hors gamme${outs ? " : " + outs : ""}</li>
      </ul>
      <p class="hint">Barème : note d'accord = 1 point, note de gamme = 0,7, hors gamme = 0. Les « fausses notes » peuvent être voulues : c'est un outil, pas un juge.</p>`;
  }

  $("#improv-start").addEventListener("click", () => {
    if (ctx.playing()) {
      ctx.playGrid(); // arrête
      return;
    }
    if (!midi.input) {
      $("#improv-box").innerHTML = `<p class="fb-bad">Connecte d'abord ton clavier MIDI (panneau 4).</p>`;
      return;
    }
    recorded = [];
    recording = true;
    $("#improv-box").innerHTML = `<p>Décompte d'une mesure, puis joue sur la grille. Un seul tour, sans boucle.</p>`;
    ctx.playGrid({
      loop: false,
      countIn: 4,
      onEnd: () => {
        if (!recording) return;
        recording = false;
        showImprovResult(scoreImprov(recorded, ctx.beatInfo()));
      },
    });
  });
}
