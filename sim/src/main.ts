// NeoV8 simulator entry point: one panel, interchangeable back ends.
import './style.css';
import { NeoV8Proto } from './proto/proto';
import { MachineBackend } from './machine/backend';
import { Panel } from './panel/panel';
import { Keyboard } from './panel/keyboard';
import { Inspector } from './panel/inspector';
import { BackupUi } from './panel/backup-ui';
import { overlayFor } from './panel/overlays';
import { defaultGlobals, type Globals, type Perf } from './proto/state';
import type { Backend, ButtonId } from './types';

const STORE_KEY = 'neov8-proto-v1';
const BRAM_KEY = 'neov8-machine-bram-v1';

function loadSaved(p: NeoV8Proto) {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as { programs: number[][]; steps: Perf[]; globals: Globals };
    if (s.programs?.length === 100) p.programs = s.programs.map((x) => Uint8Array.from(x).slice(0, 40));
    if (s.steps?.length === 100) p.steps = s.steps;
    if (s.globals) p.globals = { ...defaultGlobals(), ...s.globals };
    p.recallStep(0);
  } catch { /* storage unavailable: start fresh */ }
}
function saveProto(p: NeoV8Proto) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ programs: p.programs.map((x) => Array.from(x)), steps: p.steps, globals: p.globals }));
  } catch { /* ignore */ }
}
function saveBram(m: MachineBackend) {
  try { localStorage.setItem(BRAM_KEY, JSON.stringify(Array.from(m.machine.bram))); } catch { /* ignore */ }
}
function loadBram(): Uint8Array | undefined {
  try {
    const raw = localStorage.getItem(BRAM_KEY);
    return raw ? Uint8Array.from(JSON.parse(raw) as number[]) : undefined;
  } catch { return undefined; }
}

const proto = new NeoV8Proto();
loadSaved(proto);
let backend: Backend = proto;

const panel = new Panel(document.getElementById('panel')!, proto);
const kb = new Keyboard(document.getElementById('keyboard')!, proto, panel);
const inspectorHost = document.getElementById('inspector')!;
const inspector = new Inspector(inspectorHost);
const statusEl = document.getElementById('status')!;
const setStatus = (s: string) => (statusEl.textContent = s);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const overlaySel = $<HTMLSelectElement>('overlay');
const backendSel = $<HTMLSelectElement>('backend');
const protectChk = $<HTMLInputElement>('protect');

async function switchBackend(kind: string) {
  if (kind === 'proto') {
    backend = proto;
    setStatus('NeoV8 prototype: the new navigation, implemented in TypeScript.');
  } else {
    const file = kind === 'machine' ? 'rev4.bin' : 'neov8.bin';
    const res = await fetch(`/roms/${file}`);
    if (!res.ok) {
      setStatus(`cannot load ${file}: run "npm run roms" (stock) or build the firmware`);
      backendSel.value = 'proto';
      return;
    }
    const rom = new Uint8Array(await res.arrayBuffer());
    backend = new MachineBackend(kind === 'machine' ? 'Stock Rev4 ROM' : 'NeoV8 ROM', rom, loadBram());
    overlaySel.value = 'rev4';
    setStatus(`${backend.name}: real 6502 code running at 2 MHz (display, LEDs, buttons, pots, keyboard decoded from the ROM).`);
  }
  backend.setProtect(protectChk.checked);
  panel.setBackend(backend);
  kb.setBackend(backend);
}
backendSel.addEventListener('change', () => void switchBackend(backendSel.value));

