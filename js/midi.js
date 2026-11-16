/**
 * Clavier MIDI via l'API Web MIDI (Chrome, Edge, Opera ; Firefox avec
 * autorisation ; pas Safari). Le navigateur demande la permission.
 * Aucune donnée ne quitte la page.
 */
export class MidiIn {
  constructor() {
    this.access = null;
    this.input = null;
    /** @type {(e: {type: "on"|"off", midi: number, vel?: number}) => void} */
    this.onNote = null;
    /** @type {(devices: {id: string, name: string}[], selectedId: string|null) => void} */
    this.onDevices = null;
  }

  get supported() {
    return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
  }

  devices() {
    return this.access ? [...this.access.inputs.values()].map((i) => ({ id: i.id, name: i.name || "Clavier MIDI" })) : [];
  }

  async connect() {
    if (!this.supported) throw new Error("unsupported");
    this.access = await navigator.requestMIDIAccess();
    this.access.onstatechange = () => this.#refresh();
    this.#refresh();
    return this.devices();
  }

  #refresh() {
    const list = this.devices();
    if (!this.input || !list.some((d) => d.id === this.input.id)) this.select(list[0]?.id ?? null);
    this.onDevices?.(list, this.input?.id ?? null);
  }

  select(id) {
    if (this.input) this.input.onmidimessage = null;
    this.input = id ? this.access.inputs.get(id) ?? null : null;
    if (!this.input) return;
    this.input.onmidimessage = (e) => {
      const [status, note, vel] = e.data;
      const cmd = status & 0xf0;
      if (cmd === 0x90 && vel > 0) this.onNote?.({ type: "on", midi: note, vel });
      else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) this.onNote?.({ type: "off", midi: note });
    };
  }
}
