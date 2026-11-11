import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import createServer from "../src/index.js";
import { detectMode, formatInt, isBin, isHex, isOct } from "../src/Numeric.js";

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
        expect(schema.properties.value.description)
            .toBe("JSON number, a decimal string (fractions and exponents allowed), or a 0x-hex, 0o-octal, or 0b-binary integer string (hex requires 0x, octal 0o, binary 0b; use plain decimal strings for integers larger than 9007199254740991)");
        expect(radians.description).toContain("JSON numbers, decimal strings with an optional fraction or exponent, or 0x-hex, 0o-octal, or 0b-binary integer strings");
    });

    it("documents every tool and every input field", async () => {
        const { tools } = await client.listTools();
        expect(tools).toHaveLength(51);
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
                    .toContain("JSON numbers, decimal strings with an optional fraction or exponent, or 0x-hex, 0o-octal, or 0b-binary integer strings");
            }
            // One name to remember per shape: `numbers` for a list of operands, `value` for the operand.
            const fields = Object.keys(schema.properties ?? {});
            expect(fields.includes("value") || fields.includes("numbers"), tool.name).toBe(true);
            expect(fields.filter(field => /^(first|second)Number$|^number$|^n$|^base$|^minuend$|^numerator$|^denominator$/.test(field)), tool.name)
                .toEqual([]);
        }
    });

    it("keeps decimal behavior and formats integer and fractional results", async () => {
        expect(await call("add", { value: 10, addend: 5 })).toEqual({ text: "15", error: false });
        expect(await call("add", { value: "10", addend: 5 })).toEqual({ text: "15", error: false });
        expect(await call("division", { value: 5, divisor: 2 })).toEqual({ text: "2.5", error: false });
        expect(await call("sum", { numbers: ["16", "32", 1] })).toEqual({ text: "49", error: false });
        expect(await call("subtract", { value: 1, subtrahend: "16" })).toEqual({ text: "-15", error: false });
    });

    it("keeps 64-bit integer calculations exact and rejects unsafe floating conversion", async () => {
        expect(await call("add", { value: "9007199254740993", addend: 1 }))
            .toEqual({ text: "9007199254740994", error: false });
        expect(await call("mean", { numbers: ["9007199254740993", "9007199254740995"] }))
            .toEqual({ text: "9007199254740994", error: false });
        expect((await call("division", { value: "9007199254740993", divisor: 2 })).error).toBe(true);
        expect((await call("sin", { value: "9007199254740993" })).error).toBe(true);
        expect((await call("add", { value: 9007199254740992, addend: 0.25 })).error).toBe(true);
        expect((await call("add", { value: 9007199254740992, addend: 1 })).error).toBe(true);
    });

    it("handles statistics and rounding with decimal values", async () => {
        expect(await call("median", { numbers: ["16", "2", "3"] })).toEqual({ text: "3", error: false });
        expect(await call("median", { numbers: ["2", "3"] })).toEqual({ text: "2.5", error: false });
        expect(await call("mode", { numbers: ["16", 16, 2] }))
            .toEqual({ text: "Entries (16) appeared 2 times", error: false });
        expect(await call("cos", { value: 0 })).toEqual({ text: "1", error: false });
        expect(await call("floor", { value: "10" })).toEqual({ text: "10", error: false });
    });

    it("returns both alignment boundaries and bit results", async () => {
        expect(await call("align", { value: 4097, boundary: 4096 }))
            .toEqual({ text: '{"down":"4096","up":"8192"}', error: false });
        expect(await call("align", { value: 4096, boundary: 4096 }))
            .toEqual({ text: '{"down":"4096","up":"4096"}', error: false });
        expect(await call("bitAnd", { numbers: [255, 15] })).toEqual({ text: "15", error: false });
        expect(await call("bitOr", { numbers: [4, 2] })).toEqual({ text: "6", error: false });
        expect(await call("bitXor", { numbers: [15, 3] })).toEqual({ text: "12", error: false });
        expect(await call("shiftLeft", { value: 1, count: 64 }))
            .toEqual({ text: "18446744073709551616", error: false });
        expect(await call("shiftRight", { value: -2, count: 1 })).toEqual({ text: "-1", error: false });
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
        expect(await call("add", { value: "0x10", addend: 1 })).toEqual({ text: "0x11", error: false });
        expect((await call("add", { value: "0x", addend: 1 })).error).toBe(true);
        expect((await call("add", { value: "ff", addend: 1 })).error).toBe(true);
        expect((await call("add", { value: "0xgg", addend: 1 })).error).toBe(true);
        expect((await call("align", { value: 1, boundary: 0 })).error).toBe(true);
        expect((await call("bitAnd", { numbers: [1.5, 1] })).error).toBe(true);
        expect((await call("shiftLeft", { value: 1, count: 65 })).error).toBe(true);
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
        expect(isOct("0o17")).toBe(true);
        expect(isOct("-0O7")).toBe(true);
        expect(isOct("0o8")).toBe(false);
        expect(isOct("0o")).toBe(false);
        expect(isOct(5)).toBe(false);
        expect(formatInt(255n, "oct")).toBe("0o377");
        expect(formatInt(-8n, "oct")).toBe("-0o10");
        expect(detectMode(["0xff", "0x1"])).toBe("hex");
        expect(detectMode(["0b1", "0b10"])).toBe("bin");
        expect(detectMode(["0xff", "0b1"])).toBe("hex");
        expect(detectMode(["0b1", "0o7"])).toBe("bin");
        expect(detectMode(["0o7", 1])).toBe("oct");
        expect(detectMode(["0b1", 0])).toBe("bin");
        expect(detectMode(["0xff", 1])).toBe("hex");
        expect(detectMode([1, 2])).toBe("dec");
    });
});