protectChk.addEventListener('change', () => backend.setProtect(protectChk.checked));
$('midi').addEventListener('click', () => kb.connectMidi(setStatus));
$('reset').addEventListener('click', () => {
  if (!confirm('Erase the simulator memory (programs, steps, settings, machine battery RAM) and restart?')) return;
  localStorage.removeItem(STORE_KEY);
  localStorage.removeItem(BRAM_KEY);
  location.reload();
});
$<HTMLInputElement>('velocity').addEventListener('input', (e) => (kb.velocity = Number((e.target as HTMLInputElement).value)));
const fileIn = $<HTMLInputElement>('syxfile');
$('import').addEventListener('click', () => fileIn.click());
fileIn.addEventListener('change', async () => {
  const f = fileIn.files?.[0];
  if (!f) return;
  const bytes = Array.from(new Uint8Array(await f.arrayBuffer()));
  // dump files usually lack the "controller" flag; set it so programs load (as a computer would send them)
  for (let i = 0; i + 2 < bytes.length; i++) if (bytes[i] === 0xf0 && bytes[i + 1] === 0x03) bytes[i + 2] |= 0x40;
  backend.midiIn(bytes);
  setStatus(`sent ${f.name} (${bytes.length} bytes) to MIDI IN`);
  fileIn.value = '';
});

// footswitches (emulated machine): press = closed, release = open
document.querySelectorAll<HTMLButtonElement>('#footsw button').forEach((btn) => {
  const n = Number(btn.dataset.fs);
  const set = (closed: boolean) => {
    btn.classList.toggle('down', closed);
    if (backend instanceof MachineBackend) backend.footswitch(n, closed);
  };
  btn.addEventListener('mousedown', () => set(true));
  btn.addEventListener('mouseup', () => set(false));
  btn.addEventListener('mouseleave', () => btn.classList.contains('down') && set(false));
});

// Backup / restore section (Web MIDI or this simulator); while it talks to the simulator it gets the MIDI output
let backupTap: ((bytes: number[]) => void) | null = null;
new BackupUi($('backup'), () => backend, (t) => (backupTap = t));

// SysEx coming out of the instrument -> offer a .syx download
let outBuf: number[] = [];
let inSysex = false;
let quietFrames = 0;
function pumpMidiOut() {
  const b = backend.drainMidiOut();
  if (backupTap) { if (b.length) backupTap(b); return; }
  for (const x of b) {
    if (x === 0xf0) inSysex = true;
    if (inSysex) outBuf.push(x);
    if (x === 0xf7) inSysex = false;
  }
  if (b.length) quietFrames = 0;
  else if (outBuf.length && ++quietFrames > 10) {
    const url = URL.createObjectURL(new Blob([new Uint8Array(outBuf)], { type: 'application/octet-stream' }));
    const a = $<HTMLAnchorElement>('download');
    a.href = url;
    a.download = `voyetra8-dump-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.syx`;
    a.hidden = false;
    setStatus(`instrument sent ${outBuf.length} bytes of SysEx — click "Save dump"`);
    outBuf = [];
  }
}

// stock ROM page variable vPage ($060A): 0 Normal, 1 Edit1, 2 Edit2, 3-6 Mod A-D (docs/rev4-ram-map.md)
const STOCK_PAGES: (string | null)[] = [null, 'P1', 'P2', 'A', 'B', 'C', 'D'];

let last = performance.now();
let inspectAt = 0;
let saveAt = 0;
function loop(t: number) {
  const dt = Math.min(100, t - last);
  last = t;
  backend.run(dt);
  pumpMidiOut();
  const neo = overlaySel.value === 'neo';
  let mode = 'play';
  let page: string | null = null;
  if (backend === proto) {
    const st = proto.inspect() as { mode: string; page: string | null };
    mode = st.mode;
    page = st.page;
  } else {
    const p = STOCK_PAGES[(backend as MachineBackend).machine.ram[0x60a]] ?? null;
    if (p) { mode = 'edit'; page = p; }
  }
  const held = new Set<ButtonId>(backend === proto ? [...proto.held] : [...kb.held]);
  panel.render(backend.frame(), overlayFor(mode, page, neo), held);
  if (t > inspectAt) {
    if (backend === proto) inspector.update(proto);
    else inspector.updateRaw(backend.inspect());
    inspectAt = t + 100;
  }
  if (t > saveAt) {
    if (backend === proto) saveProto(proto);
    else if (backend instanceof MachineBackend) saveBram(backend);
    saveAt = t + 2000;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// handy in the browser console
Object.assign(window as unknown as Record<string, unknown>, { proto, panel });
Object.defineProperty(window, 'backend', { get: () => backend }); // live (Object.assign would copy the first value)
