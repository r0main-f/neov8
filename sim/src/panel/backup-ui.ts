// "Backup / restore" section: saves a Voyetra Eight's 100 programs and 100 steps to a .syx file over MIDI, and
// loads them back (sim/src/backup.ts). Target: a real instrument through Web MIDI, or the simulator's back end.
import { backup, restore, dumpsIn, webMidiTransport, type Transport, type Progress } from '../backup';
import type { Backend } from '../types';

type Tap = ((bytes: number[]) => void) | null;

export class BackupUi {
  private access: MIDIAccess | null = null;
  private busy = false;
  private el = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;

  /**
   * @param getBackend the simulator's current back end
   * @param setTap while a backup targets the simulator, the main loop hands it the instrument's MIDI output
   */
  constructor(private root: HTMLElement, private getBackend: () => Backend, private setTap: (t: Tap) => void) {
    this.el('#bk-connect').addEventListener('click', () => void this.connect());
    this.el('#bk-backup').addEventListener('click', () => void this.runBackup());
    this.el('#bk-restore').addEventListener('click', () => this.el<HTMLInputElement>('#bk-file').click());
    this.el<HTMLInputElement>('#bk-file').addEventListener('change', () => void this.runRestore());
  }

  private status(s: string, kind: 'info' | 'ok' | 'err' = 'info') {
    const st = this.el('#bk-status');
    st.textContent = s;
    st.className = `bk-status ${kind}`;
  }
  private progress(p: Progress) {
    const bar = this.el<HTMLProgressElement>('#bk-progress');
    bar.hidden = false;
    bar.max = p.total;
    bar.value = p.done;
    this.status(`${p.what}: ${p.done} / ${p.total}`);
  }

  private async connect() {
    const nav = navigator as Navigator & { requestMIDIAccess?: (o?: { sysex: boolean }) => Promise<MIDIAccess> };
    if (!nav.requestMIDIAccess) return this.status('Web MIDI is not available in this browser: use Chrome or Edge.', 'err');
    try {
      this.access = await nav.requestMIDIAccess({ sysex: true });
    } catch (e) {
      return this.status(`MIDI access refused (${(e as Error).message}). Allow MIDI and SysEx for this page.`, 'err');
    }
    const fill = (sel: HTMLSelectElement, ports: MIDIInputMap | MIDIOutputMap) => {
      sel.innerHTML = '';
      ports.forEach((p) => sel.add(new Option(p.name ?? p.id, p.id)));
    };
    fill(this.el('#bk-in'), this.access.inputs);
    fill(this.el('#bk-out'), this.access.outputs);
    const target = this.el<HTMLSelectElement>('#bk-target');
    target.value = 'midi';
    this.status(this.access.inputs.size && this.access.outputs.size
      ? 'MIDI ready: pick the ports the Voyetra is connected to (both cables: its MIDI OUT to your interface IN, and back).'
      : 'No MIDI ports found: connect the interface and click Connect again.', this.access.inputs.size ? 'info' : 'err');
  }

  /** Transport for the chosen target. */
  private transport(): (Transport & { close(): void }) | null {
    if (this.el<HTMLSelectElement>('#bk-target').value === 'sim') {
      const b = this.getBackend();
      const buf: number[] = [];
      this.setTap((bytes) => buf.push(...bytes));
      return {
        send: (bytes) => b.midiIn(bytes),
        poll: (ms) => new Promise((r) => setTimeout(() => r(buf.splice(0)), ms)),
        close: () => this.setTap(null),
      };
    }
    if (!this.access) { this.status('Click "Connect MIDI" first.', 'err'); return null; }
    const inp = this.access.inputs.get(this.el<HTMLSelectElement>('#bk-in').value);
    const out = this.access.outputs.get(this.el<HTMLSelectElement>('#bk-out').value);
    if (!inp || !out) { this.status('Pick a MIDI input and output.', 'err'); return null; }
    return webMidiTransport(inp, out);
  }

  private async runBackup() {
    if (this.busy) return;
    const t = this.transport();
    if (!t) return;
    this.busy = true;
    this.el<HTMLAnchorElement>('#bk-save').hidden = true;
    try {
      const steps = this.el<HTMLInputElement>('#bk-steps').checked;
      const res = await backup(t, { steps, onProgress: (p) => this.progress(p) });
      const file = new Uint8Array(res.messages.flat());
      const a = this.el<HTMLAnchorElement>('#bk-save');
      a.href = URL.createObjectURL(new Blob([file], { type: 'application/octet-stream' }));
      a.download = `voyetra8-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.syx`;
      a.hidden = false;
      a.click();
      const miss = res.missing.length ? ` Missing (no answer): ${res.missing.join(', ')}.` : '';
      this.status(`Backup done: ${res.programs} programs${steps ? `, ${res.steps} steps` : ''} (${file.length} bytes). Keep the .syx file safe.${miss}`, res.missing.length ? 'err' : 'ok');
    } catch (e) {
      this.status((e as Error).message, 'err');
    } finally {
      t.close();
      this.busy = false;
    }
  }

  private async runRestore() {
    const fileIn = this.el<HTMLInputElement>('#bk-file');
    const f = fileIn.files?.[0];
    fileIn.value = '';
    if (!f || this.busy) return;
    const bytes = Array.from(new Uint8Array(await f.arrayBuffer()));
    const n = dumpsIn(bytes);
    const progs = n.filter((m) => (m[2] & 0x3f) === 1).length, steps = n.length - progs;
    if (!n.length) return this.status(`${f.name}: no program or step dump in this file.`, 'err');
    if (!confirm(`Write ${progs} programs and ${steps} steps from ${f.name} into the instrument? This replaces what is stored there.`)) return;
    const t = this.transport();
    if (!t) return;
    this.busy = true;
    try {
      const r = await restore(t, bytes, { onProgress: (p) => this.progress(p) });
      if (r.mismatched.length) this.status(`Restore incomplete: ${r.verified} of ${r.sent} verified. Not stored: ${r.mismatched.join(', ')}. Try again for those.`, 'err');
      else this.status(`Restore done: ${r.verified} programs/steps written and read back identical.`, 'ok');
    } catch (e) {
      this.status((e as Error).message, 'err');
    } finally {
      t.close();
      this.busy = false;
    }
  }
}