describe("hexadecimal input and echo output", () => {
    it("echoes 0x-hex results when every input is hexadecimal", async () => {
        expect(await call("add", { value: "0xff", addend: "0x1" })).toEqual({ text: "0x100", error: false });
        expect(await call("add", { value: "-0x2", addend: "0x1" })).toEqual({ text: "-0x1", error: false });
        expect(await call("add", { value: "0xffffffffffffffff", addend: "0x1" }))
            .toEqual({ text: "0x10000000000000000", error: false });
        expect(await call("add", { value: "0XFF", addend: "0x1" })).toEqual({ text: "0x100", error: false });
        expect(await call("division", { value: "0x8", divisor: "0x4" })).toEqual({ text: "0x2", error: false });
        expect(await call("division", { value: "0x1", divisor: "0x4" })).toEqual({ text: "0.25", error: false });
        expect(await call("power", { value: "0x10", exponent: "0x2" })).toEqual({ text: "0x100", error: false });
    });

    it("echoes the strongest input radix and keeps decimal for fractional results", async () => {
        expect(await call("add", { value: "0xff", addend: 1 })).toEqual({ text: "0x100", error: false });
        expect(await call("add", { value: "0xff", addend: "1" })).toEqual({ text: "0x100", error: false });
        expect(await call("rotateLeft", { value: "0xff00", bits: 32, count: 8 })).toEqual({ text: "0xff0000", error: false });
        expect(await call("modPow", { value: "0x10", exponent: 2, modulus: "0x101" })).toEqual({ text: "0x100", error: false });
        expect(await call("sin", { value: "0x0" })).toEqual({ text: "0", error: false });
        expect(await call("factorial", { value: "0x5" })).toEqual({ text: "0x78", error: false });
        expect(await call("gcd", { numbers: ["0x18", "0x30"] })).toEqual({ text: "0x18", error: false });
        expect(await call("convertBase", { value: "0xff", fromBase: 16, toBase: 10 })).toEqual({ text: "255", error: false });
    });

    it("echoes hex across bitwise, modular, rotation, alignment, and casting tools", async () => {
        expect(await call("bitXor", { numbers: ["0xff", "0x0f"] })).toEqual({ text: "0xf0", error: false });
        expect(await call("shiftLeft", { value: "0xff", count: "0x4" })).toEqual({ text: "0xff0", error: false });
        expect(await call("shiftRight", { value: "-0x2", count: "0x1" })).toEqual({ text: "-0x1", error: false });
        expect(await call("rotateLeft", { value: "0x80000001", bits: 32, count: "0x1" })).toEqual({ text: "0x3", error: false });
        expect(await call("modPow", { value: "0x10", exponent: "0x2", modulus: "0x101" })).toEqual({ text: "0x100", error: false });
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
        expect(await call("power", { value: 2, exponent: 10 })).toEqual({ text: "1024", error: false });
        expect(await call("power", { value: "9007199254740993", exponent: 2 }))
            .toEqual({ text: "81129638414606699710187514626049", error: false });
        expect(await call("power", { value: 2, exponent: -1 })).toEqual({ text: "0.5", error: false });
        expect(await call("power", { value: 4, exponent: 0.5 })).toEqual({ text: "2", error: false });
        expect((await call("power", { value: 2, exponent: "10001" })).error).toBe(true);
    });

    it("calculates exact integer roots or rejects undefined roots", async () => {
        expect(await call("floorRoot", { value: 27, degree: 3 })).toEqual({ text: "3", error: false });
        expect(await call("ceilRoot", { value: 26, degree: 3 })).toEqual({ text: "3", error: false });
        expect(await call("floorRoot", { value: 16, degree: 2 })).toEqual({ text: "4", error: false });
        expect(await call("ceilRoot", { value: 17, degree: 2 })).toEqual({ text: "5", error: false });
        expect(await call("floorRoot", { value: -27, degree: 3 })).toEqual({ text: "-3", error: false });
        expect(await call("ceilRoot", { value: -26, degree: 3 })).toEqual({ text: "-2", error: false });
        expect((await call("floorRoot", { value: -8, degree: 2 })).error).toBe(true);
        expect((await call("floorRoot", { value: 5, degree: 0 })).error).toBe(true);
        expect((await call("ceilRoot", { value: 5, degree: 1.5 })).error).toBe(true);
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
        expect(await call("exp", { value: 0 })).toEqual({ text: "1", error: false });
        expect(await call("exp", { value: 1 })).toEqual({ text: "2.718281828459045", error: false });
        expect(await call("factorial", { value: 0 })).toEqual({ text: "1", error: false });
        expect(await call("factorial", { value: 5 })).toEqual({ text: "120", error: false });
        expect(await call("factorial", { value: "25" }))
            .toEqual({ text: "15511210043330985984000000", error: false });
        expect((await call("factorial", { value: -1 })).error).toBe(true);
        expect((await call("factorial", { value: 1.5 })).error).toBe(true);
        expect((await call("factorial", { value: "10001" })).error).toBe(true);
        expect(await call("combination", { value: 5, k: 2 })).toEqual({ text: "10", error: false });
        expect(await call("combination", { value: 10, k: 0 })).toEqual({ text: "1", error: false });
        expect(await call("combination", { value: 10, k: 10 })).toEqual({ text: "1", error: false });
        expect((await call("combination", { value: 5, k: 6 })).error).toBe(true);
        expect((await call("combination", { value: "100001", k: 1 })).error).toBe(true);
        expect(await call("permutation", { value: 5, k: 2 })).toEqual({ text: "20", error: false });
        expect(await call("permutation", { value: 10, k: 0 })).toEqual({ text: "1", error: false });
        expect((await call("permutation", { value: 5, k: 6 })).error).toBe(true);
    });
});

