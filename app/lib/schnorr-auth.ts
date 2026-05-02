import { createHash } from "crypto";
import { HoosatCrypto } from "hoosat-sdk";

const P = BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f");
const N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
const GX = BigInt("55066263022277343669578718895168534326250603453777594175500187360389116729240");
const GY = BigInt("32670510020758816978083085130507043184471273380659243275938904335757337482424");

type Point = { x: bigint; y: bigint } | null;

function mod(value: bigint, modulo = P) {
  const result = value % modulo;
  return result >= 0n ? result : result + modulo;
}

function powMod(base: bigint, exponent: bigint, modulo = P) {
  let result = 1n;
  let value = mod(base, modulo);
  let exp = exponent;
  while (exp > 0n) {
    if (exp & 1n) result = mod(result * value, modulo);
    value = mod(value * value, modulo);
    exp >>= 1n;
  }
  return result;
}

function invert(value: bigint, modulo = P) {
  return powMod(value, modulo - 2n, modulo);
}

function liftX(x: bigint): Point {
  if (x >= P) return null;
  const y2 = mod(x ** 3n + 7n);
  const y = powMod(y2, (P + 1n) / 4n);
  if (mod(y * y) !== y2) return null;
  return { x, y: y % 2n === 0n ? y : P - y };
}

function pointAdd(a: Point, b: Point): Point {
  if (!a) return b;
  if (!b) return a;
  if (a.x === b.x && a.y !== b.y) return null;

  const lambda = a.x === b.x && a.y === b.y
    ? mod((3n * a.x * a.x) * invert(2n * a.y))
    : mod((b.y - a.y) * invert(b.x - a.x));
  const x = mod(lambda * lambda - a.x - b.x);
  const y = mod(lambda * (a.x - x) - a.y);
  return { x, y };
}

function pointMultiply(point: Point, scalar: bigint): Point {
  let n = scalar;
  let result: Point = null;
  let addend = point;
  while (n > 0n) {
    if (n & 1n) result = pointAdd(result, addend);
    addend = pointAdd(addend, addend);
    n >>= 1n;
  }
  return result;
}

function hexToBigInt(hex: string) {
  return BigInt(`0x${hex}`);
}

function bytesToBigInt(bytes: Buffer) {
  return hexToBigInt(bytes.toString("hex"));
}

function taggedHash(tag: string, ...messages: Buffer[]) {
  const tagHash = createHash("sha256").update(tag).digest();
  return createHash("sha256").update(tagHash).update(tagHash).update(Buffer.concat(messages)).digest();
}

export function verifyMobileSchnorrAuth(input: {
  address: string;
  messageHashHex: string;
  publicKeyHex: string;
  addressPublicKeyHex?: string;
  signatureHex: string;
}) {
  try {
    const publicKey = Buffer.from(input.publicKeyHex, "hex");
    const messageHash = Buffer.from(input.messageHashHex, "hex");
    const signature = Buffer.from(input.signatureHex, "hex");
    if (publicKey.length !== 32 || messageHash.length !== 32 || signature.length !== 64) {
      return false;
    }

    const addressPublicKey = Buffer.from(input.addressPublicKeyHex ?? input.publicKeyHex, "hex");
    const derivedAddress = addressPublicKey.length === 33
      ? HoosatCrypto.publicKeyToAddressECDSA(addressPublicKey, "mainnet")
      : HoosatCrypto.publicKeyToAddress(addressPublicKey, "mainnet");
    if (derivedAddress !== input.address) {
      return false;
    }

    const r = bytesToBigInt(signature.subarray(0, 32));
    const s = bytesToBigInt(signature.subarray(32, 64));
    if (r >= P || s >= N) return false;

    const pubPoint = liftX(bytesToBigInt(publicKey));
    if (!pubPoint) return false;

    const e = bytesToBigInt(taggedHash("BIP0340/challenge", signature.subarray(0, 32), publicKey, messageHash)) % N;
    const g = { x: GX, y: GY };
    const rPoint = pointAdd(pointMultiply(g, s), pointMultiply(pubPoint, N - e));
    if (!rPoint || rPoint.y % 2n !== 0n || rPoint.x !== r) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
