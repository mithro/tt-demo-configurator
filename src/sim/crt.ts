// SPDX-License-Identifier: Apache-2.0
// A virtual 640x480 monitor fed one uo_out sample per design clock. Like a real monitor it
// locks to the sync pulses (either polarity: the shorter phase of each sync signal is the
// pulse) and samples each line by time: the line's measured length is 800 pixel times, the
// active 640 start 48 pixel times after the hsync pulse ends, and the active 480 lines 33
// lines after the vsync pulse ends. So a 25 MHz, 48 MHz or 50 MHz design all fill the screen.
import { rgbaLut, VGA } from '~/lib/tinyVga';

export interface CrtStats {
  /** design clocks from one hsync pulse to the next */
  lineClocks: number;
  /** lines from one vsync pulse to the next (525 when standard) */
  frameLines: number;
  /** line rate in Hz (31.47 kHz when standard) */
  lineHz: number;
  hsyncActiveHigh: boolean;
  vsyncActiveHigh: boolean;
  /** clocks since the last hsync pulse */
  sinceHsync: number;
}

const LUT = rgbaLut();
export const LINE_HZ = VGA.pixelHz / VGA.lineClocks;

export class Crt {
  readonly width = VGA.width;
  readonly height = VGA.height;
  /** RGBA pixels (a Uint32Array view for ImageData) */
  readonly pixels = new Uint32Array(VGA.width * VGA.height);
  /** completed frames */
  frames = 0;

  private clockHz: number;
  /** pixels per design clock, from the line length (assumed until measured) */
  private pxPerClock: number;
  private hBackClocks: number;
  private x = 0;
  private y = -1000;
  private hRaw = -1;
  private vRaw = -1;
  private hRun = 0;
  private vRun = 0;
  private hLen = [0, 0];
  private vLen = [0, 0];
  private hActive = 0;
  private vActive = 0;
  private sinceHStart = 0;
  private lineClocks = 0;
  private lines = 0;
  private frameLines = 0;
  /** last column drawn on this line, and its colour */
  private lastPx = -1;
  private lastColour = 0;
  /** last row drawn in this frame */
  private maxRow = -1;

  constructor(clockHz: number) {
    this.clockHz = clockHz;
    this.pxPerClock = 1;
    this.hBackClocks = 0;
    this.setLine(Math.max(1, Math.round(clockHz / VGA.pixelHz)) * VGA.lineClocks);
    this.pixels.fill(0xff000000);
  }

  private setLine(clocks: number) {
    this.pxPerClock = VGA.lineClocks / clocks;
    this.hBackClocks = VGA.hBack / this.pxPerClock;
  }

  stats(): CrtStats {
    return {
      lineClocks: this.lineClocks,
      frameLines: this.frameLines,
      lineHz: this.lineClocks ? this.clockHz / this.lineClocks : 0,
      hsyncActiveHigh: this.hActive === 1,
      vsyncActiveHigh: this.vActive === 1,
      sinceHsync: this.sinceHStart,
    };
  }

  /** Is the timing what a 640x480@60 monitor expects (line rate within 1%, 525 lines)? */
  standard(): boolean {
    const { lineHz } = this.stats();
    return Math.abs(lineHz - LINE_HZ) <= LINE_HZ * 0.01 && Math.abs(this.frameLines - VGA.frameLines) <= 5;
  }

  /** Feed one clock's uo_out. Returns true when a frame was just completed. */
  feed(uo: number): boolean {
    const h = (uo >> 7) & 1;
    const v = (uo >> 3) & 1;
    let done = false;
    this.sinceHStart++;
    if (h !== this.hRaw) {
      if (this.hRaw >= 0) {
        this.hLen[this.hRaw] = this.hRun;
        // the pulse is the shorter phase; until both are measured assume active low
        if (this.hLen[0] && this.hLen[1]) this.hActive = this.hLen[1] < this.hLen[0] ? 1 : 0;
        if (h === this.hActive) {
          // hsync pulse starts: a line ends
          if (this.sinceHStart !== this.lineClocks && this.sinceHStart > 16) this.setLine(this.sinceHStart);
          this.lineClocks = this.sinceHStart;
          this.sinceHStart = 0;
          this.endLine();
        } else {
          // hsync pulse ends: back porch, then the active pixels
          this.x = 0;
          this.lastPx = -1;
          this.y++;
          this.lines++;
        }
      }
      this.hRaw = h;
      this.hRun = 0;
    }
    this.hRun++;
    if (v !== this.vRaw) {
      if (this.vRaw >= 0) {
        this.vLen[this.vRaw] = this.vRun;
        if (this.vLen[0] && this.vLen[1]) this.vActive = this.vLen[1] < this.vLen[0] ? 1 : 0;
        if (v === this.vActive) {
          // vsync pulse starts: the frame is over
          this.frameLines = this.lines;
          this.lines = 0;
          this.frames++;
          this.endFrame();
          done = true;
        } else {
          // vsync pulse ends. If it ends late in a line, the next hsync starts line 0.
          this.y = this.x * this.pxPerClock > VGA.lineClocks / 2 ? -1 : 0;
        }
      }
      this.vRaw = v;
      this.vRun = 0;
    }
    this.vRun++;
    const py = this.y - VGA.vBack;
    const xc = this.x - this.hBackClocks;
    this.x++;
    if (py >= 0 && py < VGA.height && xc >= 0) {
      const px = (xc * this.pxPerClock) | 0;
      if (px > this.lastPx && this.lastPx < VGA.width - 1) {
        // a clock longer than a pixel covers several: the previous sample holds until this one
        const row = py * VGA.width;
        const colour = LUT[uo];
        const fill = this.lastPx >= 0 ? this.lastColour : colour;
        const end = Math.min(px, VGA.width);
        for (let k = this.lastPx + 1; k < end; k++) this.pixels[row + k] = fill;
        if (px < VGA.width) this.pixels[row + px] = colour;
        this.lastPx = end === px ? px : VGA.width - 1;
        this.lastColour = colour;
        if (py > this.maxRow) this.maxRow = py;
      }
    }
    return done;
  }

  /** A line ended: columns it didn't reach are black, as on a monitor. */
  private endLine() {
    const py = this.y - VGA.vBack;
    if (py >= 0 && py < VGA.height && this.lastPx >= 0) this.pixels.fill(0xff000000, py * VGA.width + this.lastPx + 1, (py + 1) * VGA.width);
    // nothing more on this row: the next hsync pulse's end starts the next line
    this.lastPx = VGA.width - 1;
  }

  /** A frame ended: rows it didn't reach are black. */
  private endFrame() {
    this.pixels.fill(0xff000000, (this.maxRow + 1) * VGA.width);
    this.maxRow = -1;
  }

  clear() {
    this.pixels.fill(0xff000000);
  }
}
