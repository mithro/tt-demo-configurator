// SPDX-License-Identifier: Apache-2.0
// Behavioural models of the few sky130 standard cells Tiny Tapeout designs instantiate by
// hand (delay buffers, clock gates, tie cells), so those designs compile. Added only when a
// source mentions one of these cells and doesn't define it.

const BUF = (n: string) => `module sky130_fd_sc_hd__${n} (output X, input A);\n  assign X = A;\nendmodule\n`;
const INV = (n: string) => `module sky130_fd_sc_hd__${n} (output Y, input A);\n  assign Y = ~A;\nendmodule\n`;
const CLKGATE = (n: string) =>
  `module sky130_fd_sc_hd__${n} (output GCLK, input GATE, input CLK);\n  reg en;\n  always @(*) if (!CLK) en = GATE;\n  assign GCLK = CLK & en;\nendmodule\n`;

const CELLS: Record<string, string> = {
  ...Object.fromEntries(
    ['buf_1', 'buf_2', 'buf_4', 'buf_8', 'buf_16', 'clkbuf_1', 'clkbuf_2', 'clkbuf_4', 'clkbuf_8', 'clkbuf_16', 'dlygate4sd1_1', 'dlygate4sd2_1', 'dlygate4sd3_1', 'dlymetal6s2s_1', 'dlymetal6s4s_1', 'dlymetal6s6s_1', 'clkdlybuf4s50_1'].map((n) => [n, BUF(n)]),
  ),
  ...Object.fromEntries(['inv_1', 'inv_2', 'inv_4', 'clkinv_1', 'clkinv_2', 'clkinv_4'].map((n) => [n, INV(n)])),
  ...Object.fromEntries(['dlclkp_1', 'dlclkp_2', 'dlclkp_4', 'sdlclkp_1'].map((n) => [n, CLKGATE(n)])),
  ...Object.fromEntries(
    ['dlxtp_1', 'dlxbp_1'].map((n) => [n, `module sky130_fd_sc_hd__${n} (output reg Q, input D, input GATE);\n  always @(*) if (GATE) Q = D;\nendmodule\n`]),
  ),
  dlxtn_1: 'module sky130_fd_sc_hd__dlxtn_1 (output reg Q, input D, input GATE_N);\n  always @(*) if (!GATE_N) Q = D;\nendmodule\n',
  conb_1: 'module sky130_fd_sc_hd__conb_1 (output HI, output LO);\n  assign HI = 1\'b1;\n  assign LO = 1\'b0;\nendmodule\n',
  mux2_1: 'module sky130_fd_sc_hd__mux2_1 (output X, input A0, input A1, input S);\n  assign X = S ? A1 : A0;\nendmodule\n',
};

/** A source file of models for the cells the sources use but don't define, or null. */
export function cellModels(sources: Record<string, string>): string | null {
  const all = Object.values(sources).join('\n');
  const used = new Set([...all.matchAll(/\bsky130_fd_sc_hd__(\w+)/g)].map((m) => m[1]));
  const defined = new Set([...all.matchAll(/\bmodule\s+sky130_fd_sc_hd__(\w+)/g)].map((m) => m[1]));
  const models = [...used].filter((c) => !defined.has(c) && CELLS[c]).map((c) => CELLS[c]);
  return models.length ? `// models of sky130 cells, added by the simulator preview\n${models.join('\n')}` : null;
}
