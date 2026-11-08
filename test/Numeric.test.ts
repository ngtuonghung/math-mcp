import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import createServer from "../src/index.js";
import { detectMode, formatInt, isBin, isHex } from "../src/Numeric.js";

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
            .toBe("JSON number, a decimal integer string, or a 0x-hex or 0b-binary integer string (hex requires 0x and binary requires 0b; strings accept integers only, no exponent; use decimal strings for integers larger than 9007199254740991)");
        expect(radians.description).toContain("JSON numbers, decimal integer strings, or 0x-hex or 0b-binary integer strings");
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
                    .toContain("JSON numbers, decimal integer strings, or 0x-hex or 0b-binary integer strings; string inputs accept integers only");
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

describe("radix helpers", () => {
    it("formats and detects hexadecimal, binary, and decimal values", () => {
        expect(formatInt(255n, "hex")).toBe("0xff");
        expect(formatInt(-255n, "hex")).toBe("-0xff");
        expect(formatInt(0n, "hex")).toBe("0x0");
        expect(formatInt(255n, "dec")).toBe("255");
        expect(formatInt(255n, "bin")).toBe("0b11111111");
        expect(formatInt(-5n, "bin")).toBe("-0b101");
        expect(formatInt(0n, "bin")).toBe("0b0");
        expect(isHex("0xff")).toBe(true);
        expect(isHex("-0XFF")).toBe(true);
        expect(isHex("ff")).toBe(false);
        expect(isHex("0x")).toBe(false);
        expect(isHex(5)).toBe(false);
        expect(isHex("0b101")).toBe(false);
        expect(isBin("0b101")).toBe(true);
        expect(isBin("-0B11")).toBe(true);
        expect(isBin("0b102")).toBe(false);
        expect(isBin("0b")).toBe(false);
        expect(isBin(5)).toBe(false);
        expect(isBin("1010")).toBe(false);
        expect(detectMode(["0xff", "0x1"])).toBe("hex");
        expect(detectMode(["0b1", "0b10"])).toBe("bin");
        expect(detectMode(["0xff", "0b1"])).toBe("dec");
        expect(detectMode(["0b1", 0])).toBe("dec");
        expect(detectMode(["0xff", 1])).toBe("dec");
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
        expect(await call("factorial", { n: "0x5" })).toEqual({ text: "0x78", error: false });
        expect(await call("gcd", { numbers: ["0x18", "0x30"] })).toEqual({ text: "0x18", error: false });
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

    it("converts integers between bases 2, 8, 10, and 16 with mandatory output prefixes", async () => {
        const cases = [
            [{ value: "255", fromBase: 10, toBase: 16 }, "0xff"],
            [{ value: "0xff", fromBase: 16, toBase: 10 }, "255"],
            [{ value: "ff", fromBase: 16, toBase: 10 }, "255"],
            [{ value: "10", fromBase: 10, toBase: 2 }, "0b1010"],
            [{ value: "1010", fromBase: 2, toBase: 10 }, "10"],
            [{ value: "0b1010", fromBase: 2, toBase: 10 }, "10"],
            [{ value: "100", fromBase: 10, toBase: 8 }, "0o144"],
            [{ value: "144", fromBase: 8, toBase: 10 }, "100"],
            [{ value: "-255", fromBase: 10, toBase: 16 }, "-0xff"],
            [{ value: "18446744073709551615", fromBase: 10, toBase: 16 }, "0xffffffffffffffff"],
        ] as const;
        for (const [args, text] of cases) {
            expect(await call("convertBase", args)).toEqual({ text, error: false });
        }
        expect((await call("convertBase", { value: "2", fromBase: 2, toBase: 10 })).error).toBe(true);
        expect((await call("convertBase", { value: "8", fromBase: 8, toBase: 10 })).error).toBe(true);
        expect((await call("convertBase", { value: "g", fromBase: 16, toBase: 10 })).error).toBe(true);
        expect((await call("convertBase", { value: "", fromBase: 10, toBase: 16 })).error).toBe(true);
        expect((await call("convertBase", { value: "0xff", fromBase: 2, toBase: 10 })).error).toBe(true);
        expect((await call("convertBase", { value: "0b", fromBase: 2, toBase: 10 })).error).toBe(true);
        expect((await call("convertBase", { value: "0o8", fromBase: 8, toBase: 10 })).error).toBe(true);
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
        })).toEqual({ text: "0x9021a5f7ff7f0000", error: false });
        expect((await call("unpackInteger", {
            value: "de ad be ef", bits: 32, signed: false, endian: "little"
        })).error).toBe(true);
        expect(await call("unpackInteger", {
            value: "0xde ad be ef", bits: 32, signed: false, endian: "little"
        })).toEqual({ text: "0xefbeadde", error: false });
        expect(await call("unpackInteger", {
            value: "0xffffffffffffffff", bits: 64, signed: true, endian: "big"
        })).toEqual({ text: "-0x1", error: false });
        expect((await call("rotateLeft", { value: 1, bits: 8, count: -1 })).error).toBe(true);
        expect((await call("packInteger", { value: 256, bits: 8, signed: false, endian: "big" })).error).toBe(true);
        expect((await call("unpackInteger", { value: "00", bits: 16, signed: false, endian: "big" })).error).toBe(true);
    });
});

