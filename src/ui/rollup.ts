/**
 * Counter roll-up.
 *
 * Eases the displayed value toward the truth so the wallet ticks instead of
 * snapping, and converges *exactly* so a settled counter writes nothing to the
 * DOM.
 *
 * It closes a fraction of the remaining gap per unit time rather than running a
 * fixed from/to tween. That matters because the wallet's target is not a series
 * of discrete jumps: the moment the player owns one agent, idle income moves it
 * on *every* frame. A tween that restarts its clock whenever the target changes
 * never gets past its own first step under those conditions — the display just
 * freezes on whatever it happened to be showing.
 */
/** Gap fraction closed per `durationMs`: e^-3, so ~95% inside the window. */
const RATE = 3;

export class RollUp {
  private display = 0;
  private last = 0;
  private primed = false;

  constructor(private readonly durationMs = 250) {}

  /** Feed the truth, get the value to render. */
  step(target: number, now: number): number {
    if (!Number.isFinite(target)) return this.display;
    if (!this.primed) {
      // First observation snaps: no "count up from zero" on mount.
      this.primed = true;
      this.display = target;
      this.last = now;
      return target;
    }
    const dt = Math.max(0, now - this.last);
    this.last = now;
    if (this.display === target) return this.display;

    const k = this.durationMs > 0 ? Math.min(1, (dt / this.durationMs) * RATE) : 1;
    this.display += (target - this.display) * k;
    // Settle exactly rather than asymptotically, or the counter keeps writing
    // imperceptibly different strings forever.
    if (Math.abs(target - this.display) <= Math.max(1e-6, Math.abs(target) * 1e-9)) {
      this.display = target;
    }
    return this.display;
  }

  /** Jump straight to a value (new run, screen change). */
  snap(v: number): void {
    this.primed = true;
    this.display = v;
  }

  /** Forget the primed state so the next `step()` snaps again. */
  reset(): void {
    this.primed = false;
  }

  get value(): number {
    return this.display;
  }
}
