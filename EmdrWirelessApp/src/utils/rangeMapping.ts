// Maps the user-facing slider ranges (friendly numbers) to the real values the
// firmware/protocol actually needs, and back. Keeping this in one place means
// the screen components never have to know about the underlying firmware ranges.

// --- Pulsator intensity -----------------------------------------------------
// Firmware-validated PWM range (Pulsators/main/main.ino, MotorIntensityCallback): 40-200.
// Shown to the user as 16 whole levels (1-16, step 1) rather than the raw PWM range.
export const INTENSITY_FIRMWARE_MIN = 40;
export const INTENSITY_FIRMWARE_MAX = 200;
export const INTENSITY_USER_MIN = 1;
export const INTENSITY_USER_MAX = 16;

export function intensityUserToFirmware(userValue: number): number {
  const ratio =
    (userValue - INTENSITY_USER_MIN) / (INTENSITY_USER_MAX - INTENSITY_USER_MIN);
  const raw =
    INTENSITY_FIRMWARE_MIN + ratio * (INTENSITY_FIRMWARE_MAX - INTENSITY_FIRMWARE_MIN);
  return Math.round(clamp(raw, INTENSITY_FIRMWARE_MIN, INTENSITY_FIRMWARE_MAX));
}

export function intensityFirmwareToUser(firmwareValue: number): number {
  const ratio =
    (firmwareValue - INTENSITY_FIRMWARE_MIN) / (INTENSITY_FIRMWARE_MAX - INTENSITY_FIRMWARE_MIN);
  const raw = INTENSITY_USER_MIN + ratio * (INTENSITY_USER_MAX - INTENSITY_USER_MIN);
  return Math.round(clamp(raw, INTENSITY_USER_MIN, INTENSITY_USER_MAX));
}

// --- Light bar cycle time ----------------------------------------------------
// The app drives the Light Bar's LED_DELAY characteristic (single-LED step delay,
// firmware-validated 5-75ms, multiples of 5 only - Light Bar/main/main.ino).
// The user instead dials in the full round-trip sweep time (LED crosses right,
// then back left): cycle = 2 * (LED_COUNT - 1) * perLedDelay.
export const LED_COUNT = 20;
const CYCLE_STEPS = 2 * (LED_COUNT - 1); // 38 - one full sweep out and back
export const PER_LED_DELAY_MIN_MS = 5;
export const PER_LED_DELAY_MAX_MS = 75;
export const PER_LED_DELAY_STEP_MS = 5;

export const CYCLE_MS_MIN = CYCLE_STEPS * PER_LED_DELAY_MIN_MS; // 190
export const CYCLE_MS_MAX = CYCLE_STEPS * PER_LED_DELAY_MAX_MS; // 2850

// Slider itself works in whole seconds-with-decimals for a smooth drag feel;
// the firmware only accepts 5ms-multiple per-LED delays, so snap at apply time.
export function cycleMsToPerLedDelayMs(cycleMs: number): number {
  const rawPerLed = cycleMs / CYCLE_STEPS;
  const snapped = Math.round(rawPerLed / PER_LED_DELAY_STEP_MS) * PER_LED_DELAY_STEP_MS;
  return clamp(snapped, PER_LED_DELAY_MIN_MS, PER_LED_DELAY_MAX_MS);
}

export function perLedDelayMsToCycleMs(perLedDelayMs: number): number {
  return perLedDelayMs * CYCLE_STEPS;
}

// --- Pulsator-only delay (no Light Bar connected) ---------------------------
// No firmware characteristic constrains this any more (the pulsators are purely
// reactive - see Pulsators/main/main.ino). This range carries over the bounds the
// old MOTOR_DELAY_CHARACTERISTIC used to validate, now enforced app-side only:
// it's the duration of each on/off phase the app alternates the two pulsators on.
export const PULSATOR_DELAY_MIN_MS = 100;
export const PULSATOR_DELAY_MAX_MS = 1500;
export const PULSATOR_DELAY_STEP_MS = 5;

export function snapPulsatorDelayMs(delayMs: number): number {
  const snapped = Math.round(delayMs / PULSATOR_DELAY_STEP_MS) * PULSATOR_DELAY_STEP_MS;
  return clamp(snapped, PULSATOR_DELAY_MIN_MS, PULSATOR_DELAY_MAX_MS);
}

// --- Shared formatting --------------------------------------------------------
export function msToSecondsLabel(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
