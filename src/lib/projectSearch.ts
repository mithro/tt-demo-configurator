// SPDX-License-Identifier: Apache-2.0
// Per-design data from the Tiny Tapeout project-search database (mith.ro/tinytapeout-project-search),
// bundled one file per shuttle by scripts/update-project-search.py and loaded when a shuttle is.
import PMODS from '~/data/project-search/pmods.json';

export interface Pmod {
  id: string;
  name: string;
  pins: string;
  url: string;
}

export type SiliconStatus = 'working' | 'partial' | 'broken' | 'untested';

export interface SearchInfo {
  /** Pmods whose recommended pinout the design's pin names match (inferred, not tested). */
  pmods: string[];
  /** Model-written tags, not checked by a person. */
  tags: string[];
  /** The status from reports on real chips, with how many of each kind there are. */
  silicon: { status: SiliconStatus; working: number; partial: number; broken: number };
}

interface ShuttleFile {
  source: string;
  index_updated: string | null;
  projects: Record<string, SearchInfo>;
}

/** The Pmods the database knows, in its order (Tiny VGA first). */
export const PMOD_LIST: Pmod[] = PMODS;

const FILES = import.meta.glob<ShuttleFile>(['../data/project-search/*.json', '!../data/project-search/pmods.json'], { import: 'default' });

/** The shuttle's designs by macro; empty when the database doesn't have the shuttle. */
export async function loadSearchInfo(shuttle: string): Promise<Record<string, SearchInfo>> {
  const load = FILES[`../data/project-search/${shuttle}.json`];
  return load ? (await load()).projects : {};
}

/** The design's page on the project-search site. */
export function searchUrl(shuttle: string, macro: string): string {
  return `https://mith.ro/tinytapeout-project-search/#${new URLSearchParams({ q: macro, shuttle })}`;
}
