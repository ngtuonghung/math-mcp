import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import createServer from "../src/index.js";
import { formatInt } from "../src/Numeric.js";
import type { NumericInput } from "../src/Numeric.js";

const server = createServer();
const client = new Client({ name: "operations-test", version: "1.0.0" });

let seed = 0x4d2c6f80;
const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
};
const randomInt = (max: number) => Math.floor(random() * (max + 1));
const randomBig = (bits: number) => {
    let value = 0n;
    for (let remaining = bits; remaining > 0; remaining -= 16) {
        value = value << 16n | BigInt(randomInt(65535));
    }
    return value & (1n << BigInt(bits)) - 1n;
};
const randomInteger = (bits: number, signed = true): NumericInput => {
    let value = randomBig(bits);
    if (signed && value >> BigInt(bits - 1) & 1n) value -= 1n << BigInt(bits);
    const asNumber = bits <= 32 || randomInt(1) === 0;
    return asNumber ? Number(value) : value.toString();
};
const call = async (name: string, arguments_: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: arguments_ });
    const content = Array.isArray(result.content) ? result.content[0] : undefined;
    return {
        text: content?.type === "text" ? content.text : "",
        error: result.isError ?? false
    };
};
const ok = async (name: string, arguments_: Record<string, unknown>) => {
    const result = await call(name, arguments_);
    expect(result.error, `${name}: ${result.text}`).toBe(false);
    return result.text;
};
const exact = async (name: string, arguments_: Record<string, unknown>, expected: bigint) => {
    expect(await ok(name, arguments_)).toBe(expected.toString());
};
const rejected = async (name: string, arguments_: Record<string, unknown>) => {
    expect((await call(name, arguments_)).error).toBe(true);
};
const json = async (name: string, arguments_: Record<string, unknown>) =>
    JSON.parse(await ok(name, arguments_)) as unknown;

beforeAll(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
});

afterAll(async () => {
    await client.close();
    await server.close();
});

