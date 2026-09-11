import { bleService } from './BleService';
import { cycleMsToPerLedDelayMs } from '../utils/rangeMapping';

export interface SessionConfig {
  pulsatorsEnabled: boolean;
  lightBarEnabled: boolean;
  cycleMs: number; // full round-trip sweep time - only meaningful when lightBarEnabled
  pulsatorOnlyDelayMs: number; // only meaningful when pulsators run without the light bar
  color: { r: number; g: number; b: number };
}

// How often to re-nudge the Light Bar's phase back toward the app's own timing
// model (see project notes on drift correction) while a session is running.
const LED_RESYNC_INTERVAL_MS = 20000;

// The app is the clock: the Light Bar free-runs its own sweep locally (see
// Light Bar/main/main.ino), and this engine computes the same crossing points
// from the identical parameters, firing live on/off writes to the pulsators at
// each crossing. The pulsators have no local timer of their own any more (see
// Pulsators/main/main.ino) - every buzz is a direct, immediate command from here.
class StimulationEngine {
  private alternateTimer: ReturnType<typeof setInterval> | null = null;
  private resyncTimer: ReturnType<typeof setInterval> | null = null;
  private activeSide: 1 | 2 = 1;
  private running = false;

  isRunning(): boolean {
    return this.running;
  }

  async start(config: SessionConfig): Promise<void> {
    this.clearTimers();
    this.running = true;

    if (config.lightBarEnabled) {
      const perLedDelayMs = cycleMsToPerLedDelayMs(config.cycleMs);
      await bleService.writeLedDelay(perLedDelayMs);
      await bleService.writeLedColor(config.color.r, config.color.g, config.color.b);
      await bleService.writeLedState(true);

      this.resyncTimer = setInterval(() => {
        bleService.pingLedSync().catch(() => {});
      }, LED_RESYNC_INTERVAL_MS);
    }

    if (config.pulsatorsEnabled) {
      // Mid-crossing happens twice per round trip (once each direction), each
      // a quarter of the way into the cycle - see project notes on the sync model.
      const alternationPeriodMs = config.lightBarEnabled
        ? config.cycleMs / 4
        : config.pulsatorOnlyDelayMs;

      this.activeSide = 1;
      await this.fireAlternation();
      this.alternateTimer = setInterval(() => {
        this.fireAlternation().catch(() => {});
      }, alternationPeriodMs);
    }
  }

  async stop(): Promise<void> {
    this.clearTimers();
    this.running = false;
    await Promise.all([
      bleService.writeMotorState('pulsator1', false),
      bleService.writeMotorState('pulsator2', false),
      bleService.writeLedState(false),
    ]);
  }

  // Live changes while a session is running (intensity/color apply instantly on
  // the firmware side already - see MotorIntensityCallback/LedColorCallback).
  async setIntensity(firmwareValue: number): Promise<void> {
    await Promise.all([
      bleService.writeMotorIntensity('pulsator1', firmwareValue),
      bleService.writeMotorIntensity('pulsator2', firmwareValue),
    ]);
  }

  async setColor(r: number, g: number, b: number): Promise<void> {
    await bleService.writeLedColor(r, g, b);
  }

  // Timing (cycle time / pulsator delay) changes the alternation cadence itself,
  // so re-arm the timers against the new config rather than patching in place.
  async updateTiming(config: SessionConfig): Promise<void> {
    if (!this.running) return;
    await this.start(config);
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
