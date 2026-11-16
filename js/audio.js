/**
 * Moteur audio minimal (Web Audio, aucune dépendance).
 *
 * On lui donne une liste d'événements exprimés en TEMPS (pas en secondes) :
 *   { t, dur, midi, kind: "pad" | "bass" | "lead" | "click" | "ride" | "hat" | "kick", accent? }
 * et un tempo. Il programme tout à l'avance, boucle si demandé, et
 * expose le temps courant (en temps) pour surligner la mesure et
 * situer les notes jouées au clavier.
 */

const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);

const VOICES = {
  pad: { type: "triangle", gain: 0.05, attack: 0.02, release: 0.25 },
  bass: { type: "triangle", gain: 0.3, attack: 0.01, release: 0.12 },
  lead: { type: "sine", gain: 0.22, attack: 0.01, release: 0.08 },
  live: { type: "triangle", gain: 0.2, attack: 0.008, release: 0.15 },
};

export class Engine {
  constructor() {
    this.ctx = null;
    this.run = null;
    this.noise = null;
    this.liveVoices = new Map();
  }

  get playing() {
    return this.run !== null;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  #noiseBuffer() {
    if (!this.noise) {
      const ctx = this.ctx;
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buf;
    }
    return this.noise;
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

  /** Percussions : bruit filtré (ride, charleston) ou sinus grave (grosse caisse). */
  #perc(out, t, kind, accent) {
    const ctx = this.ctx;
    if (kind === "kick") {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.setValueAtTime(110, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(0.14, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + 0.2);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.#noiseBuffer();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = kind === "ride" ? 5500 : 7500;
    const g = ctx.createGain();
    const len = kind === "ride" ? 0.28 : 0.07;
    const vol = (kind === "ride" ? 0.07 : 0.09) * (accent ? 1.4 : 1);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(hp).connect(g).connect(out);
    src.start(t);
    src.stop(t + len + 0.05);
  }

  #schedule(run, iteration) {
    const spb = 60 / run.tempo;
    const base = run.t0 + iteration * run.totalBeats * spb;
    for (const e of run.events) {
      const t = base + e.t * spb;
      if (e.kind === "click") this.#click(run.out, t, e.accent);
      else if (e.kind === "ride" || e.kind === "hat" || e.kind === "kick") this.#perc(run.out, t, e.kind, e.accent);
      else this.#note(run.out, t, e.dur * spb, e.midi, e.kind);
    }
  }

  /**
   * @param {{events: object[], totalBeats: number, tempo: number, loop?: boolean,
   *          countIn?: number, onBeat?: (beat:number)=>void, onEnd?: ()=>void}} opts
   * `countIn` : nombre de temps de métronome avant le début (la grille n'est
   * pas jouée pendant ce temps ; `beatNow()` est négatif).
   */
  play({ events, totalBeats, tempo, loop = false, countIn = 0, onBeat, onEnd }) {
    this.stop();
    const ctx = this.ensure();
    const out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(ctx.destination);
    const spb = 60 / tempo;
    const t0 = ctx.currentTime + 0.12 + countIn * spb;
    const run = { events, totalBeats, tempo, loop, out, t0, scheduled: 0, onBeat, onEnd, lastBeat: -1 - countIn, countIn };
    this.run = run;
    for (let b = 0; b < countIn; b++) this.#click(out, t0 - (countIn - b) * spb, b === 0);
    this.#schedule(run, 0);
    run.scheduled = 1;

    const tick = () => {
      if (this.run !== run) {
        clearInterval(run.timer);
        return;
      }
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
      if (beatAbs !== run.lastBeat) {
        run.lastBeat = beatAbs;
        if (beatAbs >= 0) run.onBeat?.(beatAbs % run.totalBeats);
      }
    };
    // setInterval plutôt que requestAnimationFrame : continue en onglet d'arrière-plan
    run.timer = setInterval(tick, 30);
  }

  /** Position courante en temps (fractionnaire, négative pendant le décompte), ou null. */
  beatNow() {
    const run = this.run;
    if (!run) return null;
    const b = ((this.ctx.currentTime - run.t0) * run.tempo) / 60;
    return run.loop && b >= 0 ? b % run.totalBeats : b;
  }

  stop(ended = false) {
    const run = this.run;
    if (!run) return;
    this.run = null;
    clearInterval(run.timer);
    const t = this.ctx.currentTime;
    run.out.gain.cancelScheduledValues(t);
    run.out.gain.setValueAtTime(run.out.gain.value, t);
    run.out.gain.linearRampToValueAtTime(0, t + 0.05);
    setTimeout(() => run.out.disconnect(), 120);
    run.onEnd?.(ended);
  }

  /* ---- notes jouées en direct (clavier MIDI) ---- */

  liveOn(midi, velocity = 100) {
    const ctx = this.ensure();
    this.liveOff(midi);
    const v = VOICES.live;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = v.type;
    osc.frequency.value = freq(midi);
    const peak = v.gain * (0.4 + (velocity / 127) * 0.8);
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(peak, ctx.currentTime + v.attack);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    this.liveVoices.set(midi, { osc, g });
  }

  liveOff(midi) {
    const voice = this.liveVoices.get(midi);
    if (!voice) return;
    this.liveVoices.delete(midi);
    const t = this.ctx.currentTime;
    voice.g.gain.cancelScheduledValues(t);
    voice.g.gain.setValueAtTime(voice.g.gain.value, t);
    voice.g.gain.linearRampToValueAtTime(0, t + VOICES.live.release);
    voice.osc.stop(t + VOICES.live.release + 0.02);
  }
}
