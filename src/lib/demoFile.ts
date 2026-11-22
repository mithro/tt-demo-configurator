// SPDX-License-Identifier: Apache-2.0
//
// The demo sequence format shared by /demo.json and /shuttles/<shuttle>.demo.json, and a
// validator that mirrors the firmware's ttboard/demo.py validate() exactly, down to the
// error messages, so the app and the board report the same problems. The board's own
// validate() stays the final word (it is run over the REPL before anything is made
// permanent); this one gives instant feedback while editing.
//
// Known difference: JSON.parse turns 1.0 into the integer 1, while Python keeps a float
// and rejects it. The board check catches that case.

export type Step = { set: number } | { wait_ms: number };

export interface Entry {
  address: number;
  subtile: number;
  duration_ms: number;
  clock_hz: number;
  ui_in: number;
  steps: Step[];
}

export interface DemoFile {
  version: 1;
  shuttle: string;
  projects: Entry[];
}

/** What validateDemo needs to know about a project on the chip. */
export interface LookupResult {
  name: string;
  /** true when the board would refuse to enable it (danger level not "safe"). */
  dangerous: boolean;
}

export type Lookup = (key: number | string) => LookupResult | null;

export const VERSION = 1;
const TOP_FIELDS = ['version', 'shuttle', 'projects'];
export const ENTRY_FIELDS = ['address', 'subtile', 'duration_ms', 'clock_hz', 'ui_in', 'steps'] as const;

/** Python's str() of a JSON value, as the firmware's f-strings print it. */
export function pyStr(v: unknown): string {
  return typeof v === 'string' ? v : pyRepr(v);
}

