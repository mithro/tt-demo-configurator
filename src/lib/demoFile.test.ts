// SPDX-License-Identifier: Apache-2.0
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatDemo, parseDemoText, pyRepr, validateDemo } from './demoFile';
import { indexLookup, toProject } from './shuttleIndex';

const FIX = path.resolve(__dirname, '../../test/fixtures');
const SHUTTLE = 'ttsky25a';

// the same lookup the firmware's release check builds from an index (check_demo_sequences.py)
const lookup = indexLookup(JSON.parse(readFileSync(path.join(FIX, 'index.json'), 'utf8')).projects.map(toProject).filter((p: { type?: string }) => p.type !== 'group'));

describe('validateDemo agrees with the firmware', () => {
  for (const name of readdirSync(path.join(FIX, 'good'))) {
    it(`accepts good/${name}`, () => {
      const text = readFileSync(path.join(FIX, 'good', name), 'utf8');
      expect(parseDemoText(text, SHUTTLE, lookup).errors).toEqual([]);
    });
  }
  for (const name of readdirSync(path.join(FIX, 'bad')).filter((n) => !n.endsWith('.errors.json'))) {
    it(`rejects bad/${name} with the firmware's messages`, () => {
      const text = readFileSync(path.join(FIX, 'bad', name), 'utf8');
      const expected = JSON.parse(readFileSync(path.join(FIX, 'bad', name.replace(/\.json$/, '.errors.json')), 'utf8'));
      expect(validateDemo(JSON.parse(text), SHUTTLE, lookup)).toEqual(expected);
    });
  }
});

describe('helpers', () => {
  it('reports bad JSON', () => {
    expect(parseDemoText('{', SHUTTLE).errors[0]).toMatch(/^not valid JSON: /);
  });
  it('prints values like Python', () => {
    expect(pyRepr({ set: 1, x: [true, null, 'a'] })).toBe("{'set': 1, 'x': [True, None, 'a']}");
    expect(pyRepr(1.5)).toBe('1.5');
  });
  it('formats a file that parses back to the same thing', () => {
    const text = readFileSync(path.join(FIX, 'good', 'steps-and-subtile.json'), 'utf8');
    const { file } = parseDemoText(text, SHUTTLE, lookup);
    const again = formatDemo(file!);
    expect(JSON.parse(again)).toEqual(file);
    expect(again.split('\n')[4]).toContain('"address": 260');
  });
});