describe("binary input and echo output", () => {
    it("echoes 0b-binary results when every input is binary", async () => {
        expect(await call("add", { firstNumber: "0b1010", secondNumber: "0b1" })).toEqual({ text: "0b1011", error: false });
        expect(await call("add", { firstNumber: "-0b10", secondNumber: "0b1" })).toEqual({ text: "-0b1", error: false });
        expect(await call("add", { firstNumber: "0B11", secondNumber: "0b1" })).toEqual({ text: "0b100", error: false });
        expect(await call("multiply", { firstNumber: "0b101", secondNumber: "0b11" })).toEqual({ text: "0b1111", error: false });
        expect(await call("power", { base: "0b10", exponent: "0b10" })).toEqual({ text: "0b100", error: false });
        expect(await call("subtract", { minuend: "0b1000", subtrahend: "0b10" })).toEqual({ text: "0b110", error: false });
        expect(await call("sum", { numbers: ["0b1", "0b10", "0b100"] })).toEqual({ text: "0b111", error: false });
        expect(await call("bitAnd", { firstNumber: "0b1100", secondNumber: "0b1010" })).toEqual({ text: "0b1000", error: false });
        expect(await call("shiftLeft", { number: "0b1", count: "0b10" })).toEqual({ text: "0b100", error: false });
        expect(await call("modPow", { base: "0b10", exponent: "0b1000", modulus: "0b1011" })).toEqual({ text: "0b11", error: false });
        expect(await call("median", { numbers: ["0b1", "0b11"] })).toEqual({ text: "0b10", error: false });
        expect(await call("median", { numbers: ["0b1", "0b10"] })).toEqual({ text: "1.5", error: false });
        expect(await call("mode", { numbers: ["0b10", "0b10", "0b1"] }))
            .toEqual({ text: "Entries (0b10) appeared 2 times", error: false });
        expect(await call("castInteger", { value: "0b11111111", bits: 8, signed: false }))
            .toEqual({ text: '{"result":"0b11111111","min":"0b0","max":"0b11111111","status":"inRange"}', error: false });
        expect(await call("align", { value: "0b1000000000001", boundary: "0b1000000000000" }))
            .toEqual({ text: '{"down":"0b1000000000000","up":"0b10000000000000"}', error: false });
    });

    it("returns decimal text for mixed radix or decimal inputs", async () => {
        expect(await call("add", { firstNumber: "0xff", secondNumber: "0b1" })).toEqual({ text: "256", error: false });
        expect(await call("add", { firstNumber: "0b1010", secondNumber: 1 })).toEqual({ text: "11", error: false });
        expect(await call("add", { firstNumber: "1010", secondNumber: 0 })).toEqual({ text: "1010", error: false });
        expect(await call("add", { firstNumber: "0b1010", secondNumber: "1" })).toEqual({ text: "11", error: false });
    });

    it("echoes binary across the upgraded count and factor tools", async () => {
        expect(await call("factorize", { value: "0b1100" })).toEqual({
            text: '{"factors":[{"prime":"0b10","exponent":"0b10"},{"prime":"0b11","exponent":"0b1"}]}',
            error: false
        });
        expect(await call("factorial", { n: "0b101" })).toEqual({ text: "0b1111000", error: false });
        expect(await call("gcd", { numbers: ["0b1010", "0b100"] })).toEqual({ text: "0b10", error: false });
        expect(await call("bitLength", { value: "0b11111111" })).toEqual({ text: "0b1000", error: false });
        expect(await call("bitCount", { value: "0b11111111" })).toEqual({ text: "0b1000", error: false });
    });

    it("rejects malformed binary inputs", async () => {
        expect((await call("add", { firstNumber: "0b", secondNumber: 1 })).error).toBe(true);
        expect((await call("add", { firstNumber: "0b102", secondNumber: 1 })).error).toBe(true);
        expect((await call("add", { firstNumber: "0b2", secondNumber: 1 })).error).toBe(true);
    });
});

describe("upgraded echo coverage for formerly decimal tools", () => {
    it("echoes hex for divisibility, roots, combinatorics, and bit inspection", async () => {
        expect(await call("lcm", { numbers: ["0x6", "0x8"] })).toEqual({ text: "0x18", error: false });
        expect(await call("floorRoot", { number: "0x40", n: "0x2" })).toEqual({ text: "0x8", error: false });
        expect(await call("ceilRoot", { number: "0x41", n: "0x2" })).toEqual({ text: "0x9", error: false });
        expect(await call("floorRoot", { number: "-0x8", n: "0x3" })).toEqual({ text: "-0x2", error: false });
        expect(await call("combination", { n: "0x5", k: "0x2" })).toEqual({ text: "0xa", error: false });
        expect(await call("permutation", { n: "0x5", k: "0x2" })).toEqual({ text: "0x14", error: false });
        expect(await call("bitLength", { value: "0xff" })).toEqual({ text: "0x8", error: false });
        expect(await call("bitCount", { value: "0xff" })).toEqual({ text: "0x8", error: false });
        expect(await call("trailingZeros", { value: "0x10" })).toEqual({ text: "0x4", error: false });
        expect(await call("factorize", { value: "0x168" })).toEqual({
            text: '{"factors":[{"prime":"0x2","exponent":"0x3"},{"prime":"0x3","exponent":"0x2"},{"prime":"0x5","exponent":"0x1"}]}',
            error: false
        });
        expect(await call("floorRoot", { number: 64, n: 2 })).toEqual({ text: "8", error: false });
        expect(await call("factorial", { n: 5 })).toEqual({ text: "120", error: false });
        expect(await call("bitLength", { value: "18446744073709551615" })).toEqual({ text: "64", error: false });
    });

    it("keeps convertBase output prefixed and round-trips prefixed inputs", async () => {
        expect(await call("convertBase", { value: "0xff", fromBase: 16, toBase: 2 })).toEqual({ text: "0b11111111", error: false });
        expect(await call("convertBase", { value: "-0b1010", fromBase: 2, toBase: 16 })).toEqual({ text: "-0xa", error: false });
        expect(await call("convertBase", { value: "+0o17", fromBase: 8, toBase: 10 })).toEqual({ text: "15", error: false });
    });
});
