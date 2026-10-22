// Backup / restore of a Voyetra Eight's memory over MIDI with the legacy Octave-Plateau SysEx (works with the
// stock Rev4 ROM and with NeoV8). Needs SysEx enabled on the instrument: Rev4 "MX" (MIDI MISC, Alternate page),
// NeoV8 menu 16 "rS". The transport is Web MIDI in the browser, or an emulated machine in the tests.
//
// Backup: request program nn (F0 03 06 nn F7) and step ss (F0 03 07 ss F7) one at a time, keep each answer
// (F0 03 01 00 nn <90 nibbles> F7, F0 03 02 00 ss <60 nibbles> F7) as it came: the .syx file is the answers in
// order. Restore: send each message back with the controller flag set (cmd | $40, which the instrument requires
// to store data) and wait for its load acknowledge F0 03 0C nn F7; no acknowledge = memory protect on (or no link).

export interface Transport {
  send(bytes: number[]): void;
  /** wait up to `ms`, return the bytes received meanwhile (complete messages or not) */
  poll(ms: number): Promise<number[]>;
}

export interface Progress { done: number; total: number; what: string }
export type OnProgress = (p: Progress) => void;

export const NUM = 100;
const PROG_LEN = 96; // F0 03 01 00 nn + 90 nibbles + F7
const STEP_LEN = 66; // F0 03 02 00 ss + 60 nibbles + F7

/** Collects bytes into SysEx messages (F0 .. F7); everything else is ignored. */
export class SysexReader {
  private cur: number[] | null = null;
  readonly msgs: number[][] = [];
  push(bytes: number[]) {
    for (const b of bytes) {
      if (b === 0xf0) { this.cur = [b]; continue; }
      if (this.cur === null) continue;
      if (b >= 0xf8) continue; // real-time bytes may be interleaved
      if (b & 0x80 && b !== 0xf7) { this.cur = null; continue; } // a status byte aborts the message
      this.cur.push(b);
      if (b === 0xf7) { this.msgs.push(this.cur); this.cur = null; }
    }
  }
  take(): number[][] { return this.msgs.splice(0); }
}

const isAnswer = (m: number[], cmd: number, n: number, len: number) =>
  m.length === len && m[1] === 0x03 && (m[2] & 0x3f) === cmd && m[3] === 0 && m[4] === n;

async function ask(t: Transport, rd: SysexReader, req: number[], ok: (m: number[]) => boolean, timeoutMs: number) {
  for (let attempt = 0; attempt < 2; attempt++) {
    t.send(req);
    for (let waited = 0; waited < timeoutMs; waited += 20) {
      rd.push(await t.poll(20));
      const hit = rd.take().find(ok);
      if (hit) return hit;
    }
  }
  return null;
}

export interface BackupResult { messages: number[][]; programs: number; steps: number; missing: string[] }

/** Requests the 100 programs, then (if `steps`) the 100 steps. Throws when the very first request gets no answer. */
export async function backup(t: Transport, opts: { steps?: boolean; timeoutMs?: number; onProgress?: OnProgress } = {}): Promise<BackupResult> {
  const rd = new SysexReader();
  const timeout = opts.timeoutMs ?? 400;
  const res: BackupResult = { messages: [], programs: 0, steps: 0, missing: [] };
  const kinds: [number, number, string][] = [[1, PROG_LEN, 'program']];
  if (opts.steps !== false) kinds.push([2, STEP_LEN, 'step']);
  const total = NUM * kinds.length;
  let done = 0;
  for (const [cmd, len, what] of kinds) {
    for (let n = 0; n < NUM; n++) {
      const m = await ask(t, rd, [0xf0, 0x03, cmd + 5, n, 0xf7], (x) => isAnswer(x, cmd, n, len), timeout);
      if (!m) {
        if (done === 0) throw new Error('no answer from the instrument: check both MIDI cables, and turn SysEx on (Rev4: MX on the Alternate page; NeoV8: menu 16 rS)');
        res.missing.push(`${what} ${String(n).padStart(2, '0')}`);
      } else {
        res.messages.push(m);
        if (cmd === 1) res.programs++; else res.steps++;
      }
      opts.onProgress?.({ done: ++done, total, what: `${what} ${String(n).padStart(2, '0')}` });
    }
  }
  return res;
}

