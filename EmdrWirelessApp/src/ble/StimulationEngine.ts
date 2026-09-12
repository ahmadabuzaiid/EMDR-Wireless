import { bleService } from './index';
import { cycleMsToPerLedDelayMs } from '../utils/rangeMapping';

export interface SessionConfig {
  pulsatorsEnabled: boolean;
  lightBarEnabled: boolean;
  cycleMs: number; // full round-trip sweep time - only meaningful when lightBarEnabled
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

  isRunning(): boolean {
    return this.running;
  }

  async start(config: SessionConfig): Promise<string[]> {
    this.clearTimers();
    this.running = true;
    const errors: string[] = [];

    if (config.lightBarEnabled) {
      const perLedDelayMs = cycleMsToPerLedDelayMs(config.cycleMs, config.ledCount);
      await this.safe(errors, 'set light delay', () => bleService.writeLedDelay(perLedDelayMs));
      await this.safe(errors, 'set light color', () =>
        bleService.writeLedColor(config.color.r, config.color.g, config.color.b),
      );
      await this.safe(errors, 'turn light on', () => bleService.writeLedState(true));

      this.resyncTimer = setInterval(() => {
        bleService.pingLedSync().catch(err => console.warn('[StimulationEngine] LED sync ping failed:', err));
      }, LED_RESYNC_INTERVAL_MS);
    }

    if (config.pulsatorsEnabled) {
      // Mid-crossing happens twice per round trip (once each direction), each
      // a quarter of the way into the cycle - see project notes on the sync model.
      const alternationPeriodMs = config.lightBarEnabled
        ? config.cycleMs / 4
        : config.pulsatorOnlyDelayMs;

      this.activeSide = 1;
      await this.safe(errors, 'start pulsator alternation', () => this.fireAlternation());
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
