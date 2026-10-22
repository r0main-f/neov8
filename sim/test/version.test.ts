// The version shown by the boot screen is the same in the firmware, the prototype and package.json.
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FW_VERSION } from '../src/proto/proto';
import { ROOT } from './helpers';

it('firmware, prototype and package agree on the version', () => {
  const api = readFileSync(join(ROOT, 'firmware/src/api.inc'), 'utf8');
  const maj = /^FW_VERSION_MAJ = (\d+)/m.exec(api)![1], min = /^FW_VERSION_MIN = (\d+)/m.exec(api)![1];
  expect(FW_VERSION).toBe(`${maj}.${min}`);
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version as string;
  expect(pkg.startsWith(`${maj}.${min}.`)).toBe(true);
});
