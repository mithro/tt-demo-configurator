// SPDX-License-Identifier: Apache-2.0
// A Tiny Tapeout top for the gamepad tests: the gamepad_pmod_dual module (gamepad_pmod.v,
// as the 2048 game includes it) on ui_in[6:4], with what it decodes on the outputs.
// ui_in[0] picks the player shown: uo_out = {right, left, down, up, start, select, y, b},
// uio_out = {is_present[1], is_present[0], 2'b0, r, l, x, a}.
`default_nettype none

module tt_um_gamepad_probe (
    input  wire [7:0] ui_in,
    output wire [7:0] uo_out,
    input  wire [7:0] uio_in,
    output wire [7:0] uio_out,
    output wire [7:0] uio_oe,
    input  wire       ena,
    input  wire       clk,
    input  wire       rst_n
);
  wire [1:0] b, y, select, start, up, down, left, right, a, x, l, r, is_present;

  gamepad_pmod_dual gamepad (
      .rst_n(rst_n),
      .clk(clk),
      .pmod_latch(ui_in[4]),
      .pmod_clk(ui_in[5]),
      .pmod_data(ui_in[6]),
      .b(b),
      .y(y),
      .select(select),
      .start(start),
      .up(up),
      .down(down),
      .left(left),
      .right(right),
      .a(a),
      .x(x),
      .l(l),
      .r(r),
      .is_present(is_present)
  );

  wire p = ui_in[0];
  assign uo_out = {right[p], left[p], down[p], up[p], start[p], select[p], y[p], b[p]};
  assign uio_out = {is_present, 2'b0, r[p], l[p], x[p], a[p]};
  assign uio_oe = 8'hff;
  wire _unused = &{uio_in, ena, ui_in[7], ui_in[3:1]};
endmodule
