/**
 * Money handling — all monetary values are integers in poisha (1 BDT = 100 poisha).
 * No floating-point arithmetic is ever used to derive stored monetary values.
 */

export type Poisha = number;

export const POISHA_PER_BDT = 100;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

const POISHA_RE = /^-?\d{1,15}$/;

/**
 * Parse user input ("1234.56", "1,234.5", "৳ 1234", "1234") into integer poisha.
 * Throws on invalid input. Never uses float multiplication.
 */
export function parseMoneyToPoisha(input: string): Poisha {
  const cleaned = input.replace(/[৳,\s]/g, '');
  if (cleaned === '') throw new MoneyError('Amount is required');
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) throw new MoneyError(`Invalid amount: ${input}`);
  const sign = m[1] === '-' ? -1 : 1;
  const whole = m[2] as string;
  const frac = (m[3] ?? '').padEnd(2, '0');
  const total = `${whole}${frac}`;
  if (!POISHA_RE.test(total)) throw new MoneyError(`Amount out of range: ${input}`);
  const value = Number(total);
  if (!Number.isSafeInteger(value)) throw new MoneyError(`Amount out of range: ${input}`);
  return sign * value;
}

/** Parse a decimal string from config/CSV (exact 0–2 decimals) into poisha. */
export function decimalStringToPoisha(input: string): Poisha {
  return parseMoneyToPoisha(input);
}

/** Convert whole BDT (integer) to poisha. */
export function bdtToPoisha(bdt: number): Poisha {
  if (!Number.isSafeInteger(bdt)) throw new MoneyError('BDT amount must be an integer');
  return bdt * POISHA_PER_BDT;
}

/** Sum poisha values safely. */
export function sumPoisha(values: readonly Poisha[]): Poisha {
  let total = 0;
  for (const v of values) {
    if (!Number.isSafeInteger(v)) throw new MoneyError('Non-integer poisha value');
    total += v;
  }
  if (!Number.isSafeInteger(total)) throw new MoneyError('Sum overflow');
  return total;
}

/**
 * Percentage discount in poisha: floor to nearest poisha using integer ops.
 * e.g. applyPercentPoisha(100000, 15) === 15000
 */
export function applyPercentPoisha(base: Poisha, percent: number): Poisha {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new MoneyError(`Percent out of range: ${percent}`);
  }
  // Represent percent with 2 decimal digits of precision, all integer math.
  const scaled = Math.round(percent * 100); // basis points-ish (1/10000)
  const product = base * scaled;
  if (!Number.isSafeInteger(product)) throw new MoneyError('Discount calculation overflow');
  return Math.floor(product / 10_000);
}

/** Split a poisha total into n equal parts with deterministic remainder distribution. */
export function splitPoisha(total: Poisha, n: number): Poisha[] {
  if (!Number.isSafeInteger(n) || n <= 0) throw new MoneyError('Split count must be positive');
  const base = Math.floor(total / n);
  const rem = total - base * n;
  const out: Poisha[] = new Array(n).fill(base);
  for (let i = 0; i < rem; i++) out[i] = (out[i] as Poisha) + 1;
  return out;
}

export interface FormatPoishaOptions {
  /** Show the ৳ symbol (default true). */
  symbol?: boolean;
  /** Show decimal places even when .00 (default true). */
  alwaysDecimals?: boolean;
}

/**
 * Format poisha for display: ৳1,23,456.78 (Bangladeshi lakh grouping).
 */
export function formatPoisha(poisha: Poisha, opts: FormatPoishaOptions = {}): string {
  const { symbol = true, alwaysDecimals = true } = opts;
  if (!Number.isSafeInteger(poisha)) throw new MoneyError('Non-integer poisha value');
  const negative = poisha < 0;
  const abs = Math.abs(poisha);
  const whole = Math.floor(abs / POISHA_PER_BDT);
  const frac = abs % POISHA_PER_BDT;
  let grouped: string;
  if (whole < 1000) {
    grouped = String(whole);
  } else {
    const last3 = String(whole % 1000).padStart(3, '0');
    const rest = Math.floor(whole / 1000);
    if (rest < 100) {
      grouped = `${rest},${last3}`;
    } else {
      const last2 = String(rest % 100).padStart(2, '0');
      const head = Math.floor(rest / 100);
      grouped = `${groupWithCommas(head)},${last2},${last3}`;
    }
  }
  const dec = alwaysDecimals || frac !== 0 ? `.${String(frac).padStart(2, '0')}` : '';
  const body = `${grouped}${dec}`;
  return `${negative ? '-' : ''}${symbol ? '৳' : ''}${body}`;
}

function groupWithCommas(n: number): string {
  const s = String(n);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const fromEnd = s.length - i;
    out += s[i];
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) out += ',';
  }
  return out;
}

/** Parse a money string into a number of BDT for chart axis labels only (display, never storage). */
export function poishaToBdtNumber(poisha: Poisha): number {
  return poisha / POISHA_PER_BDT;
}
