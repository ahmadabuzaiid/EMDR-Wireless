import { bleService } from './index';

export interface SessionConfig {
  pulsatorsEnabled: boolean;
  lightBarEnabled: boolean;
  fullDelayMs: number; // per-LED step delay sent straight to the Light Bar - only meaningful when lightBarEnabled
  pulsatorOnlyDelayMs: number; // only meaningful when pulsators run without the light bar
  color: { r: number; g: number; b: number };
  ledCount: number; // app-side setting (Settings screen) - must match the physical strip
}

// How often to re-nudge the Light Bar's phase back toward the app's own timing
// model (see project notes on drift correction) while a session is running.
const LED_RESYNC_INTERVAL_MS = 20000;

// The app is the clock: the Light Bar free-runs its own sweep locally (see
// Light Bar/main/main.ino), and this engine computes the same crossing points
// from the identical parameters, firing live on/off writes to the pulsators at
// each crossing. The pulsators have no local timer of their own any more (see
// Pulsators/main/main.ino) - every buzz is a direct, immediate command from here.
//
// Every public method below is resilient by design: a single BLE write failing
// (disconnected mid-session, a GATT hiccup, etc.) must never leave the engine's
// timers running against a half-applied config, and must never prevent the rest
// of the sequence (or the caller's own state, e.g. React's "running" flag) from
// completing. Failures are collected and returned instead of thrown, so callers
// can surface them to the user instead of the UI silently getting stuck.
class StimulationEngine {
  private alternateTimer: ReturnType<typeof setInterval> | null = null;
  private resyncTimer: ReturnType<typeof setInterval> | null = null;
  private activeSide: 1 | 2 = 1;
  private running = false;

  // Bumped by every start()/stop() call, and checked after each await inside
  // start(). start() does several awaited BLE writes before it creates its
  // timers - if a second start() (or a stop()) begins while an earlier one is
  // still mid-flight, without this guard both calls would eventually create
  // their own resyncTimer/alternateTimer, and the second assignment would
  // silently overwrite the first *without clearing it* - leaking a timer that
  // stop()'s clearTimers() can no longer reach (it only ever sees whichever
  // one is currently assigned). A superseded call now bails out as soon as it
  // notices, before it can create anything or apply stale values.
  private generation = 0;

  isRunning(): boolean {
    return this.running;
  }

  async start(config: SessionConfig): Promise<string[]> {
    this.clearTimers();
    this.running = true;
    const myGeneration = ++this.generation;
    const errors: string[] = [];
    const superseded = () => this.generation !== myGeneration;

    if (config.lightBarEnabled) {
      await this.safe(errors, 'set light delay', () => bleService.writeLedDelay(config.fullDelayMs));
      await this.safe(errors, 'set light color', () =>
        bleService.writeLedColor(config.color.r, config.color.g, config.color.b),
      );
      await this.safe(errors, 'turn light on', () => bleService.writeLedState(true));
      if (superseded()) return errors;

      this.resyncTimer = setInterval(() => {
        bleService.pingLedSync().catch(err => console.warn('[StimulationEngine] LED sync ping failed:', err));
      }, LED_RESYNC_INTERVAL_MS);
    }

    if (config.pulsatorsEnabled) {
      // With the Light Bar enabled, each pulsator should switch exactly when the
      // sweep reverses direction at either end - i.e. one pulsator on for a full
      // one-way pass, then the other for the return pass. The firmware dwells
      // 2x as long on the two end LEDs specifically so this works out exactly:
      // one-way pass time = fullDelayMs * ledCount (see Light Bar/main/main.ino's
      // update_led_animation()). Without the Light Bar, there's no sweep to key
      // off of, so just alternate on the standalone Motor Delay instead.
      const alternationPeriodMs = config.lightBarEnabled
        ? config.fullDelayMs * config.ledCount
        : config.pulsatorOnlyDelayMs;

      this.activeSide = 1;
      await this.safe(errors, 'start pulsator alternation', () => this.fireAlternation());
      if (superseded()) return errors;

      this.alternateTimer = setInterval(() => {
        this.fireAlternation().catch(err =>
          console.warn('[StimulationEngine] pulsator alternation write failed:', err),
        );
      }, alternationPeriodMs);
    }

    return errors;
  }

  async stop(): Promise<string[]> {
    this.clearTimers();
    this.running = false;
    this.generation++;
    const errors: string[] = [];
    await this.safe(errors, 'stop pulsator 1', () => bleService.writeMotorState('pulsator1', false));
    await this.safe(errors, 'stop pulsator 2', () => bleService.writeMotorState('pulsator2', false));
    await this.safe(errors, 'turn light off', () => bleService.writeLedState(false));
    return errors;
  }

  // Live changes while a session is running (intensity/color apply instantly on
  // the firmware side already - see MotorIntensityCallback/LedColorCallback).
  async setIntensity(firmwareValue: number): Promise<string[]> {
    const errors: string[] = [];
    await this.safe(errors, 'set pulsator 1 intensity', () =>
      bleService.writeMotorIntensity('pulsator1', firmwareValue),
    );
    await this.safe(errors, 'set pulsator 2 intensity', () =>
      bleService.writeMotorIntensity('pulsator2', firmwareValue),
    );
    return errors;
  }

  async setColor(r: number, g: number, b: number): Promise<string[]> {
    const errors: string[] = [];
    await this.safe(errors, 'set light color', () => bleService.writeLedColor(r, g, b));
    return errors;
  }

  // Timing (cycle time / pulsator delay) changes the alternation cadence itself,
  // so re-arm the timers against the new config rather than patching in place.
  async updateTiming(config: SessionConfig): Promise<string[]> {
    if (!this.running) return [];
    return this.start(config);
  }

  private async fireAlternation(): Promise<void> {
    const onRole = this.activeSide === 1 ? 'pulsator1' : 'pulsator2';
    const offRole = this.activeSide === 1 ? 'pulsator2' : 'pulsator1';
    this.activeSide = this.activeSide === 1 ? 2 : 1;
    await Promise.all([
      bleService.writeMotorState(onRole, true),
      bleService.writeMotorState(offRole, false),
    ]);
  }

  private async safe(errors: string[], label: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[StimulationEngine] ${label} failed:`, message);
      errors.push(`${label}: ${message}`);
    }
  }

  private clearTimers(): void {
    if (this.alternateTimer) {
      clearInterval(this.alternateTimer);
      this.alternateTimer = null;
    }
    if (this.resyncTimer) {
      clearInterval(this.resyncTimer);
      this.resyncTimer = null;
    }
  }
}

export const stimulationEngine = new StimulationEngine();
