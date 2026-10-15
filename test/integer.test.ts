import { describe, expect, it } from "vitest";
import {
    bitCount, bitLength, ceilRoot, factorize, floorRoot, gcd, lcm,
    modularExponentiation, modularInverse, packInteger, rotate, trailingZeros, unpackInteger
} from "../src/integer.js";

function bruteFactors(value: bigint): Array<[bigint, bigint]> {
    const factors: Array<[bigint, bigint]> = [];
    for (let prime = 2n; prime <= value; prime++) {
        let exponent = 0n;
        while (value % prime === 0n) {
            value /= prime;
            exponent++;
        }
        if (exponent) factors.push([prime, exponent]);
    }
    return factors;
}

describe("BigInt CTF operations", () => {
    it("performs modular exponentiation and inversion", () => {
        expect(modularExponentiation(65n, 17n, 3233n)).toBe(2790n);
        expect(modularExponentiation(-7n, 3n, 5n)).toBe(2n);
        expect(modularInverse(17n, 3120n)).toBe(2753n);
        expect(modularInverse(-3n, 11n)).toBe(7n);
        for (let modulus = 2n; modulus < 25n; modulus++) {
            for (let exponent = 0n; exponent < 12n; exponent++) {
                let expected = 1n;
                for (let round = 0n; round < exponent; round++) expected = expected * 3n % modulus;
                expect(modularExponentiation(3n, exponent, modulus)).toBe(expected);
            }
        }
        expect(() => modularExponentiation(1n, -1n, 5n)).toThrow();
        expect(() => modularExponentiation(1n, 1n, 0n)).toThrow();
        expect(() => modularInverse(2n, 4n)).toThrow();
    });

    it("calculates exact divisibility, roots, and bit inspection", () => {
        expect(gcd([-48n, 18n, 60n])).toBe(6n);
        expect(gcd([0n, 0n])).toBe(0n);
        expect(lcm([-6n, 8n])).toBe(24n);
        expect(lcm([0n, 8n])).toBe(0n);
        for (let value = 0n; value < 50n; value++) {
            for (let degree = 1n; degree < 5n; degree++) {
                const floor = floorRoot(value, degree);
                const ceil = ceilRoot(value, degree);
                expect(floor ** degree).toBeLessThanOrEqual(value);
                expect((floor + 1n) ** degree).toBeGreaterThan(value);
                expect(ceil ** degree).toBeGreaterThanOrEqual(value);
                if (ceil > 0n) expect((ceil - 1n) ** degree).toBeLessThan(value);
            }
        }
        expect(floorRoot(-10n, 3n)).toBe(-3n);
        expect(ceilRoot(-10n, 3n)).toBe(-2n);
        expect(floorRoot(2n ** 128n, 4n)).toBe(1n << 32n);
        expect(() => floorRoot(-8n, 2n)).toThrow();
        expect(() => ceilRoot(8n, 0n)).toThrow();
        expect(bitLength(0n)).toBe(0);
        expect(bitLength((1n << 128n) - 1n)).toBe(128);
        expect(bitCount((1n << 64n) - 1n)).toBe(64);
        expect(trailingZeros(1n << 64n)).toBe(64);
        expect(() => bitLength(-1n)).toThrow();
        expect(() => bitCount(-1n)).toThrow();
        expect(() => trailingZeros(-1n)).toThrow();
        expect(() => trailingZeros(0n)).toThrow();
    });

    it("factorizes values exactly", () => {
        expect(factorize(360n)).toEqual([
            { prime: 2n, exponent: 3n }, { prime: 3n, exponent: 2n }, { prime: 5n, exponent: 1n }
        ]);
        for (let value = 2n; value < 500n; value++) {
            expect(factorize(value)).toEqual(bruteFactors(value).map(([prime, exponent]) => ({ prime, exponent })));
        }
        const product = 4294967291n * 4294967279n;
        expect(factorize(product)).toEqual([
            { prime: 4294967279n, exponent: 1n }, { prime: 4294967291n, exponent: 1n }
        ]);
        expect(() => factorize(0n)).toThrow();
        expect(() => factorize(1n)).toThrow();
        expect(() => factorize((1n << 64n))).toThrow();
    });

    it("rotates packed fields and round-trips byte packing", () => {
        expect(rotate(1n << 63n, 64, 1n, "left")).toBe(1n);
        expect(rotate(1n, 64, 1n, "right")).toBe(1n << 63n);
        expect(rotate(-1n, 8, 0n, "left")).toBe(255n);
        expect(rotate(1n, 8, 8n, "left")).toBe(1n);
        expect(() => rotate(1n, 8, -1n, "left")).toThrow();
        for (const bits of [8, 16, 32, 64] as const) {
            for (const endian of [true, false]) {
                const signedCases = [0n, 1n, (1n << BigInt(bits - 1)) - 1n];
                const unsignedCases = [0n, (1n << BigInt(bits)) - 1n];
                for (const value of [...signedCases, ...unsignedCases]) {
                    const packed = packInteger(value, bits, false, endian);
                    expect(unpackInteger(packed, bits, false, endian)).toBe(value);
                    expect(packed).toHaveLength(bits / 4);
                }
                const signedMin = -(1n << BigInt(bits - 1));
                expect(unpackInteger(packInteger(signedMin, bits, true, endian), bits, true, endian))
                    .toBe(signedMin);
            }
        }
        expect(packInteger(BigInt("140737348182416"), 64, false, true))
            .toBe("9021a5f7ff7f0000");
        expect(unpackInteger("de ad be ef", 32, false, true)).toBe(4022250974n);
        expect(() => unpackInteger("00", 16, false, true)).toThrow();
    });
});