describe("deterministic MCP operation properties", () => {
    it("covers every advertised operation", async () => {
        const { tools } = await client.listTools();
        expect(tools).toHaveLength(49);
        expect(new Set(tools.map(tool => tool.name)).size).toBe(49);
    });

    it("computes arithmetic, powers, and combinatorics exactly", async () => {
        for (let round = 0; round < 25; round++) {
            const a = randomBig(randomInt(1) ? 64 : 80);
            const b = randomBig(randomInt(1) ? 64 : 80);
            await exact("add", { firstNumber: a.toString(), secondNumber: b.toString() }, a + b);

            const left = randomBig(64), right = randomBig(64) || 1n;
            await exact("subtract", {
                minuend: left.toString(), subtrahend: right.toString()
            }, left - right);
            await exact("multiply", {
                firstNumber: left.toString(), secondNumber: right.toString()
            }, left * right);
            await exact("modulo", {
                numerator: left.toString(), denominator: right.toString()
            }, left % right);
        }

        for (let round = 0; round < 20; round++) {
            const values = Array.from({ length: randomInt(7) + 1 }, () => randomInteger(32));
            await exact("sum", { numbers: values }, values.reduce((total, value) => total + BigInt(value), 0n));

            const base = randomInteger(48, false), exponent = randomInt(64);
            await exact("power", { base, exponent }, BigInt(base) ** BigInt(exponent));

            const n = BigInt(randomInt(80)), k = BigInt(randomInt(81));
            if (k <= n) {
                const choose = await ok("combination", { n: n.toString(), k: k.toString() });
                const opposite = await ok("combination", { n: n.toString(), k: (n - k).toString() });
                expect(choose).toBe(opposite);
                const selected = await ok("permutation", { n: n.toString(), k: k.toString() });
                expect(BigInt(selected) % BigInt(choose)).toBe(0n);
            }
        }

        await exact("factorial", { n: 80 }, Array.from({ length: 80 }, (_, index) => BigInt(index + 1))
            .reduce((product, value) => product * value, 1n));
        await rejected("division", { numerator: 1, denominator: 0 });
        await rejected("modulo", { numerator: 1, denominator: 0 });
        await rejected("power", { base: 0, exponent: -1 });
        await rejected("power", { base: 2, exponent: 10001 });
        await rejected("factorial", { n: 10001 });
    });

    it("calculates roots, rounding, and floating-point primitives", async () => {
        for (let round = 0; round < 25; round++) {
            const value = randomBig(80), degree = BigInt(randomInt(8) + 1);
            const floor = BigInt(await ok("floorRoot", { number: value.toString(), n: degree.toString() }));
            const ceiling = BigInt(await ok("ceilRoot", { number: value.toString(), n: degree.toString() }));
            expect(floor ** degree).toBeLessThanOrEqual(value);
            expect((floor + 1n) ** degree).toBeGreaterThan(value);
            expect(ceiling ** degree).toBeGreaterThanOrEqual(value);
            if (ceiling > 0n) expect((ceiling - 1n) ** degree).toBeLessThan(value);

            const negative = randomBig(64) | 1n;
            const odd = BigInt(randomInt(7) * 2 + 1);
            const bounded = randomBig(50) + 2n;
            const negativeFloor = BigInt(await ok("floorRoot", {
                number: (-bounded).toString(), n: odd.toString()
            }));
            const negativeCeiling = BigInt(await ok("ceilRoot", {
                number: (-bounded).toString(), n: odd.toString()
            }));
            expect(negativeFloor ** odd).toBeLessThanOrEqual(-bounded);
            expect(negativeCeiling ** odd).toBeGreaterThanOrEqual(-bounded);
        }

        const number = random() * 20 - 10;
        expect(await ok("floor", { number })).toBe(String(Math.floor(number)));
        expect(await ok("ceiling", { number })).toBe(String(Math.ceil(number)));
        expect(await ok("round", { number })).toBe(String(Math.round(number)));
        expect(await ok("exp", { number })).toBe(String(Math.exp(number)));

        const radians = random() * Math.PI * 2 - Math.PI;
        expect(await ok("sin", { number: radians })).toBe(String(Math.sin(radians)));
        expect(await ok("cos", { number: radians })).toBe(String(Math.cos(radians)));
        expect(await ok("tan", { number: radians })).toBe(String(Math.tan(radians)));
        expect(await ok("arcsin", { number: 0.25 })).toBe(String(Math.asin(0.25)));
        expect(await ok("arccos", { number: -0.25 })).toBe(String(Math.acos(-0.25)));
        expect(await ok("arctan", { number: -2.5 })).toBe(String(Math.atan(-2.5)));
        expect(await ok("radiansToDegrees", { number: radians })).toBe(String(radians * 180 / Math.PI));
        expect(await ok("degreesToRadians", { number: 123.5 })).toBe(String(123.5 * Math.PI / 180));
        await rejected("arcsin", { number: 2 });
    });

    it("satisfies divisibility and modular identities", async () => {
        for (let round = 0; round < 25; round++) {
            const a = randomBig(96), b = randomBig(96), c = randomBig(64);
            const inputs = [a.toString(), b.toString(), c.toString()];
            const divisor = BigInt(await ok("gcd", { numbers: inputs }));
            const multiple = BigInt(await ok("lcm", { numbers: inputs }));
            expect(divisor).toBeGreaterThanOrEqual(0n);
            for (const value of [a, b, c]) {
                if (value) expect(value % divisor).toBe(0n);
                if (multiple) expect(multiple % value).toBe(0n);
            }
            if (a && b) {
                const pairDivisor = BigInt(await ok("gcd", { numbers: [a.toString(), b.toString()] }));
                const pairMultiple = BigInt(await ok("lcm", { numbers: [a.toString(), b.toString()] }));
                expect(pairDivisor * pairMultiple).toBe(a * b);
            }

            const modulus = randomBig(80) || 1n;
            const smallExponent = BigInt(randomInt(40));
            await exact("modPow", {
                base: a.toString(), exponent: smallExponent.toString(), modulus: modulus.toString()
            }, (a % modulus + modulus) ** smallExponent % modulus);

            if (modulus > 1n && a % modulus !== 0n) {
                const inverse = await call("modInverse", { value: a.toString(), modulus: modulus.toString() });
                if (!inverse.error) {
                    expect(BigInt(inverse.text) * (a % modulus) % modulus).toBe(1n);
                }
            }
        }

        for (let round = 0; round < 20; round++) {
            const value = randomBig(64);
            const factors = await json("factorize", { value: value < 2n ? "2" : value.toString() }) as {
                factors: Array<{ prime: string; exponent: string }>
            };
            let product = 1n, previousPrime = 0n;
            for (const factor of factors.factors) {
                const prime = BigInt(factor.prime), exponent = BigInt(factor.exponent);
                expect(prime).toBeGreaterThan(previousPrime);
                product *= prime ** exponent;
                previousPrime = prime;
            }
            expect(product).toBe(value < 2n ? 2n : value);
        }
        await rejected("modPow", { base: 1, exponent: -1, modulus: 5 });
        await rejected("modInverse", { value: 2, modulus: 4 });
        await rejected("factorize", { value: 1 });
    });

    it("round-trips representations and exact bit operations", async () => {
        const bases = [2, 8, 10, 16] as const;
        const basePrefixes = { 2: "0b", 8: "0o", 10: "", 16: "0x" } as const;
        await exact("convertBase", { value: "-0xff", fromBase: 16, toBase: 10 }, -255n);
        await exact("convertBase", { value: "+0xff", fromBase: 16, toBase: 10 }, 255n);
        for (let round = 0; round < 30; round++) {
            const value = randomBig(96) - 2n ** 95n;
            for (const base of bases) {
                const magnitude = (value < 0 ? -value : value).toString(16);
                const hexadecimal = value < 0 ? `-${magnitude}` : magnitude;
                const text = await ok("convertBase", { value: hexadecimal, fromBase: 16, toBase: base });
                const magnitudeDigits = (value < 0 ? -value : value).toString(base);
                expect(text).toBe((value < 0 ? "-" : "") + basePrefixes[base] + magnitudeDigits);
                await exact("convertBase", { value: text, fromBase: base, toBase: 10 }, value);
            }

            const bits = [8, 16, 32, 64][randomInt(3)] as 8 | 16 | 32 | 64;
            const signed = randomInt(1) === 1;
            const endian = randomInt(1) ? "little" : "big";
            const min = signed ? -(1n << BigInt(bits - 1)) : 0n;
            const max = min + (1n << BigInt(bits)) - 1n;
            const rangeValue = min + randomBig(bits) % (max - min + 1n);
            const packed = await ok("packInteger", {
                value: rangeValue.toString(), bits, signed, endian
            });
            expect(packed.startsWith("0x")).toBe(true);
            expect(await ok("unpackInteger", { value: packed, bits, signed, endian }))
                .toBe(formatInt(rangeValue, "hex"));
            await rejected("packInteger", { value: (max + 1n).toString(), bits, signed, endian });

            await exact("bitAnd", { firstNumber: "12", secondNumber: "10" }, 8n);
        }

        for (let round = 0; round < 30; round++) {
            const value = randomBig(70) - 2n ** 69n, other = randomBig(70) - 2n ** 69n;
            await exact("bitOr", {
                firstNumber: value.toString(), secondNumber: other.toString()
            }, value | other);
            await exact("bitXor", {
                firstNumber: value.toString(), secondNumber: other.toString()
            }, value ^ other);
            const count = BigInt(randomInt(64));
            await exact("shiftLeft", {
                number: value.toString(), count: count.toString()
            }, value << count);
            await exact("shiftRight", {
                number: value.toString(), count: count.toString()
            }, value >> count);

            const bits = [8, 16, 32, 64][randomInt(3)] as 8 | 16 | 32 | 64;
            const rotateAmount = randomBig(70);
            const left = BigInt(await ok("rotateLeft", {
                value: value.toString(), bits, count: rotateAmount.toString()
            }));
            await exact("rotateRight", {
                value: left.toString(), bits, count: rotateAmount.toString()
            }, BigInt.asUintN(bits, value));

            const unsigned = BigInt.asUintN(bits, value);
            const signedCast = await json("castInteger", {
                value: value.toString(), bits, signed: true
            }) as { result: string; min: string; max: string; status: string };
            expect(BigInt(signedCast.result)).toBe(BigInt.asIntN(bits, value));
            const signedMin = -(1n << BigInt(bits - 1)), signedMax = (1n << BigInt(bits - 1)) - 1n;
            expect(signedCast.status).toBe(value < signedMin ? "underflow" : value > signedMax ? "overflow" : "inRange");

            const unsignedCast = await json("castInteger", {
                value: value.toString(), bits, signed: false
            }) as { result: string; status: string };
            expect(BigInt(unsignedCast.result)).toBe(unsigned);
            expect(unsignedCast.status).toBe(value < 0n ? "underflow" : value >= 1n << BigInt(bits) ? "overflow" : "inRange");
            expect(await ok("bitLength", { value: unsigned.toString() })).toBe(unsigned.toString(2).length.toString());
            expect(await ok("bitCount", { value: unsigned.toString() }))
                .toBe([...unsigned.toString(2)].filter(bit => bit === "1").length.toString());
            if (unsigned) expect(await ok("trailingZeros", { value: unsigned.toString() }))
                .toBe((unsigned.toString(2).length - unsigned.toString(2).lastIndexOf("1") - 1).toString());
        }

        await rejected("bitLength", { value: -1 });
        await rejected("trailingZeros", { value: 0 });
        await rejected("shiftLeft", { number: 1, count: -1 });
        await rejected("unpackInteger", { value: "00", bits: 16, signed: false, endian: "big" });
    });

    it("aligns, casts, and summarizes values", async () => {
        for (let round = 0; round < 25; round++) {
            const value = randomBig(70), boundary = randomBig(40) || 1n;
            const aligned = await json("align", {
                value: value.toString(), boundary: boundary.toString()
            }) as { down: string; up: string };
            expect(BigInt(aligned.down) % boundary).toBe(0n);
            expect(BigInt(aligned.down)).toBeLessThanOrEqual(value);
            expect(BigInt(aligned.up)).toBeGreaterThanOrEqual(value);
            expect(BigInt(aligned.up) - BigInt(aligned.down)).toBeLessThan(boundary * 2n);
        }

        for (let round = 0; round < 25; round++) {
            const values = Array.from({ length: randomInt(7) + 1 }, () => randomInteger(48));
            const bigValues = values.map(Number);
            const sorted = [...bigValues].sort((left, right) => left - right);
            expect(Number(await ok("mean", { numbers: values })))
                .toBe(bigValues.reduce((total, value) => total + value, 0) / values.length);
            expect(Number(await ok("median", { numbers: values }))).toBe(sorted.length % 2
                ? sorted[(sorted.length - 1) / 2]
                : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);
            expect(Number(await ok("min", { numbers: values }))).toBe(Math.min(...bigValues));
            expect(Number(await ok("max", { numbers: values }))).toBe(Math.max(...bigValues));
        }

        expect(await ok("mode", { numbers: ["9", "9", "-3"] })).toBe("Entries (9) appeared 2 times");
        expect(await ok("mode", { numbers: ["9", "9", "-3", "-3"] }))
            .toBe("Entries (9, -3) appeared 2 times");
        await rejected("align", { value: -1, boundary: 1 });
        await rejected("align", { value: 1, boundary: 0 });
    });
});
