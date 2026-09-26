export type Width = 8 | 16 | 32 | 64;

const cryptoBitLimit = 8192;
const uint64Max = (1n << 64n) - 1n;
const mrBases = [2n, 325n, 9375n, 28144n, 450775n, 9780504n, 1795265022n];

function abs(value: bigint): bigint {
    return value < 0n ? -value : value;
}

function bitLength(value: bigint): number {
    return abs(value).toString(2).length;
}

function gcd(a: bigint, b: bigint): bigint {
    a = abs(a);
    b = abs(b);
    while (b) [a, b] = [b, a % b];
    return a;
}

function powerMod(base: bigint, exponent: bigint, modulus: bigint): bigint {
    let result = 1n;
    base %= modulus;
    while (exponent > 0n) {
        if (exponent & 1n) result = result * base % modulus;
        base = base * base % modulus;
        exponent >>= 1n;
    }
    return ((result % modulus) + modulus) % modulus;
}

function isPrime(value: bigint): boolean {
    if (value < 2n) return false;
    for (const prime of [2n, 3n, 5n, 7n, 11n, 13n]) {
        if (value === prime) return true;
        if (value % prime === 0n) return false;
    }
    let exponent = value - 1n;
    let oddity = 0n;
    while (exponent % 2n === 0n) {
        exponent >>= 1n;
        oddity++;
    }
    for (const base of mrBases) {
        if (base % value === 0n) continue;
        let test = powerMod(base % value, exponent, value);
        if (test === 1n || test === value - 1n) continue;
        for (let round = 1n; round < oddity; round++) {
            test = test * test % value;
            if (test === value - 1n) break;
        }
        if (test !== value - 1n) return false;
    }
    return true;
}

function pollard(value: bigint): bigint {
    for (let increment = 1n; ; increment++) {
        for (let seed = 2n; seed < 7n; seed++) {
            let tortoise = seed;
            let hare = seed;
            let divisor = 1n;
            while (divisor === 1n) {
                tortoise = (tortoise * tortoise + increment) % value;
                hare = (hare * hare + increment) % value;
                hare = (hare * hare + increment) % value;
                if (tortoise === hare) break;
                divisor = gcd(tortoise > hare ? tortoise - hare : hare - tortoise, value);
            }
            if (divisor > 1n && divisor < value) return divisor;
        }
    }
}

function addFactors(value: bigint, factors: Map<bigint, bigint>): void {
    if (value === 1n) return;
    for (const prime of [2n, 3n, 5n, 7n, 11n, 13n]) {
        while (value % prime === 0n) {
            factors.set(prime, (factors.get(prime) ?? 0n) + 1n);
            value /= prime;
        }
    }
    if (value === 1n) return;
    if (isPrime(value)) {
        factors.set(value, (factors.get(value) ?? 0n) + 1n);
        return;
    }
    const divisor = pollard(value);
    addFactors(divisor, factors);
    addFactors(value / divisor, factors);
}

export function modularExponentiation(base: bigint, exponent: bigint, modulus: bigint): bigint {
    if (modulus === 0n) throw new Error("Modulus must be nonzero");
    if (exponent < 0n) throw new Error("Exponent must be nonnegative");
    if (bitLength(exponent) > cryptoBitLimit) throw new Error(`Exponent must be at most ${cryptoBitLimit} bits`);
    if (bitLength(modulus) > cryptoBitLimit) throw new Error(`Modulus must be at most ${cryptoBitLimit} bits`);
    const size = abs(modulus);
    return powerMod(base, exponent, size);
}

export function modularInverse(value: bigint, modulus: bigint): bigint {
    if (modulus === 0n) throw new Error("Modulus must be nonzero");
    if (bitLength(modulus) > cryptoBitLimit) throw new Error(`Modulus must be at most ${cryptoBitLimit} bits`);
    const size = abs(modulus);
    let remainder = ((value % size) + size) % size;
    let previous = size;
    let coefficient = 1n;
    let previousCoefficient = 0n;
    while (remainder) {
        const quotient = previous / remainder;
        [previous, remainder] = [remainder, previous - quotient * remainder];
        [previousCoefficient, coefficient] = [coefficient, previousCoefficient - quotient * coefficient];
    }
    if (previous !== 1n) throw new Error("The modular inverse does not exist");
    return ((previousCoefficient % size) + size) % size;
}

export function factorize(value: bigint): Array<{ prime: bigint; exponent: bigint }> {
    if (value <= 1n) throw new Error("Expected an integer greater than 1");
    if (value > uint64Max) throw new Error("Value must be at most 2^64 - 1");
    const factors = new Map<bigint, bigint>();
    addFactors(value, factors);
    return [...factors].map(([prime, exponent]) => ({ prime, exponent }))
        .sort((left, right) => left.prime < right.prime ? -1 : left.prime > right.prime ? 1 : 0);
}

export function rotate(value: bigint, bits: Width, count: bigint, direction: "left" | "right"): bigint {
    if (count < 0n) throw new Error("Rotation count must be nonnegative");
    const width = BigInt(bits);
    count %= width;
    const normalized = BigInt.asUintN(bits, value);
    if (count === 0n) return normalized;
    const opposite = direction === "left" ? normalized >> (width - count) : normalized << (width - count);
    const same = direction === "left" ? normalized << count : normalized >> count;
    return (same | opposite) & ((1n << width) - 1n);
}

function packedBytes(value: bigint, bits: Width): bigint[] {
    const unsigned = BigInt.asUintN(bits, value);
    return Array.from({ length: bits / 8 }, (_, index) => unsigned >> BigInt(8 * index) & 0xffn);
}

export function packInteger(value: bigint, bits: Width, signed: boolean, littleEndian: boolean): string {
    const min = signed ? -(1n << BigInt(bits - 1)) : 0n;
    const max = (1n << BigInt(signed ? bits - 1 : bits)) - 1n;
    if (value < min || value > max) throw new Error(`Value must be between ${min} and ${max}`);
    const bytes = packedBytes(value, bits);
    if (!littleEndian) bytes.reverse();
    return bytes.map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export function unpackInteger(value: string, bits: Width, signed: boolean, littleEndian: boolean): bigint {
    const text = value.trim().replace(/^0[xX]/, "").replace(/\s+/g, "");
    const size = bits / 8;
    if (!/^[0-9a-f]+$/i.test(text) || text.length !== size * 2) {
        throw new Error(`Expected ${size} hexadecimal bytes`);
    }
    let bytes = Array.from({ length: size }, (_, index) => BigInt(parseInt(text.slice(index * 2, index * 2 + 2), 16)));
    if (!littleEndian) bytes = bytes.reverse();
    let result = 0n;
    for (const [index, byte] of bytes.entries()) result |= byte << BigInt(8 * index);
    return signed ? BigInt.asIntN(bits, result) : result;
}
