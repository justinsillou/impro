/**
 * Moteur audio minimal (Web Audio, aucune dépendance).
 *
 * On lui donne une liste d'événements exprimés en TEMPS (pas en secondes) :
 *   { t, dur, midi, kind: "pad" | "bass" | "lead" | "click", accent? }
 * et un tempo. Il programme tout à l'avance, boucle si demandé, et
 * expose le temps courant pour surligner la mesure en cours.
 */

const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);

const VOICES = {
  pad: { type: "triangle", gain: 0.05, attack: 0.02, release: 0.25 },
  bass: { type: "triangle", gain: 0.3, attack: 0.01, release: 0.12 },
  lead: { type: "sine", gain: 0.22, attack: 0.01, release: 0.08 },
};

export class Engine {
  constructor() {
    this.ctx = null;
    this.run = null;
  }

  get playing() {
    return this.run !== null;
  }

  #ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  #note(out, t, dur, midi, kind) {
    const ctx = this.ctx;
    const v = VOICES[kind];
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = v.type;
    osc.frequency.value = freq(midi);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v.gain, t + v.attack);
    g.gain.setValueAtTime(v.gain, t + Math.max(v.attack, dur - v.release));
    g.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  #click(out, t, accent) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = accent ? 1500 : 1000;
    g.gain.setValueAtTime(accent ? 0.18 : 0.1, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  #schedule(run, iteration) {
    const spb = 60 / run.tempo;
    const base = run.t0 + iteration * run.totalBeats * spb;
    for (const e of run.events) {
      const t = base + e.t * spb;
      if (e.kind === "click") this.#click(run.out, t, e.accent);
      else this.#note(run.out, t, e.dur * spb, e.midi, e.kind);
    }
  }

  /**
   * @param {{events: object[], totalBeats: number, tempo: number, loop?: boolean,
   *          onBeat?: (beat:number)=>void, onEnd?: ()=>void}} opts
   */
  play({ events, totalBeats, tempo, loop = false, onBeat, onEnd }) {
    this.stop();
    const ctx = this.#ensure();
    const out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(ctx.destination);
    const run = { events, totalBeats, tempo, loop, out, t0: ctx.currentTime + 0.12, scheduled: 0, onBeat, onEnd, lastBeat: -1 };
    this.run = run;
    this.#schedule(run, 0);
    run.scheduled = 1;

    const tick = () => {
      if (this.run !== run) return;
      const spb = 60 / run.tempo;
      const elapsed = ctx.currentTime - run.t0;
      const beatAbs = Math.floor(elapsed / spb);
      // programme l'itération suivante un peu avant la fin de celle-ci
      if (run.loop && elapsed > (run.scheduled - 1) * run.totalBeats * spb + (run.totalBeats * spb) / 2) {
        this.#schedule(run, run.scheduled);
        run.scheduled += 1;
      }
      if (!run.loop && beatAbs >= run.totalBeats) {
        this.stop(true);
        return;
      }
      if (beatAbs >= 0 && beatAbs !== run.lastBeat) {
        run.lastBeat = beatAbs;
        run.onBeat?.(beatAbs % run.totalBeats);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stop(ended = false) {
    const run = this.run;
    if (!run) return;
    this.run = null;
    const t = this.ctx.currentTime;
    run.out.gain.cancelScheduledValues(t);
    run.out.gain.setValueAtTime(run.out.gain.value, t);
    run.out.gain.linearRampToValueAtTime(0, t + 0.05);
    setTimeout(() => run.out.disconnect(), 120);
    run.onEnd?.(ended);
  }
}
