import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { Arithmetic } from "./Classes/Arithmetic.js";
import { Statistics } from "./Classes/Statistics.js";
import { Trigonometric } from "./Classes/Trigonometric.js";
import {
    bitCount, bitLength, ceilRoot, factorize, floorRoot, gcd, lcm,
    modularExponentiation, modularInverse, packInteger, rotate, trailingZeros, unpackInteger
} from "./integer.js";
import { calculate, detectMode, formatInt, formatInteger, integers, mode, numericInput } from "./Numeric.js";
import type { NumericInput, Radix } from "./Numeric.js";

const reply = (text: string) => ({ content: [{ type: "text" as const, text }] });
const numericDoc = " Numeric arguments accept JSON numbers, decimal strings with an optional fraction or exponent, or 0x-hex, 0o-octal, or 0b-binary integer strings; the prefixed forms are integers only.";
const numericDescription = (description: string) => description + numericDoc;
const echoDoc = " Integer results follow the radix of the inputs: any 0x-hex input returns 0x-hex, otherwise any 0b-binary input returns 0b-binary, otherwise any 0o-octal input returns 0o-octal, otherwise decimal.";
const echoDescription = (description: string) => numericDescription(description) + echoDoc;
const list = { numbers: z.array(numericInput).min(1)
    .describe("One or more numeric values; each accepts a JSON number, a decimal string, or a 0x-hex, 0o-octal, or 0b-binary integer string.") };
const unary = { value: numericInput };
const sum = (values: bigint[]) => values.reduce((total, value) => total + value, 0n);
const factorial = (n: bigint) => {
    let result = 1n;
    for (let i = 2n; i <= n; i++) result *= i;
    return result;
};
const falling = (n: bigint, k: bigint) => {
    let result = 1n;
    for (let i = 0n; i < k; i++) result *= n - i;
    return result;
};
const combination = (n: bigint, k: bigint) => {
    const r = k < n - k ? k : n - k;
    return falling(n, r) / factorial(r);
};
const safe = (value: bigint) => {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("A non-integer calculation cannot safely use this large integer");
    }
};
const exactBitLimit = 1000000n;
// ponytail: string coercion for clients that quote JSON schema enum numbers.
const enumOption = <A extends number, B extends number, C extends number, D extends number>(a: A, b: B, c: C, d: D) =>
    z.preprocess(value => typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value,
        z.union([z.literal(a), z.literal(b), z.literal(c), z.literal(d)]));
const baseOption = enumOption(2, 8, 10, 16)
    .describe("Integer base: 2, 8, 10, or 16");
const widthOption = enumOption(8, 16, 32, 64)
    .describe("Integer width in bits: 8, 16, 32, or 64");
const endianOption = z.union([z.literal("little"), z.literal("big")])
    .describe("Byte order: little or big");
const signedOption = z.boolean()
    .describe("If true, use a signed integer; if false, use an unsigned integer");
const baseDigits: Record<number, RegExp> = { 2: /^[01]+$/, 8: /^[0-7]+$/, 10: /^[0-9]+$/, 16: /^[0-9a-f]+$/i };
const basePrefix: Record<number, string> = { 2: "0b", 8: "0o", 10: "", 16: "0x" };
const prefixBase: Record<string, number> = { b: 2, o: 8, x: 16 };
const radixOf = (base: number): Radix => base === 16 ? "hex" : base === 8 ? "oct" : base === 2 ? "bin" : "dec";

