import { rgbToHex, hexToRgb } from '../color';

describe('color conversions', () => {
  test('rgbToHex produces a lowercase 7-character hex string', () => {
    expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
    expect(rgbToHex(0, 255, 0)).toBe('#00ff00');
    expect(rgbToHex(0, 0, 255)).toBe('#0000ff');
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
    expect(rgbToHex(255, 255, 255)).toBe('#ffffff');
  });

  test('pads single-digit hex components with a leading zero', () => {
    expect(rgbToHex(1, 2, 3)).toBe('#010203');
  });

  test('hexToRgb inverts rgbToHex for every channel value', () => {
    for (const value of [0, 1, 42, 128, 254, 255]) {
      const hex = rgbToHex(value, value, value);
      expect(hexToRgb(hex)).toEqual({ r: value, g: value, b: value });
    }
  });

  test('hexToRgb works with or without a leading #', () => {
    expect(hexToRgb('#42a5b3')).toEqual(hexToRgb('42a5b3'));
  });

  test('round-trips arbitrary RGB values', () => {
    const cases: Array<[number, number, number]> = [
      [66, 165, 173],
      [240, 122, 46],
      [0, 0, 0],
      [255, 255, 255],
    ];
    for (const [r, g, b] of cases) {
      expect(hexToRgb(rgbToHex(r, g, b))).toEqual({ r, g, b });
    }
  });
});