describe("CTF integer operations", () => {
    it("calculates modular inverses, powers, and factorizations", async () => {
        expect(await call("modPow", { value: 65, exponent: 17, modulus: 3233 }))
            .toEqual({ text: "2790", error: false });
        expect(await call("modPow", { value: "-7", exponent: 3, modulus: 5 }))
            .toEqual({ text: "2", error: false });
        expect(await call("modInverse", { value: 17, modulus: 3120 }))
            .toEqual({ text: "2753", error: false });
        expect(await call("factorize", { value: 360 })).toEqual({
            text: '{"factors":[{"prime":"2","exponent":"3"},{"prime":"3","exponent":"2"},{"prime":"5","exponent":"1"}]}',
            error: false
        });
        expect((await call("modPow", { value: 1, exponent: -1, modulus: 5 })).error).toBe(true);
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
        expect(await call("add", { value: "0b1010", addend: "0b1" })).toEqual({ text: "0b1011", error: false });
        expect(await call("add", { value: "-0b10", addend: "0b1" })).toEqual({ text: "-0b1", error: false });
        expect(await call("add", { value: "0B11", addend: "0b1" })).toEqual({ text: "0b100", error: false });
        expect(await call("multiply", { value: "0b101", factor: "0b11" })).toEqual({ text: "0b1111", error: false });
        expect(await call("power", { value: "0b10", exponent: "0b10" })).toEqual({ text: "0b100", error: false });
        expect(await call("subtract", { value: "0b1000", subtrahend: "0b10" })).toEqual({ text: "0b110", error: false });
        expect(await call("sum", { numbers: ["0b1", "0b10", "0b100"] })).toEqual({ text: "0b111", error: false });
        expect(await call("bitAnd", { numbers: ["0b1100", "0b1010"] })).toEqual({ text: "0b1000", error: false });
        expect(await call("shiftLeft", { value: "0b1", count: "0b10" })).toEqual({ text: "0b100", error: false });
        expect(await call("modPow", { value: "0b10", exponent: "0b1000", modulus: "0b1011" })).toEqual({ text: "0b11", error: false });
        expect(await call("median", { numbers: ["0b1", "0b11"] })).toEqual({ text: "0b10", error: false });
        expect(await call("median", { numbers: ["0b1", "0b10"] })).toEqual({ text: "1.5", error: false });
        expect(await call("mode", { numbers: ["0b10", "0b10", "0b1"] }))
            .toEqual({ text: "Entries (0b10) appeared 2 times", error: false });
        expect(await call("castInteger", { value: "0b11111111", bits: 8, signed: false }))
            .toEqual({ text: '{"result":"0b11111111","min":"0b0","max":"0b11111111","status":"inRange"}', error: false });
        expect(await call("align", { value: "0b1000000000001", boundary: "0b1000000000000" }))
            .toEqual({ text: '{"down":"0b1000000000000","up":"0b10000000000000"}', error: false });
    });

    it("prefers hex over binary and binary over decimal", async () => {
        expect(await call("add", { value: "0xff", addend: "0b1" })).toEqual({ text: "0x100", error: false });
        expect(await call("add", { value: "0b1010", addend: 1 })).toEqual({ text: "0b1011", error: false });
        expect(await call("add", { value: "1010", addend: 0 })).toEqual({ text: "1010", error: false });
        expect(await call("add", { value: "0b1010", addend: "1" })).toEqual({ text: "0b1011", error: false });
    });

    it("accepts octal input and echoes 0o-octal results below hex and binary", async () => {
        expect(await call("add", { value: "0o755", addend: 1 })).toEqual({ text: "0o756", error: false });
        expect(await call("bitAnd", { numbers: ["0o755", "0o700"] })).toEqual({ text: "0o700", error: false });
        expect(await call("add", { value: "0o7", addend: "0b1" })).toEqual({ text: "0b1000", error: false });
        expect(await call("add", { value: "0o7", addend: "0x1" })).toEqual({ text: "0x8", error: false });
        expect(await call("add", { value: "0O17", addend: "0o1" })).toEqual({ text: "0o20", error: false });
        expect(await call("add", { value: "-0o17", addend: "0o1" })).toEqual({ text: "-0o16", error: false });
        expect(await call("bitNot", { value: "-0o1", bits: 8 })).toEqual({ text: "0o0", error: false });
        expect(await call("factorize", { value: "0o17" })).toEqual({
            text: '{"factors":[{"prime":"0o3","exponent":"0o1"},{"prime":"0o5","exponent":"0o1"}]}',
            error: false
        });
        expect((await call("add", { value: "0o8", addend: 1 })).error).toBe(true);
        expect((await call("add", { value: "0o", addend: 1 })).error).toBe(true);
        expect((await call("add", { value: "0o1.5", addend: 1 })).error).toBe(true);
    });

    it("accepts fractional and exponent decimal strings from clients that quote numbers", async () => {
        expect(await call("sin", { value: "0" })).toEqual({ text: "0", error: false });
        expect(await call("multiply", { value: "1.5", factor: "2" })).toEqual({ text: "3", error: false });
        expect(await call("division", { value: "5.5", divisor: "2" })).toEqual({ text: "2.75", error: false });
        expect(await call("round", { value: "-2.5" })).toEqual({ text: "-2", error: false });
        expect(await call("add", { value: "1e3", addend: "1" })).toEqual({ text: "1001", error: false });
        expect(await call("add", { value: ".5", addend: ".5" })).toEqual({ text: "1", error: false });
        expect((await call("add", { value: "1e999", addend: 1 })).error).toBe(true);
        expect((await call("add", { value: "1.5.5", addend: 1 })).error).toBe(true);
        expect((await call("bitAnd", { numbers: ["1.5", 1] })).error).toBe(true);
    });

    it("rejects non-finite inputs and non-finite results", async () => {
        expect((await call("add", { value: Infinity, addend: 1 })).error).toBe(true);
        expect((await call("add", { value: -Infinity, addend: 1 })).error).toBe(true);
        expect((await call("add", { value: NaN, addend: 1 })).error).toBe(true);
        expect((await call("exp", { value: 1000 })).error).toBe(true);
        expect((await call("division", { value: "5.5", divisor: 0 })).error).toBe(true);
        expect((await call("modulo", { value: "5.5", divisor: 0 })).error).toBe(true);
        expect((await call("power", { value: (1n << 4096n).toString(), exponent: 10000 })).error).toBe(true);
    });

    it("computes bitwise NOT and variadic bitwise folds", async () => {
        expect(await call("bitNot", { value: 12 })).toEqual({ text: "-13", error: false });
        expect(await call("bitNot", { value: "0xff", bits: 8 })).toEqual({ text: "0x0", error: false });
        expect(await call("bitNot", { value: "0x0", bits: 32 })).toEqual({ text: "0xffffffff", error: false });
        expect(await call("bitNot", { value: "0b1010", bits: 8 })).toEqual({ text: "0b11110101", error: false });
        expect(await call("bitAnd", { numbers: ["0xff", "0x0f", "0x3"] })).toEqual({ text: "0x3", error: false });
        expect(await call("bitOr", { numbers: [1, 2, 4] })).toEqual({ text: "7", error: false });
        expect(await call("bitXor", { numbers: [15, 3, 1] })).toEqual({ text: "13", error: false });
        expect(await call("bitAnd", { numbers: ["0xf0"] })).toEqual({ text: "0xf0", error: false });
        expect((await call("bitAnd", { numbers: [] })).error).toBe(true);
    });

    it("multiplies a list with product", async () => {
        expect(await call("product", { numbers: [2, 3, 7] })).toEqual({ text: "42", error: false });
        expect(await call("product", { numbers: ["0x10", 2, 2] })).toEqual({ text: "0x40", error: false });
        expect(await call("product", { numbers: ["9007199254740993", "2"] }))
            .toEqual({ text: "18014398509481986", error: false });
        expect(await call("product", { numbers: ["1.5", 2] })).toEqual({ text: "3", error: false });
        expect(await call("product", { numbers: [5] })).toEqual({ text: "5", error: false });
    });

    it("echoes binary across the upgraded count and factor tools", async () => {
        expect(await call("factorize", { value: "0b1100" })).toEqual({
            text: '{"factors":[{"prime":"0b10","exponent":"0b10"},{"prime":"0b11","exponent":"0b1"}]}',
            error: false
        });
        expect(await call("factorial", { value: "0b101" })).toEqual({ text: "0b1111000", error: false });
        expect(await call("gcd", { numbers: ["0b1010", "0b100"] })).toEqual({ text: "0b10", error: false });
        expect(await call("bitLength", { value: "0b11111111" })).toEqual({ text: "0b1000", error: false });
        expect(await call("bitCount", { value: "0b11111111" })).toEqual({ text: "0b1000", error: false });
    });

    it("rejects malformed binary inputs", async () => {
        expect((await call("add", { value: "0b", addend: 1 })).error).toBe(true);
        expect((await call("add", { value: "0b102", addend: 1 })).error).toBe(true);
        expect((await call("add", { value: "0b2", addend: 1 })).error).toBe(true);
    });
});

