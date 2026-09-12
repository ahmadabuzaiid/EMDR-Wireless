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

// --- LED count setting --------------------------------------------------------
// ledCount is a runtime app SETTING (Settings screen, persisted), not a firmware
// constant - firmware's own LED_COUNT is a compile-time array size it can't report
// back. It's used below to convert Full Delay into the pulsator alternation
// period, so this only works correctly if the setting matches the physical strip
// length. DEFAULT_LED_COUNT matches the real Light Bar's current firmware default.
export const DEFAULT_LED_COUNT = 20;
export const LED_COUNT_MIN = 2;
export const LED_COUNT_MAX = 120;

// --- Full Delay (Light Bar enabled) -------------------------------------------
// The app drives the Light Bar's LED_DELAY characteristic directly with this value -
// the duration a single LED stays lit before the sweep advances one step,
// firmware-validated 20-100ms, multiples of 5 only (Light Bar/main/main.ino). Shown
// to the user as whole levels (1-N, step 1), same style as Pulsator Intensity,
// rather than the raw millisecond value.
export const FULL_DELAY_FIRMWARE_MIN = 20;
export const FULL_DELAY_FIRMWARE_MAX = 100;
export const FULL_DELAY_STEP_MS = 5;
export const FULL_DELAY_USER_MIN = 1;
export const FULL_DELAY_USER_MAX =
  (FULL_DELAY_FIRMWARE_MAX - FULL_DELAY_FIRMWARE_MIN) / FULL_DELAY_STEP_MS + FULL_DELAY_USER_MIN;

export function fullDelayUserToMs(level: number): number {
  const clampedLevel = clamp(Math.round(level), FULL_DELAY_USER_MIN, FULL_DELAY_USER_MAX);
  return FULL_DELAY_FIRMWARE_MIN + (clampedLevel - FULL_DELAY_USER_MIN) * FULL_DELAY_STEP_MS;
}

export function fullDelayMsToUser(delayMs: number): number {
  const level =
    Math.round((delayMs - FULL_DELAY_FIRMWARE_MIN) / FULL_DELAY_STEP_MS) + FULL_DELAY_USER_MIN;
  return clamp(level, FULL_DELAY_USER_MIN, FULL_DELAY_USER_MAX);
}

// --- Motor Delay (pulsators only, no Light Bar) -------------------------------
// No firmware characteristic constrains this any more (the pulsators are purely
// reactive - see Pulsators/main/main.ino) - it's the duration of each on/off phase
// the app alternates the two pulsators on, enforced app-side only. Also shown as
// whole levels (1-N, step 1) rather than the raw millisecond value.
export const MOTOR_DELAY_FIRMWARE_MIN = 200;
export const MOTOR_DELAY_FIRMWARE_MAX = 1500;
export const MOTOR_DELAY_STEP_MS = 100;
export const MOTOR_DELAY_USER_MIN = 1;
export const MOTOR_DELAY_USER_MAX =
  (MOTOR_DELAY_FIRMWARE_MAX - MOTOR_DELAY_FIRMWARE_MIN) / MOTOR_DELAY_STEP_MS + MOTOR_DELAY_USER_MIN;

export function motorDelayUserToMs(level: number): number {
  const clampedLevel = clamp(Math.round(level), MOTOR_DELAY_USER_MIN, MOTOR_DELAY_USER_MAX);
  return MOTOR_DELAY_FIRMWARE_MIN + (clampedLevel - MOTOR_DELAY_USER_MIN) * MOTOR_DELAY_STEP_MS;
}

export function motorDelayMsToUser(delayMs: number): number {
  const level =
    Math.round((delayMs - MOTOR_DELAY_FIRMWARE_MIN) / MOTOR_DELAY_STEP_MS) + MOTOR_DELAY_USER_MIN;
  return clamp(level, MOTOR_DELAY_USER_MIN, MOTOR_DELAY_USER_MAX);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
