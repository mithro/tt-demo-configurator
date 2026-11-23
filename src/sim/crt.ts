// SPDX-License-Identifier: Apache-2.0
// A virtual 640x480 monitor fed one uo_out sample per design clock: it locks to the sync
// pulses (either polarity: the shorter phase of each sync signal is the pulse) and draws
// the active area the standard porches put after them, like a real monitor would.
import { rgbaLut, VGA } from '~/lib/tinyVga';

export interface CrtStats {
  /** design clocks from one hsync pulse to the next (800 x clocks per pixel when standard) */
  lineClocks: number;
  /** lines from one vsync pulse to the next (525 when standard) */
  frameLines: number;
  hsyncActiveHigh: boolean;
  vsyncActiveHigh: boolean;
  /** clocks since the last hsync pulse */
  sinceHsync: number;
}

const LUT = rgbaLut();

export class Crt {
  readonly width = VGA.width;
  readonly height = VGA.height;
  /** RGBA pixels (a Uint32Array view for ImageData) */
  readonly pixels = new Uint32Array(VGA.width * VGA.height);
  /** completed frames */
  frames = 0;

  private div: number;
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

  /** clocksPerPixel: design clocks per pixel (1 at 25 MHz, 2 at 50 MHz) */
  constructor(clocksPerPixel: number) {
    this.div = clocksPerPixel;
    this.hBackClocks = VGA.hBack * clocksPerPixel;
    this.pixels.fill(0xff000000);
  }

  stats(): CrtStats {
    return {
      lineClocks: this.lineClocks,
      frameLines: this.frameLines,
      hsyncActiveHigh: this.hActive === 1,
      vsyncActiveHigh: this.vActive === 1,
      sinceHsync: this.sinceHStart,
    };
  }

  /** Is the timing what a 640x480@60 monitor expects (within 1%)? */
  standard(): boolean {
    const { lineClocks, frameLines } = this;
    return Math.abs(lineClocks - VGA.lineClocks * this.div) <= VGA.lineClocks * this.div * 0.01 && Math.abs(frameLines - VGA.frameLines) <= 5;
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
          this.lineClocks = this.sinceHStart;
          this.sinceHStart = 0;
        } else {
          // hsync pulse ends: back porch, then the active pixels
          this.x = 0;
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
          done = true;
        } else {
          // vsync pulse ends. If it ends late in a line, the next hsync starts line 0.
          this.y = this.x > (this.lineClocks || VGA.lineClocks * this.div) / 2 ? -1 : 0;
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
      const px = (xc / this.div) | 0;
      if (px < VGA.width) this.pixels[py * VGA.width + px] = LUT[uo];
    }
    return done;
  }

  clear() {
    this.pixels.fill(0xff000000);
  }
}
