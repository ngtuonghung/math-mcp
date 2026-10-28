import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import createServer from "../src/index.js";
import { formatHex, isHex } from "../src/Numeric.js";

const server = createServer();
const client = new Client({ name: "numeric-test", version: "1.0.0" });

async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    const content = Array.isArray(result.content) ? result.content[0] : undefined;
    return { text: content?.type === "text" ? content.text : "", error: result.isError ?? false };
}

beforeAll(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
});

afterAll(async () => {
    await client.close();
    await server.close();
});

describe("MCP numeric inputs and outputs", () => {
    it("documents the accepted numeric input formats", async () => {
        const { tools } = await client.listTools();
        const radians = tools.find(tool => tool.name === "radiansToDegrees")!;
        const schema = radians.inputSchema as any;
        expect(schema.properties.number.description)
            .toBe("JSON number, a decimal integer string, or a 0x-hex integer string (hex requires the 0x prefix; strings accept integers only, no exponent; use decimal strings for integers larger than 9007199254740991)");
        expect(radians.description).toContain("JSON numbers, decimal integer strings, or 0x-hex integer strings");
    });

    it("documents every tool and every input field", async () => {
        const { tools } = await client.listTools();
        expect(tools).toHaveLength(49);
        const nonNumericTools = new Set(["convertBase", "unpackInteger"]);
        const resolve = (schema: any, value: any) => {
            let current = value;
            while (typeof current?.$ref === "string") {
                const path = current.$ref.replace(/^#/, "").split("/").filter(Boolean);
                current = path.reduce((part, key) => part?.[key], schema);
            }
            return current;
        };
        for (const tool of tools) {
            expect(tool.description?.trim(), tool.name).toBeTruthy();
            const schema = tool.inputSchema as any;
            for (const [name, raw] of Object.entries(schema.properties ?? {})) {
                const property = resolve(schema, raw);
                expect(property.description?.trim(), `${tool.name}.${name}`).toBeTruthy();
            }
            if (!nonNumericTools.has(tool.name)) {
                expect(tool.description, tool.name)
                    .toContain("JSON numbers, decimal integer strings, or 0x-hex integer strings; string inputs accept integers only");
            }
        }
    });

    it("keeps decimal behavior and formats integer and fractional results", async () => {
        expect(await call("add", { firstNumber: 10, secondNumber: 5 })).toEqual({ text: "15", error: false });
        expect(await call("add", { firstNumber: "10", secondNumber: 5 })).toEqual({ text: "15", error: false });
        expect(await call("division", { numerator: 5, denominator: 2 })).toEqual({ text: "2.5", error: false });
        expect(await call("sum", { numbers: ["16", "32", 1] })).toEqual({ text: "49", error: false });
        expect(await call("subtract", { minuend: 1, subtrahend: "16" })).toEqual({ text: "-15", error: false });
    });

    it("keeps 64-bit integer calculations exact and rejects unsafe floating conversion", async () => {
        expect(await call("add", { firstNumber: "9007199254740993", secondNumber: 1 }))
            .toEqual({ text: "9007199254740994", error: false });
        expect(await call("mean", { numbers: ["9007199254740993", "9007199254740995"] }))
            .toEqual({ text: "9007199254740994", error: false });
        expect((await call("division", { numerator: "9007199254740993", denominator: 2 })).error).toBe(true);
        expect((await call("sin", { number: "9007199254740993" })).error).toBe(true);
        expect((await call("add", { firstNumber: 9007199254740992, secondNumber: 0.25 })).error).toBe(true);
        expect((await call("add", { firstNumber: 9007199254740992, secondNumber: 1 })).error).toBe(true);
    });

    it("handles statistics and rounding with decimal values", async () => {
        expect(await call("median", { numbers: ["16", "2", "3"] })).toEqual({ text: "3", error: false });
        expect(await call("median", { numbers: ["2", "3"] })).toEqual({ text: "2.5", error: false });
        expect(await call("mode", { numbers: ["16", 16, 2] }))
            .toEqual({ text: "Entries (16) appeared 2 times", error: false });
        expect(await call("cos", { number: 0 })).toEqual({ text: "1", error: false });
        expect(await call("floor", { number: "10" })).toEqual({ text: "10", error: false });
    });

    it("returns both alignment boundaries and bit results", async () => {
        expect(await call("align", { value: 4097, boundary: 4096 }))
            .toEqual({ text: '{"down":"4096","up":"8192"}', error: false });
        expect(await call("align", { value: 4096, boundary: 4096 }))
            .toEqual({ text: '{"down":"4096","up":"4096"}', error: false });
        expect(await call("bitAnd", { firstNumber: 255, secondNumber: 15 })).toEqual({ text: "15", error: false });
        expect(await call("bitOr", { firstNumber: 4, secondNumber: 2 })).toEqual({ text: "6", error: false });
        expect(await call("bitXor", { firstNumber: 15, secondNumber: 3 })).toEqual({ text: "12", error: false });
        expect(await call("shiftLeft", { number: 1, count: 64 }))
            .toEqual({ text: "18446744073709551616", error: false });
        expect(await call("shiftRight", { number: -2, count: 1 })).toEqual({ text: "-1", error: false });
    });

    it("casts integers with overflow and underflow at each supported width", async () => {
        const cases = [
            [{ value: 300, bits: 8, signed: false }, "44", "overflow"],
            [{ value: -1, bits: 8, signed: false }, "255", "underflow"],
            [{ value: 130, bits: 8, signed: true }, "-126", "overflow"],
            [{ value: "65535", bits: 16, signed: false }, "65535", "inRange"],
            [{ value: "-32769", bits: 16, signed: true }, "32767", "underflow"],
            [{ value: "4294967296", bits: 32, signed: false }, "0", "overflow"],
            [{ value: "2147483647", bits: 32, signed: true }, "2147483647", "inRange"],
            [{ value: "18446744073709551615", bits: 64, signed: false }, "18446744073709551615", "inRange"],
            [{ value: "-9223372036854775808", bits: 64, signed: true }, "-9223372036854775808", "inRange"],
            [{ value: 255, bits: 8, signed: true }, "-1", "overflow"],
            [{ value: "18446744073709551615", bits: 64, signed: true }, "-1", "overflow"],
        ] as const;
        for (const [args, result, status] of cases) {
            const response = await call("castInteger", args);
            expect(response.error).toBe(false);
            expect(JSON.parse(response.text)).toMatchObject({ result, status });
        }
    });

    it("accepts well-formed hex and rejects malformed and invalid inputs", async () => {
        expect(await call("add", { firstNumber: "0x10", secondNumber: 1 })).toEqual({ text: "17", error: false });
        expect((await call("add", { firstNumber: "0x", secondNumber: 1 })).error).toBe(true);
        expect((await call("add", { firstNumber: "ff", secondNumber: 1 })).error).toBe(true);
        expect((await call("add", { firstNumber: "0xgg", secondNumber: 1 })).error).toBe(true);
        expect((await call("align", { value: 1, boundary: 0 })).error).toBe(true);
        expect((await call("bitAnd", { firstNumber: 1.5, secondNumber: 1 })).error).toBe(true);
        expect((await call("shiftLeft", { number: 1, count: 65 })).error).toBe(true);
        expect((await call("castInteger", { value: 1.5, bits: 8, signed: true })).error).toBe(true);
        expect((await call("castInteger", { value: "0xgg", bits: 8, signed: true })).error).toBe(true);
        expect((await call("castInteger", { value: 1, bits: 12, signed: true })).error).toBe(true);
        expect((await call("castInteger", { value: 9007199254740992, bits: 64, signed: false })).error).toBe(true);
    });
});

describe("hex helpers", () => {
    it("formats and detects hexadecimal values", () => {
        expect(formatHex(255n, true)).toBe("0xff");
        expect(formatHex(-255n, true)).toBe("-0xff");
        expect(formatHex(0n, true)).toBe("0x0");
        expect(formatHex(255n, false)).toBe("255");
        expect(isHex("0xff")).toBe(true);
        expect(isHex("-0XFF")).toBe(true);
        expect(isHex("ff")).toBe(false);
        expect(isHex("0x")).toBe(false);
        expect(isHex(5)).toBe(false);
    });
});

describe("hexadecimal input and echo output", () => {
    it("echoes 0x-hex results when every input is hexadecimal", async () => {
        expect(await call("add", { firstNumber: "0xff", secondNumber: "0x1" })).toEqual({ text: "0x100", error: false });
        expect(await call("add", { firstNumber: "-0x2", secondNumber: "0x1" })).toEqual({ text: "-0x1", error: false });
        expect(await call("add", { firstNumber: "0xffffffffffffffff", secondNumber: "0x1" }))
            .toEqual({ text: "0x10000000000000000", error: false });
        expect(await call("add", { firstNumber: "0XFF", secondNumber: "0x1" })).toEqual({ text: "0x100", error: false });
        expect(await call("division", { numerator: "0x8", denominator: "0x4" })).toEqual({ text: "0x2", error: false });
        expect(await call("division", { numerator: "0x1", denominator: "0x4" })).toEqual({ text: "0.25", error: false });
        expect(await call("power", { base: "0x10", exponent: "0x2" })).toEqual({ text: "0x100", error: false });
    });

    it("returns decimal text when any input is decimal or the tool keeps decimal output", async () => {
        expect(await call("add", { firstNumber: "0xff", secondNumber: 1 })).toEqual({ text: "256", error: false });
        expect(await call("add", { firstNumber: "0xff", secondNumber: "1" })).toEqual({ text: "256", error: false });
        expect(await call("sin", { number: "0x0" })).toEqual({ text: "0", error: false });
        expect(await call("factorial", { n: "0x5" })).toEqual({ text: "120", error: false });
        expect(await call("gcd", { numbers: ["0x18", "0x30"] })).toEqual({ text: "24", error: false });
        expect(await call("convertBase", { value: "0xff", fromBase: 16, toBase: 10 })).toEqual({ text: "255", error: false });
    });

    it("echoes hex across bitwise, modular, rotation, alignment, and casting tools", async () => {
        expect(await call("bitXor", { firstNumber: "0xff", secondNumber: "0x0f" })).toEqual({ text: "0xf0", error: false });
        expect(await call("shiftLeft", { number: "0xff", count: "0x4" })).toEqual({ text: "0xff0", error: false });
        expect(await call("shiftRight", { number: "-0x2", count: "0x1" })).toEqual({ text: "-0x1", error: false });
        expect(await call("rotateLeft", { value: "0x80000001", bits: 32, count: "0x1" })).toEqual({ text: "0x3", error: false });
        expect(await call("modPow", { base: "0x10", exponent: "0x2", modulus: "0x101" })).toEqual({ text: "0x100", error: false });
        expect(await call("modInverse", { value: "0x3", modulus: "0xb" })).toEqual({ text: "0x4", error: false });
        expect(await call("align", { value: "0x12345678", boundary: "0x1000" }))
            .toEqual({ text: '{"down":"0x12345000","up":"0x12346000"}', error: false });
        expect(await call("castInteger", { value: "0x1ffffffff", bits: 32, signed: false }))
            .toEqual({ text: '{"result":"0xffffffff","min":"0x0","max":"0xffffffff","status":"overflow"}', error: false });
    });

    it("echoes hex for statistics with integer results", async () => {
        expect(await call("median", { numbers: ["0x1", "0x2", "0x4"] })).toEqual({ text: "0x2", error: false });
        expect(await call("median", { numbers: ["0x1", "0x2"] })).toEqual({ text: "1.5", error: false });
        expect(await call("mode", { numbers: ["0xff", "0xff", "0x1"] }))
            .toEqual({ text: "Entries (0xff) appeared 2 times", error: false });
        expect(await call("min", { numbers: ["0x10", "0x2"] })).toEqual({ text: "0x2", error: false });
        expect(await call("max", { numbers: ["0x10", "0x2"] })).toEqual({ text: "0x10", error: false });
        expect(await call("mean", { numbers: ["0x2", "0x4"] })).toEqual({ text: "0x3", error: false });
        expect(await call("mean", { numbers: ["0x1", "0x2"] })).toEqual({ text: "1.5", error: false });
    });
});

describe("power, roots, and base conversion", () => {
    it("raises exact integer and floating powers", async () => {
        expect(await call("power", { base: 2, exponent: 10 })).toEqual({ text: "1024", error: false });
        expect(await call("power", { base: "9007199254740993", exponent: 2 }))
            .toEqual({ text: "81129638414606699710187514626049", error: false });
        expect(await call("power", { base: 2, exponent: -1 })).toEqual({ text: "0.5", error: false });
        expect(await call("power", { base: 4, exponent: 0.5 })).toEqual({ text: "2", error: false });
        expect((await call("power", { base: 2, exponent: "10001" })).error).toBe(true);
    });

    it("calculates exact integer roots or rejects undefined roots", async () => {
        expect(await call("floorRoot", { number: 27, n: 3 })).toEqual({ text: "3", error: false });
        expect(await call("ceilRoot", { number: 26, n: 3 })).toEqual({ text: "3", error: false });
        expect(await call("floorRoot", { number: 16, n: 2 })).toEqual({ text: "4", error: false });
        expect(await call("ceilRoot", { number: 17, n: 2 })).toEqual({ text: "5", error: false });
        expect(await call("floorRoot", { number: -27, n: 3 })).toEqual({ text: "-3", error: false });
        expect(await call("ceilRoot", { number: -26, n: 3 })).toEqual({ text: "-2", error: false });
        expect((await call("floorRoot", { number: -8, n: 2 })).error).toBe(true);
        expect((await call("floorRoot", { number: 5, n: 0 })).error).toBe(true);
        expect((await call("ceilRoot", { number: 5, n: 1.5 })).error).toBe(true);
    });

    it("converts integers between bases 2, 8, 10, and 16", async () => {
        const cases = [
            [{ value: "255", fromBase: 10, toBase: 16 }, "ff"],
            [{ value: "0xff", fromBase: 16, toBase: 10 }, "255"],
            [{ value: "ff", fromBase: 16, toBase: 10 }, "255"],
            [{ value: "10", fromBase: 10, toBase: 2 }, "1010"],
            [{ value: "1010", fromBase: 2, toBase: 10 }, "10"],
            [{ value: "100", fromBase: 10, toBase: 8 }, "144"],
            [{ value: "144", fromBase: 8, toBase: 10 }, "100"],
            [{ value: "-255", fromBase: 10, toBase: 16 }, "-ff"],
            [{ value: "18446744073709551615", fromBase: 10, toBase: 16 }, "ffffffffffffffff"],
        ] as const;
        for (const [args, text] of cases) {
            expect(await call("convertBase", args)).toEqual({ text, error: false });
        }
        expect((await call("convertBase", { value: "2", fromBase: 2, toBase: 10 })).error).toBe(true);
        expect((await call("convertBase", { value: "8", fromBase: 8, toBase: 10 })).error).toBe(true);
        expect((await call("convertBase", { value: "g", fromBase: 16, toBase: 10 })).error).toBe(true);
        expect((await call("convertBase", { value: "", fromBase: 10, toBase: 16 })).error).toBe(true);
    });

    it("calculates e^n, factorials, combinations, and permutations", async () => {
        expect(await call("exp", { number: 0 })).toEqual({ text: "1", error: false });
        expect(await call("exp", { number: 1 })).toEqual({ text: "2.718281828459045", error: false });
        expect(await call("factorial", { n: 0 })).toEqual({ text: "1", error: false });
        expect(await call("factorial", { n: 5 })).toEqual({ text: "120", error: false });
        expect(await call("factorial", { n: "25" }))
            .toEqual({ text: "15511210043330985984000000", error: false });
        expect((await call("factorial", { n: -1 })).error).toBe(true);
        expect((await call("factorial", { n: 1.5 })).error).toBe(true);
        expect((await call("factorial", { n: "10001" })).error).toBe(true);
        expect(await call("combination", { n: 5, k: 2 })).toEqual({ text: "10", error: false });
        expect(await call("combination", { n: 10, k: 0 })).toEqual({ text: "1", error: false });
        expect(await call("combination", { n: 10, k: 10 })).toEqual({ text: "1", error: false });
        expect((await call("combination", { n: 5, k: 6 })).error).toBe(true);
        expect((await call("combination", { n: "100001", k: 1 })).error).toBe(true);
        expect(await call("permutation", { n: 5, k: 2 })).toEqual({ text: "20", error: false });
        expect(await call("permutation", { n: 10, k: 0 })).toEqual({ text: "1", error: false });
        expect((await call("permutation", { n: 5, k: 6 })).error).toBe(true);
    });
});

describe("CTF integer operations", () => {
    it("calculates modular inverses, powers, and factorizations", async () => {
        expect(await call("modPow", { base: 65, exponent: 17, modulus: 3233 }))
            .toEqual({ text: "2790", error: false });
        expect(await call("modPow", { base: "-7", exponent: 3, modulus: 5 }))
            .toEqual({ text: "2", error: false });
        expect(await call("modInverse", { value: 17, modulus: 3120 }))
            .toEqual({ text: "2753", error: false });
        expect(await call("factorize", { value: 360 })).toEqual({
            text: '{"factors":[{"prime":"2","exponent":"3"},{"prime":"3","exponent":"2"},{"prime":"5","exponent":"1"}]}',
            error: false
        });
        expect((await call("modPow", { base: 1, exponent: -1, modulus: 5 })).error).toBe(true);
        expect((await call("modInverse", { value: 2, modulus: 4 })).error).toBe(true);
        expect((await call("factorize", { value: 0 })).error).toBe(true);
        expect((await call("factorize", { value: "18446744073709551616" })).error).toBe(true);
    });

    it("calculates divisibility and bit magnitude primitives", async () => {
        expect(await call("gcd", { numbers: ["-48", 18, "60"] })).toEqual({ text: "6", error: false });
        expect(await call("gcd", { numbers: [0, 0] })).toEqual({ text: "0", error: false });
        expect(await call("lcm", { numbers: ["-6", 8] })).toEqual({ text: "24", error: false });
        expect(await call("lcm", { numbers: [0, 8] })).toEqual({ text: "0", error: false });
        expect(await call("bitLength", { value: "18446744073709551615" })).toEqual({ text: "64", error: false });
        expect(await call("bitCount", { value: "255" })).toEqual({ text: "8", error: false });
        expect(await call("trailingZeros", { value: "18446744073709551616" })).toEqual({ text: "64", error: false });
        expect((await call("bitLength", { value: -1 })).error).toBe(true);
        expect((await call("bitCount", { value: -1 })).error).toBe(true);
        expect((await call("trailingZeros", { value: -1 })).error).toBe(true);
        expect((await call("trailingZeros", { value: 0 })).error).toBe(true);
    });

    it("rotates fields and packs integers with explicit byte layout", async () => {
        expect(await call("rotateLeft", { value: "-1", bits: 8, count: 1 }))
            .toEqual({ text: "255", error: false });
        expect(await call("rotateRight", { value: 1, bits: 64, count: 1 }))
            .toEqual({ text: "9223372036854775808", error: false });
        expect(await call("rotateLeft", { value: "9223372036854775808", bits: 64, count: 64 }))
            .toEqual({ text: "9223372036854775808", error: false });
        expect(await call("packInteger", {
            value: "140737348182416", bits: 64, signed: false, endian: "little"
        })).toEqual({ text: "9021a5f7ff7f0000", error: false });
        expect(await call("unpackInteger", {
            value: "de ad be ef", bits: 32, signed: false, endian: "little"
        })).toEqual({ text: "4022250974", error: false });
        expect(await call("unpackInteger", {
            value: "0xffffffffffffffff", bits: 64, signed: true, endian: "big"
        })).toEqual({ text: "-1", error: false });
        expect((await call("rotateLeft", { value: 1, bits: 8, count: -1 })).error).toBe(true);
        expect((await call("packInteger", { value: 256, bits: 8, signed: false, endian: "big" })).error).toBe(true);
        expect((await call("unpackInteger", { value: "00", bits: 16, signed: false, endian: "big" })).error).toBe(true);
    });
});
