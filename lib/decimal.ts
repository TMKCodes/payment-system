type ParsedDecimal = { digits: bigint; scale: number };

function parseDecimalToBigInt(value: string): ParsedDecimal | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(",", ".");
  if (!/^(?:\d+)(?:\.\d+)?$/.test(normalized)) return null;

  const [whole, fractional = ""] = normalized.split(".");
  const scale = fractional.length;
  const digitsStr = `${whole}${fractional}`.replace(/^0+(?=\d)/, "");
  const safeDigitsStr = digitsStr.length === 0 ? "0" : digitsStr;
  return { digits: BigInt(safeDigitsStr), scale };
}

function formatScaledBigInt(value: bigint, scale: number): string {
  if (scale <= 0) return value.toString();

  const negative = value < 0n;
  const abs = negative ? -value : value;
  const raw = abs.toString();
  const padded = raw.padStart(scale + 1, "0");
  const whole = padded.slice(0, -scale);
  const fractional = padded.slice(-scale).replace(/0+$/, "");
  const result = fractional.length > 0 ? `${whole}.${fractional}` : whole;
  return negative ? `-${result}` : result;
}

/**
 * Computes numerator/denominator and returns a decimal string with outScale fractional digits.
 * Input strings must be non-negative decimals ("12", "12.34").
 */
export function divideDecimalStrings(numerator: string, denominator: string, outScale: number): string {
  const numeratorParsed = parseDecimalToBigInt(numerator);
  const denominatorParsed = parseDecimalToBigInt(denominator);
  if (!numeratorParsed || !denominatorParsed) {
    throw new Error("Invalid decimal input");
  }
  if (denominatorParsed.digits === 0n) {
    throw new Error("Division by zero");
  }

  // (N / 10^nScale) / (D / 10^dScale) = (N * 10^dScale) / (D * 10^nScale)
  // then scale output by outScale decimal places:
  // resultScaled = (N * 10^(dScale + outScale)) / (D * 10^nScale)
  const numeratorScaleFactor = BigInt(denominatorParsed.scale + outScale);
  const denominatorScaleFactor = BigInt(numeratorParsed.scale);

  const scaledNumerator = numeratorParsed.digits * 10n ** numeratorScaleFactor;
  const scaledDenominator = denominatorParsed.digits * 10n ** denominatorScaleFactor;

  // round half up
  const rounded = (scaledNumerator + scaledDenominator / 2n) / scaledDenominator;
  return formatScaledBigInt(rounded, outScale);
}
