import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import createServer from "./index.js";

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
    it("keeps decimal behavior and formats mixed integer and fractional results", async () => {
        expect(await call("add", { firstNumber: 10, secondNumber: 5 })).toEqual({ text: "15", error: false });
        expect(await call("add", { firstNumber: "0x10", secondNumber: 5 })).toEqual({ text: "0x15", error: false });
        expect(await call("division", { numerator: "0x5", denominator: 2 })).toEqual({ text: "2.5", error: false });
        expect(await call("sum", { numbers: ["0x10", "32", 1] })).toEqual({ text: "0x31", error: false });
        expect(await call("subtract", { minuend: 1, subtrahend: "0x10" })).toEqual({ text: "-0xf", error: false });
    });

    it("keeps 64-bit integer calculations exact and rejects unsafe floating conversion", async () => {
        expect(await call("add", { firstNumber: "0x20000000000001", secondNumber: 1 }))
            .toEqual({ text: "0x20000000000002", error: false });
        expect(await call("add", { firstNumber: "9007199254740993", secondNumber: 1 }))
            .toEqual({ text: "9007199254740994", error: false });
        expect(await call("mean", { numbers: ["0x20000000000001", "0x20000000000003"] }))
            .toEqual({ text: "0x20000000000002", error: false });
        expect((await call("division", { numerator: "0x20000000000001", denominator: 2 })).error).toBe(true);
        expect((await call("sin", { number: "0x20000000000001" })).error).toBe(true);
        expect((await call("add", { firstNumber: "0x10000000000000", secondNumber: 0.25 })).error).toBe(true);
        expect((await call("add", { firstNumber: 9007199254740992, secondNumber: 1 })).error).toBe(true);
    });

    it("handles statistics and rounding with hex values", async () => {
        expect(await call("median", { numbers: ["0x10", "0x2", "0x3"] }))
            .toEqual({ text: "0x3", error: false });
        expect(await call("median", { numbers: ["0x2", "0x3"] }))
            .toEqual({ text: "2.5", error: false });
        expect(await call("mode", { numbers: ["0x10", 16, 2] }))
            .toEqual({ text: "Entries (0x10) appeared 2 times", error: false });
        expect(await call("cos", { number: "0x0" })).toEqual({ text: "0x1", error: false });
        expect(await call("floor", { number: "0x10" })).toEqual({ text: "0x10", error: false });
    });

    it("returns both alignment boundaries and bit results", async () => {
        expect(await call("align", { value: "0x1001", boundary: 4096 }))
            .toEqual({ text: '{"down":"0x1000","up":"0x2000"}', error: false });
        expect(await call("align", { value: 4096, boundary: 4096 }))
            .toEqual({ text: '{"down":"4096","up":"4096"}', error: false });
        expect(await call("bitAnd", { firstNumber: "0xff", secondNumber: 15 }))
            .toEqual({ text: "0xf", error: false });
        expect(await call("bitOr", { firstNumber: 4, secondNumber: 2 }))
            .toEqual({ text: "6", error: false });
        expect(await call("bitXor", { firstNumber: "0xf", secondNumber: 3 }))
            .toEqual({ text: "0xc", error: false });
        expect(await call("shiftLeft", { number: "0x1", count: 64 }))
            .toEqual({ text: "0x10000000000000000", error: false });
        expect(await call("shiftRight", { number: -2, count: 1 }))
            .toEqual({ text: "-1", error: false });
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
        ] as const;
        for (const [args, result, status] of cases) {
            const response = await call("castInteger", args);
            expect(response.error).toBe(false);
            expect(JSON.parse(response.text)).toMatchObject({ result, status });
        }
        expect(await call("castInteger", { value: "0xff", bits: 8, signed: true }))
            .toEqual({ text: '{"result":"-0x1","min":"-0x80","max":"0x7f","status":"overflow"}', error: false });
        expect(await call("castInteger", { value: "0xffffffffffffffff", bits: 64, signed: true }))
            .toEqual({ text: '{"result":"-0x1","min":"-0x8000000000000000","max":"0x7fffffffffffffff","status":"overflow"}', error: false });
    });

    it("rejects malformed and invalid inputs", async () => {
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
