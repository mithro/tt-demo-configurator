// SPDX-License-Identifier: Apache-2.0
// The Recording / Simulation switch, remembered in localStorage (when it is available).
import { ToggleButton, ToggleButtonGroup } from '@suid/material';
import { createSignal } from 'solid-js';

export type PreviewSourceKind = 'recording' | 'simulation';
const KEY = 'tt-demo-configurator.preview-source';

function initial(): PreviewSourceKind {
  try {
    return localStorage.getItem(KEY) === 'simulation' ? 'simulation' : 'recording';
  } catch {
    return 'recording';
  }
}

const [source, setSourceSignal] = createSignal<PreviewSourceKind>(initial());
export { source as previewSource };

export function setPreviewSource(v: PreviewSourceKind) {
  setSourceSignal(v);
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // private window or blocked storage: the choice just isn't remembered
  }
}

export function PreviewSourceToggle() {
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={source()}
      onChange={(_e, v) => v && setPreviewSource(v as PreviewSourceKind)}
      sx={{ mr: 1 }}
    >
      <ToggleButton value="recording" sx={{ py: 0.25, px: 1, textTransform: 'none' }} title="Recorded from a real chip with the design's default inputs">
        Recording
      </ToggleButton>
      <ToggleButton value="simulation" sx={{ py: 0.25, px: 1, textTransform: 'none' }} title="The design's Verilog run in this browser, with this entry's ui_in and steps">
        Simulation
      </ToggleButton>
    </ToggleButtonGroup>
  );
}
