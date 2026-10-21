// Overlay labels: what each control means on the current page (like the printed Rev4 overlays).
import { PAGES, ENUMS } from '../gen/params';
import { PARAM } from '../proto/patch';
import type { ButtonId, PotId } from '../types';
import { BUTTONS_GEO, POTS_GEO } from './layout';

export interface Overlay {
  banner: string;
  buttons: Partial<Record<ButtonId, string>>;
  shift: Partial<Record<ButtonId, string>>; // A440 + button (NeoV8)
  pots: Partial<Record<PotId, string>>;
}

const NORMAL_SHIFT: Partial<Record<ButtonId, string>> = {
  call_l: 'INIT L', call_r: 'INIT R', edit: 'SYSTEM', store: 'COMPARE/UNDO',
  oct_l: 'ARP OCT', oct_r: 'ARP OCT', autotune: 'A440 TONE', arp_down: 'MIDI ▸10',
  arp_random: 'SET ▸40', step_enable: 'ALT ▸50', mute: 'VEL ▸21', arp_right: 'SEQ',
};

export function overlayFor(mode: string, pageId: string | null, neo: boolean): Overlay {
  const buttons: Overlay['buttons'] = {};
  const pots: Overlay['pots'] = {};
  for (const b of BUTTONS_GEO) buttons[b.id] = b.label;
  for (const p of POTS_GEO) pots[p.id] = p.label;

  if (mode === 'edit' && pageId) {
    const pg = PAGES.find((p) => p.id === pageId)!;
    for (const b of BUTTONS_GEO) if (!/^k\d$/.test(b.id)) buttons[b.id] = '';
    for (const p of POTS_GEO) pots[p.id] = '';
    for (const [id, bnd] of Object.entries(pg.buttons)) buttons[id as ButtonId] = bnd!.label;
    for (const [id, bnd] of Object.entries(pg.pots)) pots[id as PotId] = bnd!.label;
    if (pg.keypad) {
      const target = Object.values(pg.keypad.targets)[0];
      const en = ENUMS[PARAM[target].enum ?? ''] ?? [];
      for (const [k, raw] of Object.entries(pg.keypad.keys)) {
        const name = en.find((e) => e.v === raw)?.name ?? String(raw);
        buttons[`k${k}` as ButtonId] = `${k} ${name}`;
      }
    }
    buttons.edit = neo ? 'EXIT' : 'ENTER/EXIT';
    buttons.store = 'STORE';
    buttons.fwd = 'NEXT PAGE';
    buttons.rev = 'PREV PAGE';
    buttons.a440 = neo ? 'SHIFT' : 'A 440';
    if (neo) {
      if (!pg.buttons.call_l) buttons.call_l = 'EDIT L';
      if (!pg.buttons.call_r) buttons.call_r = 'EDIT R';
    }
    const shift: Overlay['shift'] = neo ? { store: 'COMPARE', fwd: 'VALUE +1', rev: 'VALUE -1', edit: 'SYSTEM', call_l: 'INIT L', call_r: 'INIT R' } : {};
    return { banner: `${pg.title}${neo ? '   ·   EDIT+1..6 jumps to a page' : ''}`, buttons, shift, pots };
  }
  if (mode === 'menu') {
    for (const b of BUTTONS_GEO) buttons[b.id] = /^k\d$/.test(b.id) ? b.label : '';
    for (const p of POTS_GEO) pots[p.id] = '';
    Object.assign(buttons, { edit: 'EXIT', fwd: 'NEXT ITEM', rev: 'PREV ITEM', store: 'EXECUTE (99)', a440: 'SHIFT' });
    pots.arp_speed = 'VALUE';
    return { banner: 'SYSTEM menu  ·  2 digits = item  ·  SPEED knob or A440+FWD/REV = value', buttons, shift: { fwd: 'VALUE +1', rev: 'VALUE -1' }, pots };
  }
  if (neo) {
    buttons.tape_load = 'SYSEX RECEIVE';
    buttons.tape_dump = 'SYSEX DUMP';
    buttons.a440 = 'A440 / SHIFT';
    buttons.step_load = 'STORE STEP';
    buttons.step_enable = 'CALL STEP';
  }
  return { banner: neo ? 'NORMAL page  ·  hold A440 = SHIFT (orange legends)' : 'NORMAL page', buttons, shift: neo ? NORMAL_SHIFT : {}, pots };
}
