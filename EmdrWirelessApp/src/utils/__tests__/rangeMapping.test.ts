import {
  intensityUserToFirmware,
  intensityFirmwareToUser,
  INTENSITY_FIRMWARE_MIN,
  INTENSITY_FIRMWARE_MAX,
  INTENSITY_USER_MIN,
  INTENSITY_USER_MAX,
  fullDelayUserToMs,
  fullDelayMsToUser,
  FULL_DELAY_FIRMWARE_MIN,
  FULL_DELAY_FIRMWARE_MAX,
  FULL_DELAY_USER_MIN,
  FULL_DELAY_USER_MAX,
  motorDelayUserToMs,
  motorDelayMsToUser,
  MOTOR_DELAY_FIRMWARE_MIN,
  MOTOR_DELAY_FIRMWARE_MAX,
  MOTOR_DELAY_USER_MIN,
  MOTOR_DELAY_USER_MAX,
  clamp,
} from '../rangeMapping';

describe('clamp', () => {
  test('passes values already inside the range through unchanged', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  test('clamps below the minimum and above the maximum', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe('pulsator intensity mapping', () => {
  test('maps the user range endpoints onto the exact firmware range endpoints', () => {
    expect(intensityUserToFirmware(INTENSITY_USER_MIN)).toBe(INTENSITY_FIRMWARE_MIN);
    expect(intensityUserToFirmware(INTENSITY_USER_MAX)).toBe(INTENSITY_FIRMWARE_MAX);
  });

  test('maps the firmware range endpoints back onto the exact user range endpoints', () => {
    expect(intensityFirmwareToUser(INTENSITY_FIRMWARE_MIN)).toBe(INTENSITY_USER_MIN);
    expect(intensityFirmwareToUser(INTENSITY_FIRMWARE_MAX)).toBe(INTENSITY_USER_MAX);
  });

  test('is monotonically increasing across the whole user range', () => {
    let previous = -Infinity;
    for (let level = INTENSITY_USER_MIN; level <= INTENSITY_USER_MAX; level++) {
      const firmwareValue = intensityUserToFirmware(level);
      expect(firmwareValue).toBeGreaterThanOrEqual(previous);
      previous = firmwareValue;
    }
  });

  test('never produces a firmware value outside the validated 40-200 range', () => {
    for (let level = INTENSITY_USER_MIN; level <= INTENSITY_USER_MAX; level++) {
      const firmwareValue = intensityUserToFirmware(level);
      expect(firmwareValue).toBeGreaterThanOrEqual(INTENSITY_FIRMWARE_MIN);
      expect(firmwareValue).toBeLessThanOrEqual(INTENSITY_FIRMWARE_MAX);
    }
  });
});

describe('full delay (Light Bar enabled)', () => {
  test('user range is 1-17 at the firmware-validated 20-100ms step-5 range', () => {
    expect(FULL_DELAY_USER_MIN).toBe(1);
    expect(FULL_DELAY_USER_MAX).toBe(17);
  });

  test('maps the user range endpoints onto the exact firmware range endpoints', () => {
    expect(fullDelayUserToMs(FULL_DELAY_USER_MIN)).toBe(FULL_DELAY_FIRMWARE_MIN);
    expect(fullDelayUserToMs(FULL_DELAY_USER_MAX)).toBe(FULL_DELAY_FIRMWARE_MAX);
  });

  test('maps the firmware range endpoints back onto the exact user range endpoints', () => {
    expect(fullDelayMsToUser(FULL_DELAY_FIRMWARE_MIN)).toBe(FULL_DELAY_USER_MIN);
    expect(fullDelayMsToUser(FULL_DELAY_FIRMWARE_MAX)).toBe(FULL_DELAY_USER_MAX);
  });

  test('every level produces a firmware-valid multiple of 5 inside 20-100ms', () => {
    for (let level = FULL_DELAY_USER_MIN; level <= FULL_DELAY_USER_MAX; level++) {
      const ms = fullDelayUserToMs(level);
      expect(ms % 5).toBe(0);
      expect(ms).toBeGreaterThanOrEqual(FULL_DELAY_FIRMWARE_MIN);
      expect(ms).toBeLessThanOrEqual(FULL_DELAY_FIRMWARE_MAX);
    }
  });

  test('user level and ms value are inverses at every step', () => {
    for (let level = FULL_DELAY_USER_MIN; level <= FULL_DELAY_USER_MAX; level++) {
      expect(fullDelayMsToUser(fullDelayUserToMs(level))).toBe(level);
    }
  });

  test('clamps out-of-range levels', () => {
    expect(fullDelayUserToMs(0)).toBe(FULL_DELAY_FIRMWARE_MIN);
    expect(fullDelayUserToMs(999)).toBe(FULL_DELAY_FIRMWARE_MAX);
  });
});

describe('motor delay (pulsators only, no Light Bar)', () => {
  test('user range is 1-14 at the 200-1500ms step-100 range', () => {
    expect(MOTOR_DELAY_USER_MIN).toBe(1);
    expect(MOTOR_DELAY_USER_MAX).toBe(14);
  });

  test('maps the user range endpoints onto the exact ms range endpoints', () => {
    expect(motorDelayUserToMs(MOTOR_DELAY_USER_MIN)).toBe(MOTOR_DELAY_FIRMWARE_MIN);
    expect(motorDelayUserToMs(MOTOR_DELAY_USER_MAX)).toBe(MOTOR_DELAY_FIRMWARE_MAX);
  });

  test('maps the ms range endpoints back onto the exact user range endpoints', () => {
    expect(motorDelayMsToUser(MOTOR_DELAY_FIRMWARE_MIN)).toBe(MOTOR_DELAY_USER_MIN);
    expect(motorDelayMsToUser(MOTOR_DELAY_FIRMWARE_MAX)).toBe(MOTOR_DELAY_USER_MAX);
  });

  test('every level produces a multiple of 100ms inside 200-1500ms', () => {
    for (let level = MOTOR_DELAY_USER_MIN; level <= MOTOR_DELAY_USER_MAX; level++) {
      const ms = motorDelayUserToMs(level);
      expect(ms % 100).toBe(0);
      expect(ms).toBeGreaterThanOrEqual(MOTOR_DELAY_FIRMWARE_MIN);
      expect(ms).toBeLessThanOrEqual(MOTOR_DELAY_FIRMWARE_MAX);
    }
  });

  test('user level and ms value are inverses at every step', () => {
    for (let level = MOTOR_DELAY_USER_MIN; level <= MOTOR_DELAY_USER_MAX; level++) {
      expect(motorDelayMsToUser(motorDelayUserToMs(level))).toBe(level);
    }
  });

  test('clamps out-of-range levels', () => {
    expect(motorDelayUserToMs(0)).toBe(MOTOR_DELAY_FIRMWARE_MIN);
    expect(motorDelayUserToMs(999)).toBe(MOTOR_DELAY_FIRMWARE_MAX);
  });
});
