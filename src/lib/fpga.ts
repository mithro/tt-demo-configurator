// SPDX-License-Identifier: Apache-2.0
//
// The FPGA breakout board's designs. It has no shuttle index: the board itself says what
// it carries, one design per bitstream in /bitstreams, at the address its SDK gives it
// (the bitstream's position in its listing of that directory). A bitstream named like a
// Tiny Tapeout project (its macro, e.g. tt_um_factory_test) is shown with that project's
// title, pinout, clock, sources and recording; the others only have the board's name.
import type { FpgaDesign } from './board';
import { loadSearchInfo } from './projectSearch';
import { loadShuttle, Project, videoInfo } from './shuttleIndex';

/** The shuttle name the SDK reports for the FPGA board (and a sequence for it carries). */
export const FPGA_SHUTTLE = 'FPGA';

/** The board's designs as projects, named only as the board names them. */
export function fpgaProjects(designs: FpgaDesign[]): Project[] {
  return designs.map((d) => ({ macro: d.name, address: d.address, subtile: 0, title: d.name, author: '', clock_hz: 0, pinout: {} }));
}

export interface MatchDeps {
  /** Shuttle ids, newest first. */
  order: string[];
  /** Is there a recording of this design on this shuttle? */
  hasVideo: (shuttle: string, macro: string) => boolean;
  /** The macros a shuttle has (from data bundled with the app). */
  searchMacros: (shuttle: string) => Promise<Set<string>>;
  loadShuttle: (id: string) => Promise<Project[]>;
}

export const defaultMatchDeps = (order: string[]): MatchDeps => ({
  order,
  hasVideo: (shuttle, macro) => !!videoInfo(shuttle, macro)?.dir,
  searchMacros: async (shuttle) => new Set(Object.keys(await loadSearchInfo(shuttle))),
  loadShuttle,
});

/**
 * Name the board's designs after the Tiny Tapeout projects they match by macro: from the
 * newest shuttle with a recording of it, else the newest that has it at all. The board's
 * address stays (it is what a sequence for this board uses), and the chip's danger level
 * is not copied: the FPGA board enables any bitstream. A shuttle index that can't be
 * loaded leaves its designs as the board names them, and is reported in errors.
 */
export async function matchKnown(projects: Project[], deps: MatchDeps): Promise<{ projects: Project[]; errors: string[] }> {
  const indexes = new Map<string, Promise<Project[]>>();
  const macros = new Map<string, Promise<Set<string>>>();
  const index = (id: string) => {
    if (!indexes.has(id)) indexes.set(id, deps.loadShuttle(id));
    return indexes.get(id)!;
  };
  const has = (id: string) => {
    if (!macros.has(id)) macros.set(id, deps.searchMacros(id));
    return macros.get(id)!;
  };
  const errors: string[] = [];
  const out: Project[] = [];
  for (const p of projects) {
    let shuttle = deps.order.find((id) => deps.hasVideo(id, p.macro));
    if (!shuttle) {
      for (const id of deps.order) {
        if ((await has(id)).has(p.macro)) {
          shuttle = id;
          break;
        }
      }
    }
    if (!shuttle) {
      out.push(p);
      continue;
    }
    let chip: Project | undefined;
    try {
      chip = (await index(shuttle)).find((q) => q.macro === p.macro);
    } catch (e) {
      errors.push(`couldn't load the ${shuttle} project list to name ${p.macro}: ${e}`);
    }
    if (!chip) {
      out.push(p);
      continue;
    }
    const { danger_level: _chipOnly, address, subtile, ...rest } = chip;
    out.push({ ...rest, address: p.address, subtile: p.subtile, known: { shuttle, address, subtile } });
  }
  return { projects: out, errors };
}