describe("upgraded echo coverage for formerly decimal tools", () => {
    it("echoes hex for divisibility, roots, combinatorics, and bit inspection", async () => {
        expect(await call("lcm", { numbers: ["0x6", "0x8"] })).toEqual({ text: "0x18", error: false });
        expect(await call("floorRoot", { value: "0x40", degree: "0x2" })).toEqual({ text: "0x8", error: false });
        expect(await call("ceilRoot", { value: "0x41", degree: "0x2" })).toEqual({ text: "0x9", error: false });
        expect(await call("floorRoot", { value: "-0x8", degree: "0x3" })).toEqual({ text: "-0x2", error: false });
        expect(await call("combination", { value: "0x5", k: "0x2" })).toEqual({ text: "0xa", error: false });
        expect(await call("permutation", { value: "0x5", k: "0x2" })).toEqual({ text: "0x14", error: false });
        expect(await call("bitLength", { value: "0xff" })).toEqual({ text: "0x8", error: false });
        expect(await call("bitCount", { value: "0xff" })).toEqual({ text: "0x8", error: false });
        expect(await call("trailingZeros", { value: "0x10" })).toEqual({ text: "0x4", error: false });
        expect(await call("factorize", { value: "0x168" })).toEqual({
            text: '{"factors":[{"prime":"0x2","exponent":"0x3"},{"prime":"0x3","exponent":"0x2"},{"prime":"0x5","exponent":"0x1"}]}',
            error: false
        });
        expect(await call("floorRoot", { value: 64, degree: 2 })).toEqual({ text: "8", error: false });
        expect(await call("factorial", { value: 5 })).toEqual({ text: "120", error: false });
        expect(await call("bitLength", { value: "18446744073709551615" })).toEqual({ text: "64", error: false });
    });

    it("keeps convertBase output prefixed and round-trips prefixed inputs", async () => {
        expect(await call("convertBase", { value: "0xff", fromBase: 16, toBase: 2 })).toEqual({ text: "0b11111111", error: false });
        expect(await call("convertBase", { value: "-0b1010", fromBase: 2, toBase: 16 })).toEqual({ text: "-0xa", error: false });
        expect(await call("convertBase", { value: "+0o17", fromBase: 8, toBase: 10 })).toEqual({ text: "15", error: false });
        expect(await call("convertBase", { value: "0o755", toBase: 16 })).toEqual({ text: "0x1ed", error: false });
        expect(await call("convertBase", { value: "0xff", toBase: 2 })).toEqual({ text: "0b11111111", error: false });
        expect(await call("convertBase", { value: "255", toBase: 16 })).toEqual({ text: "0xff", error: false });
        expect((await call("convertBase", { value: "0b11", fromBase: 16, toBase: 10 })).error).toBe(true);
        expect((await call("convertBase", { value: "ff", toBase: 10 })).error).toBe(true);
    });
});
