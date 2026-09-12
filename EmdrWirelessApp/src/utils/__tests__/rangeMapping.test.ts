import {
  intensityUserToFirmware,
  intensityFirmwareToUser,
  INTENSITY_FIRMWARE_MIN,
  INTENSITY_FIRMWARE_MAX,
  INTENSITY_USER_MIN,
  INTENSITY_USER_MAX,
  DEFAULT_LED_COUNT,
  PER_LED_DELAY_MIN_MS,
  PER_LED_DELAY_MAX_MS,
  cycleMsRangeFor,
  cycleMsToPerLedDelayMs,
  perLedDelayMsToCycleMs,
  PULSATOR_DELAY_MIN_MS,
  PULSATOR_DELAY_MAX_MS,
  snapPulsatorDelayMs,
  msToSecondsLabel,
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

describe('light bar cycle time <-> per-LED delay', () => {
  test('cycleMsRangeFor matches the documented 190ms-2850ms range at the default LED count', () => {
    const { min, max } = cycleMsRangeFor(DEFAULT_LED_COUNT);
    expect(min).toBe(190);
    expect(max).toBe(2850);
  });

  test('the range grows with LED count, since more LEDs means a longer sweep at the same per-LED delay', () => {
    const small = cycleMsRangeFor(10);
    const large = cycleMsRangeFor(40);
    expect(large.max).toBeGreaterThan(small.max);
  });

  test('converting the range endpoints back gives exactly the firmware delay endpoints', () => {
    const { min, max } = cycleMsRangeFor(DEFAULT_LED_COUNT);
    expect(cycleMsToPerLedDelayMs(min, DEFAULT_LED_COUNT)).toBe(PER_LED_DELAY_MIN_MS);
    expect(cycleMsToPerLedDelayMs(max, DEFAULT_LED_COUNT)).toBe(PER_LED_DELAY_MAX_MS);
  });

  test('always snaps to a multiple of 5, since the firmware rejects anything else', () => {
    for (let cycleMs = 190; cycleMs <= 2850; cycleMs += 37) {
      const perLed = cycleMsToPerLedDelayMs(cycleMs, DEFAULT_LED_COUNT);
      expect(perLed % 5).toBe(0);
    }
  });

  test('never produces a per-LED delay outside the validated 5-75ms range', () => {
    // deliberately out-of-range cycle values, to exercise the clamp
    expect(cycleMsToPerLedDelayMs(0, DEFAULT_LED_COUNT)).toBe(PER_LED_DELAY_MIN_MS);
    expect(cycleMsToPerLedDelayMs(999999, DEFAULT_LED_COUNT)).toBe(PER_LED_DELAY_MAX_MS);
  });

  test('perLedDelayMsToCycleMs and cycleMsToPerLedDelayMs are inverses at valid 5ms steps', () => {
    for (let perLed = PER_LED_DELAY_MIN_MS; perLed <= PER_LED_DELAY_MAX_MS; perLed += 5) {
      const cycleMs = perLedDelayMsToCycleMs(perLed, DEFAULT_LED_COUNT);
      expect(cycleMsToPerLedDelayMs(cycleMs, DEFAULT_LED_COUNT)).toBe(perLed);
    }
  });
});

describe('pulsator-only delay', () => {
  test('snaps to the nearest multiple of 5', () => {
    expect(snapPulsatorDelayMs(503)).toBe(505);
    expect(snapPulsatorDelayMs(500)).toBe(500);
  });

  test('clamps to the 100-1500ms range', () => {
    expect(snapPulsatorDelayMs(0)).toBe(PULSATOR_DELAY_MIN_MS);
    expect(snapPulsatorDelayMs(999999)).toBe(PULSATOR_DELAY_MAX_MS);
  });
});

describe('msToSecondsLabel', () => {
  test('formats milliseconds as seconds with 2 decimal places', () => {
    expect(msToSecondsLabel(190)).toBe('0.19 s');
    expect(msToSecondsLabel(2850)).toBe('2.85 s');
    expect(msToSecondsLabel(1000)).toBe('1.00 s');
  });
});
