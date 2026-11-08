import { z } from "zod";

export const numericInput = z.union([
    z.number().refine(value => !Number.isInteger(value) || Number.isSafeInteger(value),
        "Use a decimal string for integers above 2^53-1"),
    z.string().regex(/^(?:-?(?:0|[1-9][0-9]*)|-?0[xX][0-9a-fA-F]+|-?0[bB][01]+)$/,
        "Expected a decimal, 0x-hex, or 0b-binary integer string")
]).describe("JSON number, a decimal integer string, or a 0x-hex or 0b-binary integer string (hex requires 0x and binary requires 0b; strings accept integers only, no exponent; use decimal strings for integers larger than 9007199254740991)");

export type NumericInput = z.infer<typeof numericInput>;
export type Radix = "dec" | "hex" | "bin";
const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);

export function isHex(input: NumericInput): boolean {
    return typeof input === "string" && /^-?0[xX][0-9a-fA-F]+$/.test(input);
}

export function isBin(input: NumericInput): boolean {
    return typeof input === "string" && /^-?0[bB][01]+$/.test(input);
}

export function detectMode(inputs: NumericInput[]): Radix {
    if (inputs.every(isHex)) return "hex";
    if (inputs.every(isBin)) return "bin";
    return "dec";
}

export function formatInt(value: bigint, radix: Radix): string {
    if (radix === "dec") return value.toString();
    const digits = radix === "hex" ? 16 : 2;
    return (value < 0n ? "-" : "") + (radix === "hex" ? "0x" : "0b") + (value < 0n ? -value : value).toString(digits);
}

function parse(value: NumericInput): number | bigint {
    if (typeof value === "number") return value;
    // BigInt accepts prefixed literals but not a leading minus on them, so strip and negate.
    return /^-0[xXbB]/.test(value) ? -BigInt(value.slice(1)) : BigInt(value);
}

function safeNumber(value: number | bigint): number {
    if (typeof value === "number") return value;
    if (value > maxSafe || value < -maxSafe) {
        throw new Error("A non-integer calculation cannot safely use this large integer");
    }
    return Number(value);
}

export function integers(inputs: NumericInput[]): bigint[] {
    return inputs.map(input => {
        const value = parse(input);
        if (typeof value === "number") {
            if (!Number.isSafeInteger(value)) throw new Error("Expected a safe integer");
            return BigInt(value);
        }
        return value;
    });
}

export function format(value: number | bigint): string {
    if (typeof value === "bigint") {
        return value.toString();
    }
    return String(value);
}

export function formatInteger(inputs: NumericInput[], value: bigint): string {
    return formatInt(value, detectMode(inputs));
}

export function calculate(
    inputs: NumericInput[],
    floating: (values: number[]) => number,
    integral?: (values: bigint[]) => bigint | undefined
): string {
    const values = inputs.map(parse);
    const allIntegers = values.every(value => typeof value === "bigint" || Number.isInteger(value));
    if (integral && allIntegers) {
        const result = integral(values.map(value => BigInt(value)));
        if (result !== undefined) return formatInteger(inputs, result);
    }
    if (values.some(value => typeof value === "number" && !Number.isInteger(value)) &&
        values.some(value => typeof value === "bigint" && (value >= 2n ** 52n || value <= -(2n ** 52n)))) {
        throw new Error("A fractional calculation cannot safely use this large integer");
    }
    return format(floating(values.map(safeNumber)));
}

export function mode(inputs: NumericInput[]): string {
    const values = inputs.map(parse);
    if (values.every(value => typeof value === "bigint" || Number.isInteger(value))) {
        const radix = detectMode(inputs);
        const counts = new Map<bigint, number>();
        for (const value of values) {
            const key = BigInt(value);
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        const frequency = [...counts.values()].reduce((max, count) => Math.max(max, count), 0);
        const entries = [...counts].filter(([, count]) => count === frequency)
            .map(([value]) => formatInt(value, radix));
        return `Entries (${entries.join(", ")}) appeared ${frequency} times`;
    }
    const counts = new Map<number, number>();
    for (const value of values.map(safeNumber)) counts.set(value, (counts.get(value) ?? 0) + 1);
    const frequency = [...counts.values()].reduce((max, count) => Math.max(max, count), 0);
    const entries = [...counts].filter(([, count]) => count === frequency)
        .map(([value]) => format(value));
    return `Entries (${entries.join(", ")}) appeared ${frequency} times`;
}
