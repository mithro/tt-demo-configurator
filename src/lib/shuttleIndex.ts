// SPDX-License-Identifier: Apache-2.0
// Project lists from index.tinytapeout.com, plus the bundled VGA-videos data, and the
// lookup the validator uses to check addresses.
import videos from '~/data/videos.json';
import type { Lookup } from './demoFile';

export interface Project {
  macro: string;
  address: number;
  subtile: number;
  type?: string;
  title: string;
  author: string;
  clock_hz: number;
  repo?: string;
  commit?: string;
  danger_level?: string;
  pinout: Record<string, string>;
}

export interface ShuttleInfo {
  id: string;
  name: string;
}

const INDEX = 'https://index.tinytapeout.com';
const FIELDS = 'macro,address,subtile_addr,type,title,author,clock_hz,repo,commit,danger_level,pinout';

/** Normalise one index record (subtile_addr becomes subtile, 0 when absent). */
export function toProject(p: Record<string, unknown>): Project {
  return {
    macro: String(p.macro),
    address: Number(p.address),
    subtile: Number(p.subtile_addr ?? 0),
    type: p.type as string | undefined,
    title: String(p.title ?? p.macro).trim() || String(p.macro),
    author: String(p.author ?? '').trim(),
    clock_hz: Number(p.clock_hz ?? 0),
    repo: p.repo as string | undefined,
    commit: p.commit as string | undefined,
    danger_level: p.danger_level as string | undefined,
    pinout: (p.pinout as Record<string, string>) ?? {},
  };
}

export async function loadShuttles(): Promise<ShuttleInfo[]> {
  const r = await fetch(`${INDEX}/`);
  if (!r.ok) throw new Error(`index.tinytapeout.com: HTTP ${r.status}`);
  const data: { shuttles: { id: string; name: string }[] } = await r.json();
  return data.shuttles.map((s) => ({ id: s.id, name: s.name }));
}

export async function loadShuttle(id: string): Promise<Project[]> {
  const r = await fetch(`${INDEX}/${encodeURIComponent(id)}.json?fields=${FIELDS}`);
  if (!r.ok) throw new Error(`index.tinytapeout.com/${id}.json: HTTP ${r.status}`);
  const data: { projects: Record<string, unknown>[] } = await r.json();
  return data.projects.map(toProject).filter((p) => p.type !== 'group');
}

export function projectKey(p: Pick<Project, 'address' | 'subtile'>): string {
  return p.subtile ? `${p.address}-${p.subtile}` : String(p.address);
}

/** A validator lookup over an index, matching the firmware's release check. */
export function indexLookup(projects: Project[]): Lookup {
  const map = new Map(projects.map((p) => [projectKey(p), p]));
  return (key) => {
    const p = map.get(String(key));
    return p ? { name: p.macro, dangerous: p.danger_level !== undefined && p.danger_level !== 'safe' } : null;
  };
}

interface VideoRec {
  pmods: string[];
  verdict: string | null;
  dir?: string;
  stem?: string;
  lengths?: number[];
}
const V = videos as { base: string; shuttles: Record<string, Record<string, VideoRec>> };

export function videoInfo(shuttle: string, macro: string): VideoRec | null {
  return V.shuttles[shuttle]?.[macro] ?? null;
}

/** The clip and poster for a design, if one was recorded. */
export function clipUrls(shuttle: string, macro: string, seconds = 10): { mp4: string; webm: string; poster: string } | null {
  const v = videoInfo(shuttle, macro);
  if (!v?.dir || !v.stem) return null;
  const len = v.lengths?.includes(seconds) ? seconds : (v.lengths?.[0] ?? seconds);
  const base = `${V.base}${v.dir}/${v.stem}`;
  return { mp4: `${base}_${len}s.mp4`, webm: `${base}_${len}s.webm`, poster: `${base}_poster.png` };
}

/** The Tiny VGA Pmod pinout: uo[0..7] = R1 G1 B1 VS R0 G0 B0 HS. */
export function isTinyVga(p: Project): boolean {
  const uo = (i: number) => (p.pinout[`uo[${i}]`] ?? '').toLowerCase();
  return /v.?sync/.test(uo(3)) && /h.?sync/.test(uo(7)) && /r/.test(uo(0)) && /g/.test(uo(1)) && /b/.test(uo(2));
}

/** Pmods a design works with: the videos project's list, or Tiny VGA from the pinout. */
export function pmodsOf(shuttle: string, p: Project): string[] {
  const known = videoInfo(shuttle, p.macro)?.pmods;
  if (known?.length) return known;
  return isTinyVga(p) ? ['tiny-vga'] : [];
}

/** The project's own name for input pin n, or "ui[n]". */
export function uiName(p: Project | undefined, n: number): string {
  const name = p?.pinout[`ui[${n}]`]?.trim();
  return name ? name : `ui[${n}]`;
}
