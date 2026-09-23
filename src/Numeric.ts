import { z } from "zod";

export const numericInput = z.union([
    z.number().refine(value => !Number.isInteger(value) || Number.isSafeInteger(value),
        "Use a decimal or hex string for integers above 2^53-1"),
    z.string().regex(/^-?(?:0[xX][0-9a-fA-F]+|(?:0|[1-9][0-9]*))$/,
        "Expected a decimal integer or 0x-prefixed hex integer")
]);

export type NumericInput = z.infer<typeof numericInput>;
const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);

export function isHex(value: NumericInput): boolean {
    return typeof value === "string" && /^-?0[xX]/.test(value);
}

function parse(value: NumericInput): number | bigint {
    if (typeof value === "number") return value;
    if (isHex(value) && value.startsWith("-")) return -BigInt(value.slice(1));
    return BigInt(value);
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

export function format(value: number | bigint, hex: boolean): string {
    if (typeof value === "bigint") {
        if (!hex) return value.toString();
        return value < 0n ? `-0x${(-value).toString(16)}` : `0x${value.toString(16)}`;
    }
    if (hex && Number.isInteger(value)) {
        if (!Number.isSafeInteger(value)) throw new Error("The integer result is not safely representable");
        return format(BigInt(value), true);
    }
    return String(value);
}

export function calculate(
    inputs: NumericInput[],
    floating: (values: number[]) => number,
    integral?: (values: bigint[]) => bigint | undefined
): string {
    const hex = inputs.some(isHex);
    if (inputs.every(input => typeof input === "number")) {
        return format(floating(inputs as number[]), hex);
    }
    const values = inputs.map(parse);
    if (integral && values.every(value => typeof value === "bigint" || Number.isInteger(value))) {
        const result = integral(values.map(value => BigInt(value)));
        if (result !== undefined) return format(result, hex);
    }
    if (values.some(value => typeof value === "number" && !Number.isInteger(value)) &&
        values.some(value => typeof value === "bigint" && (value >= 2n ** 52n || value <= -(2n ** 52n)))) {
        throw new Error("A fractional calculation cannot safely use this large integer");
    }
    return format(floating(values.map(safeNumber)), hex);
}

export function mode(inputs: NumericInput[]): string {
    const hex = inputs.some(isHex);
    const values = inputs.map(parse);
    if (values.every(value => typeof value === "bigint" || Number.isInteger(value))) {
        const counts = new Map<bigint, number>();
        for (const value of values) {
            const key = BigInt(value);
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        const frequency = [...counts.values()].reduce((max, count) => Math.max(max, count), 0);
        const entries = [...counts].filter(([, count]) => count === frequency)
            .map(([value]) => format(value, hex));
        return `Entries (${entries.join(", ")}) appeared ${frequency} times`;
    }
    const counts = new Map<number, number>();
    for (const value of values.map(safeNumber)) counts.set(value, (counts.get(value) ?? 0) + 1);
    const frequency = [...counts.values()].reduce((max, count) => Math.max(max, count), 0);
    const entries = [...counts].filter(([, count]) => count === frequency)
        .map(([value]) => format(value, hex));
    return `Entries (${entries.join(", ")}) appeared ${frequency} times`;
}