/** Program (cmd 1) and step (cmd 2) dumps found in a .syx file, in file order. */
export function dumpsIn(bytes: number[]): number[][] {
  const rd = new SysexReader();
  rd.push(bytes);
  return rd.take().filter((m) => m[1] === 0x03 && m[3] === 0 && m[4] < NUM &&
    (((m[2] & 0x3f) === 1 && m.length === PROG_LEN) || ((m[2] & 0x3f) === 2 && m.length === STEP_LEN)));
}

export interface RestoreResult { sent: number; acknowledged: number; verified: number; mismatched: string[] }

const label = (cmd: number, n: number) => `${cmd === 1 ? 'program' : 'step'} ${String(n).padStart(2, '0')}`;
/** the stored bytes a dump carries (program: 40, step: 24; the stock pads the rest on transmit) */
const payload = (m: number[]) => m.slice(5, 5 + 2 * ((m[2] & 0x3f) === 1 ? 40 : 24));

/**
 * Sends every program / step dump of `bytes` with the controller flag, one at a time: wait for its load
 * acknowledge, then `gapMs` more (the stock ROM acknowledges before it has finished storing: a message sent
 * right after the acknowledge overflows its 127-byte receive ring and lands at the wrong place). Then reads
 * everything back and compares (`verify`): the stock also acknowledges under memory protect.
 */
export async function restore(t: Transport, bytes: number[], opts: { timeoutMs?: number; gapMs?: number; verify?: boolean; onProgress?: OnProgress } = {}): Promise<RestoreResult> {
  const msgs = dumpsIn(bytes);
  if (!msgs.length) throw new Error('no program or step dump in this file');
  const rd = new SysexReader();
  const timeout = opts.timeoutMs ?? 800;
  const verify = opts.verify !== false;
  const total = msgs.length * (verify ? 2 : 1);
  const res: RestoreResult = { sent: 0, acknowledged: 0, verified: 0, mismatched: [] };
  let done = 0;
  for (const m of msgs) {
    const cmd = m[2] & 0x3f, n = m[4];
    const out = m.slice();
    out[2] = cmd | 0x40; // from a controller: the instrument stores it
    t.send(out); // once: a second copy could arrive while the first is being stored
    let ack = false;
    for (let w = 0; w < timeout && !ack; w += 20) {
      rd.push(await t.poll(20));
      ack = rd.take().some((x) => x.length === 5 && x[1] === 0x03 && (x[2] & 0x3f) === 0x0c && x[3] === n);
    }
    rd.push(await t.poll(opts.gapMs ?? 100));
    rd.take();
    res.sent++;
    if (ack) res.acknowledged++;
    else if (res.acknowledged === 0 && res.sent === 3)
      throw new Error('the instrument does not acknowledge: check both MIDI cables, that SysEx is on, and turn memory protect off');
    opts.onProgress?.({ done: ++done, total, what: `sending ${label(cmd, n)}` });
  }
  if (!verify) return res;
  for (const m of msgs) {
    const cmd = m[2] & 0x3f, n = m[4];
    const back = await ask(t, rd, [0xf0, 0x03, cmd + 5, n, 0xf7], (x) => isAnswer(x, cmd, n, cmd === 1 ? PROG_LEN : STEP_LEN), 400);
    const same = !!back && payload(back).every((v, i) => v === payload(m)[i]);
    if (same) res.verified++;
    else res.mismatched.push(label(cmd, n));
    opts.onProgress?.({ done: ++done, total, what: `checking ${label(cmd, n)}` });
  }
  if (res.verified === 0) throw new Error('nothing was stored (the instrument kept its old data): turn memory protect off and try again');
  return res;
}

/** Transport over Web MIDI ports. */
export function webMidiTransport(input: MIDIInput, output: MIDIOutput): Transport & { close(): void } {
  const buf: number[] = [];
  const prev = input.onmidimessage;
  input.onmidimessage = (e) => { buf.push(...Array.from(e.data ?? [])); };
  return {
    send: (b) => output.send(b),
    poll: (ms) => new Promise((r) => setTimeout(() => r(buf.splice(0)), ms)),
    close: () => { input.onmidimessage = prev; },
  };
}
