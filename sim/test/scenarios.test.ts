// Runs every spec/scenarios/*.yaml against a back end. Today: the NeoV8 prototype.
// Phase 3: the same files run against the Machine back end with the NeoV8 ROM.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { NeoV8Proto } from '../src/proto/proto';
import { getRaw } from '../src/proto/patch';
import type { Backend, ButtonId, PotId } from '../src/types';

type Step = Record<string, any>;
interface Scenario { name: string; steps: Step[] }

const dir = join(__dirname, '../../spec/scenarios');
const files = readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort();

const GAP = 30; // ms between button events, like a fast human

function press(b: Backend, ids: ButtonId | ButtonId[]) {
  const list = Array.isArray(ids) ? ids : [ids];
  const holds = list.slice(0, -1);
  const last = list[list.length - 1];
  for (const h of holds) { b.button(h, true); b.run(GAP); }
  b.button(last, true); b.run(GAP);
  b.button(last, false); b.run(GAP);
  for (const h of [...holds].reverse()) { b.button(h, false); b.run(GAP); }
}

function subsetMatch(actual: any, expected: any, path: string) {
  if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
    for (const [k, v] of Object.entries(expected)) subsetMatch(actual?.[k], v, `${path}.${k}`);
  } else {
    expect(actual, path).toEqual(expected);
  }
}

export function runScenario(make: () => Backend & { edit?: any }, sc: Scenario) {
  const b = make();
  b.run(100);
  let midiOut = 0;
  for (const [i, st] of sc.steps.entries()) {
    const where = `step ${i + 1} ${JSON.stringify(st)}`;
    if (st.press) press(b, st.press);
    if (st.down) { b.button(st.down, true); b.run(GAP); }
    if (st.up) { b.button(st.up, false); b.run(GAP); }
    if (st.pot) for (const [id, v] of Object.entries(st.pot)) { b.pot(id as PotId, v as number); b.run(GAP); }
    if (st.key) { b.key(st.key.note, true, st.key.vel ?? 100); b.run(GAP); if (!st.key.hold) { b.key(st.key.note, false, 64); b.run(GAP); } }
    if (st.wait) b.run(st.wait);
    if (st.protect !== undefined) b.setProtect(st.protect);
    midiOut += b.drainMidiOut().length;
    const e = st.expect;
    if (!e) continue;
    const s = b.inspect() as any;
    if (e.display !== undefined) expect(s.display, `${where}: display`).toBe(e.display);
    if (e.dp !== undefined) expect(s.dp, `${where}: dp`).toBe(e.dp);
    if (e.displayBlink !== undefined) expect(s.displayBlink, `${where}: blink`).toBe(e.displayBlink);
    if (e.mode !== undefined) expect(s.mode, `${where}: mode`).toBe(e.mode);
    if (e.page !== undefined) expect(s.page, `${where}: page`).toBe(e.page);
    if (e.leds) for (const [id, v] of Object.entries(e.leds)) expect(s.leds[id] ?? 'off', `${where}: led ${id}`).toBe(v);
    if (e.state) subsetMatch(s, e.state, `${where}: state`);
    if (e.param) {
      const prog = (b as any).edit[e.param.side];
      expect(getRaw(prog, e.param.id), `${where}: param ${e.param.id}`).toBe(e.param.raw);
    }
    if (e.voices) for (const [v, note] of Object.entries(e.voices)) expect(s.voices[Number(v)].note, `${where}: voice ${v}`).toBe(note);
    if (e.midiOut !== undefined) expect(midiOut, `${where}: midi out bytes`).toBe(e.midiOut);
  }
}

for (const f of files) {
  const scenarios: Scenario[] = YAML.parse(readFileSync(join(dir, f), 'utf8'));
  describe(`prototype: ${f}`, () => {
    for (const sc of scenarios) it(sc.name, () => runScenario(() => new NeoV8Proto(), sc));
  });
}
