// Side panel: what the prototype is doing (state, voices, edit buffer vs stored, event log).
import { PAGES, PARAMS } from '../gen/params';
import { describe, getRaw } from '../proto/patch';
import type { NeoV8Proto } from '../proto/proto';
import type { VoiceView } from '../types';

const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteStr = (n: number) => `${NOTE[n % 12]}${Math.floor(n / 12) - 1}`;
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

export class Inspector {
  private status: HTMLElement;
  private voices: HTMLElement;
  private params: HTMLElement;
  private log: HTMLElement;

  constructor(host: HTMLElement) {
    host.innerHTML = `
      <section><h3>State</h3><div class="status"></div></section>
      <section><h3>Voices</h3><div class="voices"></div></section>
      <section><h3>Edit buffer <span class="hint">(changed vs stored in orange)</span></h3><div class="params"></div></section>
      <section><h3>Events</h3><pre class="log"></pre></section>`;
    this.status = host.querySelector('.status')!;
    this.voices = host.querySelector('.voices')!;
    this.params = host.querySelector('.params')!;
    this.log = host.querySelector('.log')!;
  }

  /** Generic view for the Machine back end (CPU state, raw display RAM). */
  updateRaw(s: Record<string, unknown>) {
    this.status.innerHTML = Object.entries(s)
      .filter(([k]) => k !== 'mode' && k !== 'page')
      .map(([k, v]) => `<div><b>${esc(k)}</b><span>${esc(String(v))}</span></div>`)
      .join('');
    this.voices.innerHTML = '';
    this.params.innerHTML = '<div class="ptitle">Running the stock Rev4 ROM in the emulated 6502.</div>';
    this.log.textContent = '';
  }

  update(p: NeoV8Proto) {
    const s = p.inspect() as Record<string, any>;
    const row = (k: string, v: unknown) => `<div><b>${k}</b><span>${esc(String(v))}</span></div>`;
    const where =
      s.mode === 'edit' ? `EDIT ${s.editSide} · page ${s.page}` : s.mode === 'menu' ? `SYSTEM menu · item ${s.menuItem}` : s.mode.toUpperCase();
    this.status.innerHTML = [
      row('Mode', where),
      row('Focus', s.focus === 'S' ? 'Step' : s.focus),
      row('Program L', `${String(s.progL).padStart(2, '0')}${s.editedL ? ' (edited)' : ''}`),
      row('Program R', `${String(s.progR).padStart(2, '0')}${s.editedR ? ' (edited)' : ''}`),
      row('Step', String(s.step).padStart(2, '0')),
      row('Kbd mode', `${s.perf.kbMode}${s.perf.kbMode === 'split' ? ` @ ${noteStr(s.perf.split)}` : ''}`),
      row('Compare', s.compare ?? '—'),
      row('Undo slot', s.undo === null ? '—' : `program ${s.undo}`),
      row('Pot mode', s.globals.potMode),
      row('Protect', s.protect ? 'ON' : 'off'),
    ].join('');
    this.voices.innerHTML = (s.voices as VoiceView[])
      .map((v, i) => `<div class="voice ${v.gate ? 'gate' : ''} ${v.disabled ? 'off' : ''} side${v.side ?? ''}"><i>${i}</i>${v.disabled ? 'off' : v.note === null ? '·' : noteStr(v.note)}<small>${v.side ?? ''}</small></div>`)
      .join('');

    const side = (s.editSide ?? (s.focus === 'L' ? 'L' : 'R')) as 'L' | 'R';
    const pageId = s.page ?? 'P1';
    const pg = PAGES.find((x) => x.id === pageId)!;
    const ids = new Set<string>();
    for (const b of Object.values(pg.buttons)) { if (b?.param) ids.add(b.param); if (b?.field) ids.add(b.field.param); }
    for (const b of Object.values(pg.pots)) if (b) ids.add(b.param);
    for (const t of Object.values(pg.keypad?.targets ?? {})) ids.add(t);
    const edit = p.edit[side];
    const stored = p.programs[side === 'L' ? p.perf.progL : p.perf.progR];
    const rows = PARAMS.filter((x) => ids.has(x.id)).map((x) => {
      const a = describe(edit, x.id);
      const b = describe(stored, x.id);
      const diff = getRaw(edit, x.id) !== getRaw(stored, x.id);
      return `<tr class="${diff ? 'diff' : ''}"><td>${esc(x.name)}</td><td class="mn">${x.mn}</td><td>${esc(a)}</td><td class="st">${diff ? esc(b) : ''}</td></tr>`;
    });
    this.params.innerHTML = `<div class="ptitle">${side} side · ${esc(pg.title)}</div><table><tr><th>Parameter</th><th>Mn</th><th>Now</th><th>Stored</th></tr>${rows.join('')}</table>`;
    this.log.textContent = (s.log as string[]).slice(-14).reverse().join('\n');
  }
}
