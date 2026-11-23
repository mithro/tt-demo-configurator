// SPDX-License-Identifier: Apache-2.0
// Runs a Tiny Tapeout VGA design: the way the board starts an entry (ena, reset, ui_in),
// its steps replayed in simulated time, and uo_out fed to a virtual monitor every clock.
import type { Entry } from '~/lib/demoFile';
import { inputsAt, type Schedule, stepSchedule } from '~/lib/stepSchedule';
import { VGA } from '~/lib/tinyVga';
import { Crt, LINE_HZ } from './crt';
import type { HDLModuleWASM } from './verilate';

/** Clocks between checks of the steps' timeline (~40 µs at 25 MHz). */
const CHUNK = 1024;

export class VgaSim {
  crt: Crt;
  /** design clocks since the entry started */
  ticks = 0;
  private uoOff: number;
  private schedule: Schedule;
  private ui = -1;
  /** rst_n held low by the steps' reset */
  private held = false;

  constructor(
    private mod: HDLModuleWASM,
    private entry: Pick<Entry, 'ui_in' | 'steps'>,
    readonly clockHz: number,
  ) {
    const uo = mod.globals.lookup('uo_out');
    if (!uo) throw new Error('the design has no uo_out');
    this.uoOff = uo.offset;
    this.schedule = stepSchedule(entry.steps);
    this.crt = new Crt(clockHz);
    this.restart();
  }

  /** Power on: all state cleared, a short reset, ui_in as the entry says. */
  restart() {
    const m = this.mod;
    m.powercycle();
    this.ticks = 0;
    this.held = false;
    this.crt = new Crt(this.clockHz);
    this.apply();
    m.state.ena = 1;
    m.state.uio_in = 0;
    m.state.rst_n = 0;
    m.tick2(10);
    m.state.rst_n = 1;
  }

  /** clocks in one 640x480@60 frame time at this clock */
  get frameClocks(): number {
    return Math.round(this.clockHz / (LINE_HZ / VGA.frameLines));
  }

  simMs(): number {
    return (this.ticks * 1000) / this.clockHz;
  }

  /** Bring ui_in and reset in line with the steps at the current simulated time. */
  private apply() {
    // the schedule includes the 2 ms resets between passes, so it keeps pace with the board
    const { ui_in, inReset } = inputsAt(this.entry, this.simMs(), this.schedule);
    if (ui_in !== this.ui) {
      this.mod.state.ui_in = ui_in;
      this.ui = ui_in;
    }
    if (inReset !== this.held) {
      this.mod.state.rst_n = inReset ? 0 : 1;
      this.held = inReset;
    }
  }

  get uiIn(): number {
    return this.ui;
  }

  /** Run up to n clocks (rounded up to whole chunks). Returns the frames completed. */
  run(n: number): number {
    const m = this.mod;
    const data = m.data8;
    const off = this.uoOff;
    const crt = this.crt;
    let frames = 0;
    for (let done = 0; done < n; done += CHUNK) {
      for (let i = 0; i < CHUNK; i++) {
        m.tick2(1);
        if (crt.feed(data[off])) frames++;
      }
      this.ticks += CHUNK;
      this.apply();
    }
    return frames;
  }

  /** Run until a frame completes or n clocks pass; true if a frame completed. */
  runFrame(maxTicks: number): boolean {
    const m = this.mod;
    const data = m.data8;
    const off = this.uoOff;
    const crt = this.crt;
    for (let done = 0; done < maxTicks; done += CHUNK) {
      let frame = false;
      for (let i = 0; i < CHUNK; i++) {
        m.tick2(1);
        if (crt.feed(data[off])) frame = true;
      }
      this.ticks += CHUNK;
      this.apply();
      if (frame) return true;
    }
    return false;
  }
}
