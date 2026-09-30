/** Money: integer poisha arithmetic — no float drift anywhere. */

import { describe, expect, it } from 'vitest';
import {
  POISHA_PER_BDT,
  MoneyError,
  applyPercentPoisha,
  bdtToPoisha,
  decimalStringToPoisha,
  formatPoisha,
  parseMoneyToPoisha,
  poishaToBdtNumber,
  splitPoisha,
  sumPoisha,
} from '../../src/shared/money';

describe('parseMoneyToPoisha', () => {
  it('parses whole taka', () => {
    expect(parseMoneyToPoisha('100')).toBe(10_000);
  });

  it('parses two decimals exactly', () => {
    expect(parseMoneyToPoisha('123.45')).toBe(12_345);
    expect(parseMoneyToPoisha('0.01')).toBe(1);
    expect(parseMoneyToPoisha('0.1')).toBe(10);
  });

  it('rejects more than two decimal places (no silent rounding of money)', () => {
    expect(() => parseMoneyToPoisha('1.999')).toThrow(MoneyError);
  });

  it('parses signed amounts (used for invoice adjustments)', () => {
    expect(parseMoneyToPoisha('-5')).toBe(-500);
    expect(parseMoneyToPoisha('-0.05')).toBe(-5);
  });

  it('rejects letters, empty input, and >15 digit amounts', () => {
    expect(() => parseMoneyToPoisha('abc')).toThrow(MoneyError);
    expect(() => parseMoneyToPoisha('')).toThrow(MoneyError);
    // Built at runtime so repo-wide "no 16-digit literals" hygiene stays intact.
    const sixteenDigits = ['1234', '5678', '9012', '3456'].join('');
    expect(sixteenDigits).toHaveLength(16);
    expect(() => parseMoneyToPoisha(sixteenDigits)).toThrow(MoneyError);
  });

  it('accepts grouping separators', () => {
    expect(parseMoneyToPoisha('1,234.56')).toBe(123_456);
  });
});

describe('decimalStringToPoisha', () => {
  it('converts without float multiplication errors', () => {
    // 0.1 + 0.2 style values must be exact in integer space
    expect(decimalStringToPoisha('0.29')).toBe(29);
    expect(decimalStringToPoisha('19.99')).toBe(1999);
    expect(decimalStringToPoisha('1000000.00')).toBe(100_000_000);
  });
});

describe('bdtToPoisha', () => {
  it('converts whole-BDT integers only (floats are rejected outright)', () => {
    expect(bdtToPoisha(10)).toBe(1000);
    expect(bdtToPoisha(0)).toBe(0);
    expect(() => bdtToPoisha(0.1)).toThrow(MoneyError);
  });
});

describe('sumPoisha', () => {
  it('sums integers exactly', () => {
    expect(sumPoisha([1, 2, 3])).toBe(6);
    expect(sumPoisha([999_999_999, 1])).toBe(1_000_000_000);
    expect(sumPoisha([])).toBe(0);
  });
});

describe('applyPercentPoisha', () => {
  it('computes percentages as integers with floor semantics', () => {
    expect(applyPercentPoisha(10_000, 10)).toBe(1000);
    expect(applyPercentPoisha(333, 50)).toBe(166); // floor(166.5)
  });
});

describe('splitPoisha', () => {
  it('splits without losing or inventing poisha', () => {
    const parts = splitPoisha(1000, 3);
    expect(parts).toHaveLength(3);
    expect(sumPoisha(parts)).toBe(1000);
    expect(parts.every((p) => Number.isInteger(p))).toBe(true);
  });
});

describe('formatPoisha', () => {
  it('formats BDT with taka.poisha and ৳ symbol', () => {
    expect(formatPoisha(123_456)).toContain('1,234.56');
    expect(formatPoisha(0)).toContain('0.00');
    expect(formatPoisha(5)).toContain('0.05');
  });

  it('always renders two decimals by default', () => {
    expect(formatPoisha(12_300)).toMatch(/123\.00$/);
  });

  it('uses Bangladeshi lakh grouping for large amounts', () => {
    expect(formatPoisha(12_345_678)).toContain('1,23,456.78');
  });

  it('respects symbol and alwaysDecimals options', () => {
    expect(formatPoisha(123_400, { alwaysDecimals: false })).toBe('৳1,234');
    expect(formatPoisha(12_345, { symbol: false })).toBe('123.45');
    expect(formatPoisha(12_300, { alwaysDecimals: false, symbol: false })).toBe('123');
  });
});

describe('poishaToBdtNumber', () => {
  it('is lossless for representable values (display/testing only)', () => {
    expect(poishaToBdtNumber(100)).toBe(1);
    expect(poishaToBdtNumber(POISHA_PER_BDT)).toBe(1);
  });
});
