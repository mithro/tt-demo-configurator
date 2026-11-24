// SPDX-License-Identifier: Apache-2.0
// Runs a Tiny Tapeout VGA design: the way the board starts an entry (ena, reset, ui_in),
// its steps replayed in simulated time, and uo_out fed to a virtual monitor every clock.
// Gamepad steps drive ui_in[6:4] level by level, as the board's emulated Gamepad Pmod does.
import type { Entry } from '~/lib/demoFile';
import { gamepadLevels } from '~/lib/gamepad';
import { inputsAt, padReports, type Schedule, stepSchedule } from '~/lib/stepSchedule';
import { VGA } from '~/lib/tinyVga';
import { Crt, LINE_HZ } from './crt';
import type { HDLModuleWASM } from './verilate';

/** Clocks between checks of the steps' timeline (~40 µs at 25 MHz). */
const CHUNK = 1024;
/**
 * How long the board holds each gamepad level: 16.8 µs measured on an RP2350 (SDK 3.1.0,
 * scripts/hw-gamepad.ts). At least a few clocks, which the designs' synchronizers need.
 */
export const PAD_LEVEL_US = 17;
const MIN_LEVEL_CLOCKS = 4;

export class VgaSim {
  crt: Crt;
  /** design clocks since the entry started */
  ticks = 0;
  private uoOff: number;
  private schedule: Schedule;
  private ui = -1;
  /** rst_n held low by the steps' reset */
  private held = false;
  /** ui_in as the sets leave it (the gamepad's bits clear) */
  private base = 0;
  /** the gamepad's levels still to drive, the current one, and the clocks it has left */
  private padQueue: number[] = [];
  private pad = 0;
  private padLeft = 0;
  /** reports up to this simulated time have been queued */
  private padUpTo = 0;
  private readonly levelClocks: number;

  constructor(
    private mod: HDLModuleWASM,
    private entry: Pick<Entry, 'ui_in' | 'steps'>,
    readonly clockHz: number,
  ) {
    const uo = mod.globals.lookup('uo_out');
    if (!uo) throw new Error('the design has no uo_out');
    this.uoOff = uo.offset;
    this.schedule = stepSchedule(entry.steps);
    this.levelClocks = Math.max(MIN_LEVEL_CLOCKS, Math.round((clockHz * PAD_LEVEL_US) / 1e6));
    this.crt = new Crt(clockHz);
    this.restart();
  }

  /** Power on: all state cleared, a short reset, ui_in as the entry says. */
  restart() {
    const m = this.mod;
    m.powercycle();
    this.ticks = 0;
    this.held = false;
    this.ui = -1;
    this.padQueue = [];
    this.pad = 0;
    this.padLeft = 0;
    this.padUpTo = 0;
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
    const now = this.simMs();
    const { ui_in, inReset } = inputsAt(this.entry, now, this.schedule);
    this.base = ui_in;
    if (this.schedule.pads.length && now > this.padUpTo) {
      for (const r of padReports(this.schedule, this.padUpTo, now)) this.padQueue.push(...gamepadLevels(r.word));
      this.padUpTo = now;
    }
    this.drive();
    if (inReset !== this.held) {
      this.mod.state.rst_n = inReset ? 0 : 1;
      this.held = inReset;
    }
  }

  private drive() {
    const v = this.base | this.pad;
    if (v !== this.ui) {
      this.mod.state.ui_in = v;
      this.ui = v;
    }
  }

  /** Move to the next gamepad level when the current one has had its time. */
  private padTick() {
    if (this.padLeft > 0) this.padLeft--;
    else if (this.padQueue.length) {
      this.pad = this.padQueue.shift()!;
      this.padLeft = this.levelClocks - 1;
      this.drive();
    }
  }

  /** One chunk of clocks, fed to the monitor. Returns whether a frame completed. */
  private chunk(): boolean {
    const m = this.mod;
    const data = m.data8;
    const off = this.uoOff;
    const crt = this.crt;
    let frame = false;
    if (this.padQueue.length || this.padLeft) {
      for (let i = 0; i < CHUNK; i++) {
        this.padTick();
        m.tick2(1);
        if (crt.feed(data[off])) frame = true;
      }
    } else {
      for (let i = 0; i < CHUNK; i++) {
        m.tick2(1);
        if (crt.feed(data[off])) frame = true;
      }
    }
    this.ticks += CHUNK;
    this.apply();
    return frame;
  }

  get uiIn(): number {
    return this.ui;
  }

  /** Run up to n clocks (rounded up to whole chunks). Returns the frames completed. */
  run(n: number): number {
    let frames = 0;
    for (let done = 0; done < n; done += CHUNK) if (this.chunk()) frames++;
    return frames;
  }

  /** Run until a frame completes or n clocks pass; true if a frame completed. */
  runFrame(maxTicks: number): boolean {
    for (let done = 0; done < maxTicks; done += CHUNK) if (this.chunk()) return true;
    return false;
  }
}