/** Python's repr() of a JSON value. */
export function pyRepr(v: unknown): string {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : pyFloat(v);
  if (typeof v === 'string') return pyStrRepr(v);
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(', ')}]`;
  if (typeof v === 'object') {
    const items = Object.entries(v as Record<string, unknown>).map(([k, x]) => `${pyStrRepr(k)}: ${pyRepr(x)}`);
    return `{${items.join(', ')}}`;
  }
  return String(v);
}

function pyFloat(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : v < 0 ? '-inf' : 'nan';
  const s = String(v);
  return s.includes('e') ? s.replace(/e([+-])(\d)$/, 'e$10$2') : s;
}

function pyStrRepr(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  const body = s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r');
  return q + (q === "'" ? body.replace(/'/g, "\\'") : body) + q;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** How the project mux looks an entry up: the plain address, or "ADDRESS-SUBTILE". */
export function entryKey(e: Pick<Entry, 'address' | 'subtile'>): number | string {
  return e.subtile ? `${e.address}-${e.subtile}` : e.address;
}

function checkSteps(where: string, steps: unknown, errors: string[]) {
  if (!Array.isArray(steps)) {
    errors.push(`${where}: "steps" must be a list`);
    return;
  }
  let totalWait = 0;
  steps.forEach((step, i) => {
    const here = `${where} step ${i}`;
    if (!isObj(step) || Object.keys(step).length !== 1) {
      errors.push(`${here}: must be an object with exactly one key: ${pyStr(step)}`);
      return;
    }
    if ('set' in step) {
      const v = step.set;
      if (!(isInt(v) && v >= 0 && v <= 0xff)) errors.push(`${here}: "set" must be an integer 0..255, got ${pyStr(v)}`);
    } else if ('wait_ms' in step) {
      const v = step.wait_ms;
      if (!(isInt(v) && v >= 0)) errors.push(`${here}: "wait_ms" must be an integer >= 0, got ${pyStr(v)}`);
      else totalWait += v;
    } else {
      errors.push(`${here}: unknown step ${pyStr(step)}`);
    }
  });
  if (steps.length && totalWait <= 0) errors.push(`${where}: "steps" must wait for some time in total`);
}

function checkEntry(where: string, e: unknown, errors: string[]): boolean {
  if (!isObj(e)) {
    errors.push(`${where}: must be an object`);
    return false;
  }
  let ok = true;
  for (const f of Object.keys(e)) {
    if (!(ENTRY_FIELDS as readonly string[]).includes(f)) {
      errors.push(`${where}: unknown field "${f}"`);
      ok = false;
    }
  }
  for (const f of ENTRY_FIELDS) {
    if (!(f in e)) {
      errors.push(`${where}: missing "${f}"`);
      ok = false;
    }
  }
  if (!ok) return false;
  const checks: [string, boolean, string][] = [
    ['address', isInt(e.address) && e.address >= 0, 'an integer >= 0'],
    ['subtile', isInt(e.subtile) && e.subtile >= 0, 'an integer >= 0'],
    ['duration_ms', isInt(e.duration_ms) && e.duration_ms > 0, 'an integer > 0'],
    ['clock_hz', isInt(e.clock_hz) && e.clock_hz >= 0, 'an integer >= 0'],
    ['ui_in', isInt(e.ui_in) && e.ui_in >= 0 && e.ui_in <= 0xff, 'an integer 0..255'],
  ];
  for (const [field, good, what] of checks) {
    if (!good) {
      errors.push(`${where}: "${field}" must be ${what}, got ${pyStr(e[field])}`);
      ok = false;
    }
  }
  const n = errors.length;
  checkSteps(where, e.steps, errors);
  return ok && errors.length === n;
}

/**
 * Check a parsed sequence against the format and, if a lookup is given, against the
 * projects on the chip. Returns every problem found; an empty list means valid.
 */
export function validateDemo(conf: unknown, shuttle: string, lookup?: Lookup): string[] {
  const errors: string[] = [];
  if (!isObj(conf)) return ['must be a JSON object'];
  for (const f of Object.keys(conf)) if (!TOP_FIELDS.includes(f)) errors.push(`unknown field "${f}"`);
  const missing = TOP_FIELDS.filter((f) => !(f in conf));
  for (const f of missing) errors.push(`missing "${f}"`);
  if (missing.length) return errors;
  if (conf.version !== VERSION || !isInt(conf.version)) errors.push(`"version" must be ${VERSION}, got ${pyStr(conf.version)}`);
  if (conf.shuttle !== shuttle) errors.push(`"shuttle" is "${pyStr(conf.shuttle)}" but this chip is "${shuttle}"`);
  const projects = conf.projects;
  if (!Array.isArray(projects) || !projects.length) {
    errors.push('"projects" must be a non-empty list');
    return errors;
  }
  projects.forEach((e, i) => {
    const where = `project ${i}`;
    if (!checkEntry(where, e, errors) || !lookup) return;
    const key = entryKey(e as unknown as Entry);
    const design = lookup(key);
    if (!design) {
      errors.push(`${where}: no project at address ${key} on ${shuttle}`);
    } else if (design.dangerous) {
      errors.push(`${where}: project ${key} (${design.name}) is not marked safe and would not be enabled`);
    }
  });
  return errors;
}

/** Parse and validate file text. `file` is set only when there are no errors. */
export function parseDemoText(text: string, shuttle: string, lookup?: Lookup): { file?: DemoFile; errors: string[] } {
  let conf: unknown;
  try {
    conf = JSON.parse(text);
  } catch (e) {
    return { errors: [`not valid JSON: ${(e as Error).message}`] };
  }
  const errors = validateDemo(conf, shuttle, lookup);
  return errors.length ? { errors } : { file: conf as DemoFile, errors };
}

/** The shuttle a file says it is for, if it says. */
export function fileShuttle(text: string): string | null {
  try {
    const conf = JSON.parse(text);
    return isObj(conf) && typeof conf.shuttle === 'string' ? conf.shuttle : null;
  } catch {
    return null;
  }
}

function formatStep(s: Step): string {
  return 'set' in s ? `{"set": ${s.set}}` : `{"wait_ms": ${s.wait_ms}}`;
}

/** Serialise with a fixed key order and one project per line, so diffs stay readable. */
export function formatDemo(file: DemoFile): string {
  const lines = file.projects.map((e) => {
    const steps = `[${e.steps.map(formatStep).join(', ')}]`;
    return (
      `    {"address": ${e.address}, "subtile": ${e.subtile}, "duration_ms": ${e.duration_ms}, ` +
      `"clock_hz": ${e.clock_hz}, "ui_in": ${e.ui_in}, "steps": ${steps}}`
    );
  });
  return `{\n  "version": ${file.version},\n  "shuttle": ${JSON.stringify(file.shuttle)},\n  "projects": [\n${lines.join(',\n')}\n  ]\n}\n`;
}