export default function createServer() {
    const mathServer = new McpServer({ name: "math", version: "0.7.0" });

    mathServer.tool("add", echoDescription("Adds value and addend; integer inputs are exact."),
        { value: numericInput, addend: numericInput },
        async ({ value, addend }) => reply(calculate([value, addend],
            ([a, b]) => Arithmetic.add(a, b), ([a, b]) => a + b)));
    mathServer.tool("subtract", echoDescription("Subtracts subtrahend from value; integer inputs are exact."),
        { value: numericInput, subtrahend: numericInput },
        async ({ value, subtrahend }) => reply(calculate([value, subtrahend],
            ([a, b]) => Arithmetic.subtract(a, b), ([a, b]) => a - b)));
    mathServer.tool("multiply", echoDescription("Multiplies value by factor; integer inputs are exact."),
        { value: numericInput, factor: numericInput },
        async ({ value, factor }) => reply(calculate([value, factor],
            ([a, b]) => Arithmetic.multiply(a, b), ([a, b]) => a * b)));
    mathServer.tool("division", echoDescription("Divides value by divisor; exact for integer inputs that divide evenly, otherwise floating-point; divisor cannot be zero."),
        { value: numericInput, divisor: numericInput },
        async ({ value, divisor }) => reply(calculate([value, divisor],
            ([a, b]) => Arithmetic.division(a, b), ([a, b]) => {
                if (b === 0n) throw new Error("Division by zero");
                if (a % b === 0n) return a / b;
                safe(a); safe(b);
            })));
    mathServer.tool("sum", echoDescription("Adds one or more numbers in order; integer inputs are exact."), list,
        async ({ numbers }) => reply(calculate(numbers,
            values => Arithmetic.sum(values), sum)));
    mathServer.tool("product", echoDescription("Multiplies one or more numbers in order; integer inputs are exact."), list,
        async ({ numbers }) => reply(calculate(numbers,
            values => values.reduce((total, value) => total * value, 1),
            values => values.reduce((total, value) => total * value, 1n))));
    mathServer.tool("modulo", echoDescription("Returns the remainder after dividing value by divisor, truncated toward zero so the sign follows value; integer inputs are exact; divisor cannot be zero."),
        { value: numericInput, divisor: numericInput },
        async ({ value, divisor }) => reply(calculate([value, divisor],
            ([a, b]) => Arithmetic.modulo(a, b), ([a, b]) => {
                if (b === 0n) throw new Error("Modulo by zero");
                return a % b;
            })));
    mathServer.tool("power", echoDescription("Raises value to exponent; nonnegative integer exponents up to 10000 are exact while negative exponents use floating-point; zero cannot have a negative exponent, and an exact result is limited to 1000000 bits."),
        { value: numericInput, exponent: numericInput },
        async ({ value, exponent }) => reply(calculate([value, exponent],
            ([a, b]) => {
                if (a === 0 && b < 0) throw new Error("Zero cannot be raised to a negative power");
                return Arithmetic.power(a, b);
            }, ([a, b]) => {
                if (b < 0n) {
                    if (a === 0n) throw new Error("Zero cannot be raised to a negative power");
                    return undefined;
                }
                if (b > 10000n) throw new Error("Integer exponent must be at most 10000 for exact results");
                const magnitude = a < 0n ? -a : a;
                // Guard the output size: a huge exact power costs seconds and megabytes of text.
                if (magnitude > 1n && BigInt(magnitude.toString(2).length) * b > exactBitLimit) {
                    throw new Error(`The exact result would exceed ${exactBitLimit} bits`);
                }
                return a ** b;
            })));
    mathServer.tool("floorRoot", echoDescription("Calculates the exact integer floor of the nth root of value; the degree must be at least 1 and a negative value supports only an odd degree."),
        { value: numericInput, degree: numericInput },
        async ({ value, degree }) => {
            const [number, n] = integers([value, degree]);
            return reply(formatInteger([value, degree], floorRoot(number, n)));
        });
    mathServer.tool("ceilRoot", echoDescription("Calculates the exact integer ceiling of the nth root of value; the degree must be at least 1 and a negative value supports only an odd degree."),
        { value: numericInput, degree: numericInput },
        async ({ value, degree }) => {
            const [number, n] = integers([value, degree]);
            return reply(formatInteger([value, degree], ceilRoot(number, n)));
        });
    mathServer.tool("gcd", echoDescription("Calculates the exact greatest common divisor of one or more integers."), list,
        async ({ numbers }) => reply(formatInteger(numbers, gcd(integers(numbers)))));
    mathServer.tool("lcm", echoDescription("Calculates the exact least common multiple of one or more integers."), list,
        async ({ numbers }) => reply(formatInteger(numbers, lcm(integers(numbers)))));
    mathServer.tool("exp", numericDescription("Calculates e raised to the given power using floating-point arithmetic."), unary,
        async ({ value }) => reply(calculate([value], ([a]) => Math.exp(a))));
    mathServer.tool("factorial", echoDescription("Calculates the exact factorial n! for an integer value from 0 through 10000."),
        unary,
        async ({ value }) => {
            const [n] = integers([value]);
            if (n < 0n || n > 10000n) throw new Error("value must be between 0 and 10000");
            return reply(formatInteger([value], factorial(n)));
        });
    mathServer.tool("combination", echoDescription("Calculates the exact binomial coefficient C(value, k), where value is n from 0 through 100000 and 0 <= k <= n."),
        { value: numericInput, k: numericInput },
        async ({ value, k }) => {
            const [total, choose] = integers([value, k]);
            if (total < 0n || total > 100000n) throw new Error("value must be between 0 and 100000");
            if (choose < 0n || choose > total) throw new Error("k must be between 0 and value");
            return reply(formatInteger([value, k], combination(total, choose)));
        });
    mathServer.tool("permutation", echoDescription("Calculates the exact number of ordered selections P(value, k), where value is n from 0 through 100000 and 0 <= k <= n."),
        { value: numericInput, k: numericInput },
        async ({ value, k }) => {
            const [total, choose] = integers([value, k]);
            if (total < 0n || total > 100000n) throw new Error("value must be between 0 and 100000");
            if (choose < 0n || choose > total) throw new Error("k must be between 0 and value");
            return reply(formatInteger([value, k], falling(total, choose)));
        });
    mathServer.tool("convertBase", "Converts an exact integer between bases 2, 8, 10, and 16. A 0b, 0o, or 0x prefix on the input selects its base, otherwise fromBase does, defaulting to base 10. The result carries the base prefix 0b, 0o, or 0x; base 10 stays plain.",
        {
            value: z.string().min(1)
                .describe("Integer to convert: a 0b, 0o, or 0x prefixed literal, or bare digits valid for fromBase; an optional leading sign is allowed"),
            fromBase: baseOption.optional()
                .describe("Base of value when it carries no 0b, 0o, or 0x prefix: 2, 8, 10, or 16; defaults to 10"),
            toBase: baseOption
        },
        async ({ value, fromBase, toBase }) =>
            reply(formatInt(parseInBase(value, fromBase), radixOf(toBase))));

    mathServer.tool("modPow", echoDescription("Calculates value raised to a nonnegative exponent modulo a nonzero modulus exactly; exponent and modulus are limited to 8192 bits."),
        { value: numericInput, exponent: numericInput, modulus: numericInput },
        async ({ value, exponent, modulus }) => {
            const [a, b, m] = integers([value, exponent, modulus]);
            return reply(formatInteger([value, exponent, modulus], modularExponentiation(a, b, m)));
        });
    mathServer.tool("modInverse", echoDescription("Calculates the exact multiplicative inverse of value modulo a nonzero modulus when that inverse exists; the modulus is limited to 8192 bits."),
        { value: numericInput, modulus: numericInput },
        async ({ value, modulus }) => {
            const [a, m] = integers([value, modulus]);
            return reply(formatInteger([value, modulus], modularInverse(a, m)));
        });
    mathServer.tool("factorize", echoDescription("Returns the exact ascending prime-power factorization for an integer value from 2 through 2^64 - 1."),
        unary,
        async ({ value }) => {
            const [number] = integers([value]);
            const radix = detectMode([value]);
            return reply(JSON.stringify({
                factors: factorize(number).map(({ prime, exponent }) => ({
                    prime: formatInt(prime, radix), exponent: formatInt(exponent, radix)
                }))
            }));
        });
    mathServer.tool("bitLength", echoDescription("Counts the significant binary bits in a nonnegative integer; 0 has bit length 0."),
        unary,
        async ({ value }) => {
            const [number] = integers([value]);
            return reply(formatInteger([value], BigInt(bitLength(number))));
        });
    mathServer.tool("bitCount", echoDescription("Counts the set binary bits in a nonnegative integer."),
        unary,
        async ({ value }) => {
            const [number] = integers([value]);
            return reply(formatInteger([value], BigInt(bitCount(number))));
        });
    mathServer.tool("trailingZeros", echoDescription("Counts trailing zero binary bits in a nonzero nonnegative integer; 0 is undefined."),
        unary,
        async ({ value }) => {
            const [number] = integers([value]);
            return reply(formatInteger([value], BigInt(trailingZeros(number))));
        });
    const rotateInput = { value: numericInput, bits: widthOption, count: numericInput };
    mathServer.tool("rotateLeft", echoDescription("Rotates value left within an unsigned 8, 16, 32, or 64-bit field; the count is taken modulo the selected width."), rotateInput,
        async ({ value, bits, count }) => {
            const [number, amount] = integers([value, count]);
            return reply(formatInteger([value, count], rotate(number, bits, amount, "left")));
        });
    mathServer.tool("rotateRight", echoDescription("Rotates value right within an unsigned 8, 16, 32, or 64-bit field; the count is taken modulo the selected width."), rotateInput,
        async ({ value, bits, count }) => {
            const [number, amount] = integers([value, count]);
            return reply(formatInteger([value, count], rotate(number, bits, amount, "right")));
        });
    const packInput = {
        value: numericInput, bits: widthOption, signed: signedOption, endian: endianOption
    };
    mathServer.tool("packInteger", numericDescription("Encodes an in-range integer as lowercase 0x-prefixed hexadecimal bytes using the selected width, signedness, and byte order."), packInput,
        async ({ value, bits, signed, endian }) => {
            const [number] = integers([value]);
            return reply(packInteger(number, bits, signed, endian === "little"));
        });
    mathServer.tool("unpackInteger", "Decodes exact hexadecimal bytes into an integer using the selected width, signedness, and byte order. The integer result is returned as 0x-hex.",
        {
            value: z.string().min(1)
                .describe("Exactly width / 8 hexadecimal digits with a required 0x prefix, as one string; surrounding or intervening whitespace is ignored"),
            bits: widthOption, signed: signedOption, endian: endianOption
        },
        async ({ value, bits, signed, endian }) => {
            return reply(formatInt(unpackInteger(value, bits, signed, endian === "little"), "hex"));
        });

    mathServer.tool("mean", echoDescription("Calculates the arithmetic mean of one or more numbers."), list,
        async ({ numbers }) => reply(calculate(numbers,
            values => Statistics.mean(values), values => {
                const total = sum(values);
                const count = BigInt(values.length);
                if (total % count === 0n) return total / count;
                safe(total);
            })));
    mathServer.tool("median", echoDescription("Calculates the median value of one or more numbers."), list,
        async ({ numbers }) => reply(calculate(numbers,
            values => Statistics.median(values), values => {
                const sorted = [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
                const middle = Math.floor(sorted.length / 2);
                if (sorted.length % 2) return sorted[middle];
                const total = sorted[middle - 1] + sorted[middle];
                if (total % 2n === 0n) return total / 2n;
                safe(total);
            })));
    mathServer.tool("mode", echoDescription("Reports the most common value or values in one or more numbers and their frequency; the frequency stays decimal."),
        list,
        async ({ numbers }) => reply(mode(numbers)));
    mathServer.tool("min", echoDescription("Finds the minimum value among one or more numbers; integer inputs are exact."),
        list,
        async ({ numbers }) => reply(calculate(numbers,
            values => Statistics.min(values), values => values.reduce((min, value) => value < min ? value : min))));
    mathServer.tool("max", echoDescription("Finds the maximum value among one or more numbers; integer inputs are exact."),
        list,
        async ({ numbers }) => reply(calculate(numbers,
            values => Statistics.max(values), values => values.reduce((max, value) => value > max ? value : max))));

    mathServer.tool("floor", numericDescription("Rounds a number down to the nearest integer; integer inputs are exact."), unary,
        async ({ value }) => reply(calculate([value], ([a]) => Arithmetic.floor(a), ([a]) => a)));
    mathServer.tool("ceiling", numericDescription("Rounds a number up to the nearest integer; integer inputs are exact."), unary,
        async ({ value }) => reply(calculate([value], ([a]) => Arithmetic.ceil(a), ([a]) => a)));
    mathServer.tool("round", numericDescription("Rounds a number to the nearest integer; integer inputs are exact."), unary,
        async ({ value }) => reply(calculate([value], ([a]) => Arithmetic.round(a), ([a]) => a)));

    mathServer.tool("sin", numericDescription("Calculates the sine of an angle in radians using floating-point arithmetic."), unary,
        async ({ value }) => reply(calculate([value], ([a]) => Trigonometric.sin(a))));
    mathServer.tool("arcsin", numericDescription("Calculates the inverse sine in radians using floating-point arithmetic; input must be in [-1, 1]."), unary,
        async ({ value }) => reply(calculate([value], ([a]) => Trigonometric.arcsin(a))));
    mathServer.tool("cos", numericDescription("Calculates the cosine of an angle in radians using floating-point arithmetic."), unary,
        async ({ value }) => reply(calculate([value], ([a]) => Trigonometric.cos(a))));
    mathServer.tool("arccos", numericDescription("Calculates the inverse cosine in radians using floating-point arithmetic; input must be in [-1, 1]."), unary,
        async ({ value }) => reply(calculate([value], ([a]) => Trigonometric.arccos(a))));
    mathServer.tool("tan", numericDescription("Calculates the tangent of an angle in radians using floating-point arithmetic."), unary,
        async ({ value }) => reply(calculate([value], ([a]) => Trigonometric.tan(a))));
    mathServer.tool("arctan", numericDescription("Calculates the inverse tangent in radians using floating-point arithmetic."), unary,
        async ({ value }) => reply(calculate([value], ([a]) => Trigonometric.arctan(a))));
    mathServer.tool("radiansToDegrees", numericDescription("Converts an angle from radians to degrees using floating-point arithmetic."), unary,
        async ({ value }) => reply(calculate([value], ([a]) => Trigonometric.radiansToDegrees(a))));
    mathServer.tool("degreesToRadians", numericDescription("Converts an angle from degrees to radians using floating-point arithmetic."), unary,
        async ({ value }) => reply(calculate([value], ([a]) => Trigonometric.degreesToRadians(a))));

    mathServer.tool("align", echoDescription("Returns the exact aligned boundaries at or below and at or above value; value must be nonnegative and boundary must be positive."),
        { value: numericInput, boundary: numericInput },
        async ({ value, boundary }) => {
            const [address, size] = integers([value, boundary]);
            if (address < 0n || size <= 0n) throw new Error("Value must be nonnegative and boundary positive");
            const down = address / size * size;
            const up = down === address ? down : down + size;
            const radix = detectMode([value, boundary]);
            return reply(JSON.stringify({ down: formatInt(down, radix), up: formatInt(up, radix) }));
        });

    mathServer.tool("castInteger", echoDescription("Wraps an integer to a signed or unsigned 8, 16, 32, or 64-bit type and reports whether the original value was in range."),
        { value: numericInput, bits: widthOption, signed: signedOption },
        async ({ value, bits, signed }) => {
            const [input] = integers([value]);
            const width = BigInt(bits);
            const min = signed ? -(1n << (width - 1n)) : 0n;
            const max = (1n << (signed ? width - 1n : width)) - 1n;
            const result = signed ? BigInt.asIntN(bits, input) : BigInt.asUintN(bits, input);
            const radix = detectMode([value]);
            return reply(JSON.stringify({
                result: formatInt(result, radix), min: formatInt(min, radix), max: formatInt(max, radix),
                status: input < min ? "underflow" : input > max ? "overflow" : "inRange"
            }));
        });

    mathServer.tool("bitAnd", echoDescription("Computes the exact bitwise AND of one or more integers using BigInt signed semantics."), list,
        async ({ numbers }) => reply(bitResult(numbers, values => values.reduce((total, value) => total & value))));
    mathServer.tool("bitOr", echoDescription("Computes the exact bitwise OR of one or more integers using BigInt signed semantics."), list,
        async ({ numbers }) => reply(bitResult(numbers, values => values.reduce((total, value) => total | value))));
    mathServer.tool("bitXor", echoDescription("Computes the exact bitwise XOR of one or more integers using BigInt signed semantics."), list,
        async ({ numbers }) => reply(bitResult(numbers, values => values.reduce((total, value) => total ^ value))));
    mathServer.tool("bitNot", echoDescription("Computes the exact bitwise NOT of an integer; without bits it uses BigInt signed semantics, where NOT value is -value - 1, and with bits it complements inside an unsigned 8, 16, 32, or 64-bit field."),
        {
            value: numericInput,
            bits: widthOption.optional()
                .describe("Optional integer width in bits: 8, 16, 32, or 64; omit for unbounded BigInt signed semantics")
        },
        async ({ value, bits }) => reply(bitResult([value],
            ([a]) => bits === undefined ? ~a : BigInt.asUintN(bits, ~a))));
    const shiftInput = { value: numericInput, count: numericInput };
    mathServer.tool("shiftLeft", echoDescription("Arithmetically shifts an integer left by 0 to 64 bits without truncating the BigInt result."), shiftInput,
        async ({ value, count }) => reply(bitResult([value, count], ([a, shift]) => {
            if (shift < 0n || shift > 64n) throw new Error("Shift count must be between 0 and 64");
            return a << shift;
        })));
    mathServer.tool("shiftRight", echoDescription("Arithmetically shifts an integer right by 0 to 64 bits without truncating the BigInt result."), shiftInput,
        async ({ value, count }) => reply(bitResult([value, count], ([a, shift]) => {
            if (shift < 0n || shift > 64n) throw new Error("Shift count must be between 0 and 64");
            return a >> shift;
        })));

    return mathServer.server;
}

function bitResult(inputs: NumericInput[], operation: (values: bigint[]) => bigint): string {
    return formatInteger(inputs, operation(integers(inputs)));
}

function parseInBase(value: string, fromBase?: 2 | 8 | 10 | 16): bigint {
    const match = /^([+-]?)(.*)$/.exec(value.trim());
    if (!match || !match[2]) throw new Error("Expected an integer string");
    const sign = match[1] === "-" ? -1n : 1n;
    const prefixed = /^0([xXbBoO])(.+)$/.exec(match[2]);
    const base = prefixed ? prefixBase[prefixed[1].toLowerCase()] : fromBase ?? 10;
    if (prefixed && fromBase !== undefined && fromBase !== base) {
        throw new Error(`The 0${prefixed[1].toLowerCase()} prefix does not match fromBase ${fromBase}`);
    }
    const digits = (prefixed ? prefixed[2] : match[2]).toLowerCase();
    if (!baseDigits[base].test(digits)) throw new Error(`Expected base ${base} digits`);
    return sign * BigInt(basePrefix[base] + digits);
}

async function main() {
    const server = createServer();
    await server.connect(new StdioServerTransport());
    console.error("MCP Server running in stdio mode");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        console.error("Server error:", error);
        process.exit(1);
    });
}
