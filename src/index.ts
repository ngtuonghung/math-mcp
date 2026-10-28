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
import { calculate, format, formatHex, formatInteger, integers, isHex, mode, numericInput } from "./Numeric.js";
import type { NumericInput } from "./Numeric.js";

const reply = (text: string) => ({ content: [{ type: "text" as const, text }] });
const numericDoc = " Numeric arguments accept JSON numbers, decimal integer strings, or 0x-hex integer strings; string inputs accept integers only.";
const numericDescription = (description: string) => description + numericDoc;
const echoDoc = " If every numeric input is a 0x-hex string, integer results are returned as 0x-hex; otherwise results are decimal.";
const echoDescription = (description: string) => numericDescription(description) + echoDoc;
const pair = { firstNumber: numericInput, secondNumber: numericInput };
const list = { numbers: z.array(numericInput).min(1)
    .describe("One or more numeric values; each accepts a JSON number, a decimal integer string, or a 0x-hex integer string.") };
const unary = { number: numericInput };
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

export default function createServer() {
    const mathServer = new McpServer({ name: "math", version: "0.5.0" });

    mathServer.tool("add", echoDescription("Adds firstNumber and secondNumber; integer inputs are exact."), pair,
        async ({ firstNumber, secondNumber }) => reply(calculate([firstNumber, secondNumber],
            ([a, b]) => Arithmetic.add(a, b), ([a, b]) => a + b)));
    mathServer.tool("subtract", echoDescription("Subtracts subtrahend from minuend; integer inputs are exact."),
        { minuend: numericInput, subtrahend: numericInput },
        async ({ minuend, subtrahend }) => reply(calculate([minuend, subtrahend],
            ([a, b]) => Arithmetic.subtract(a, b), ([a, b]) => a - b)));
    mathServer.tool("multiply", echoDescription("Multiplies firstNumber by secondNumber; integer inputs are exact."), pair,
        async ({ firstNumber, secondNumber }) => reply(calculate([firstNumber, secondNumber],
            ([a, b]) => Arithmetic.multiply(a, b), ([a, b]) => a * b)));
    mathServer.tool("division", echoDescription("Divides numerator by denominator; exact for integer inputs that divide evenly, otherwise floating-point; denominator cannot be zero."),
        { numerator: numericInput, denominator: numericInput },
        async ({ numerator, denominator }) => reply(calculate([numerator, denominator],
            ([a, b]) => Arithmetic.division(a, b), ([a, b]) => {
                if (b === 0n) throw new Error("Division by zero");
                if (a % b === 0n) return a / b;
                safe(a); safe(b);
            })));
    mathServer.tool("sum", echoDescription("Adds one or more numbers in order; integer inputs are exact."), list,
        async ({ numbers }) => reply(calculate(numbers,
            values => Arithmetic.sum(values), sum)));
    mathServer.tool("modulo", echoDescription("Returns the remainder after dividing numerator by denominator; integer inputs are exact; denominator cannot be zero."),
        { numerator: numericInput, denominator: numericInput },
        async ({ numerator, denominator }) => reply(calculate([numerator, denominator],
            ([a, b]) => Arithmetic.modulo(a, b), ([a, b]) => {
                if (b === 0n) throw new Error("Modulo by zero");
                return a % b;
            })));
    mathServer.tool("power", echoDescription("Raises base to exponent; nonnegative integer exponents up to 10000 are exact, while negative exponents use floating-point; zero cannot have a negative exponent."),
        { base: numericInput, exponent: numericInput },
        async ({ base, exponent }) => reply(calculate([base, exponent],
            ([a, b]) => {
                if (a === 0 && b < 0) throw new Error("Zero cannot be raised to a negative power");
                return Arithmetic.power(a, b);
            }, ([a, b]) => {
                if (b < 0n) {
                    if (a === 0n) throw new Error("Zero cannot be raised to a negative power");
                    return undefined;
                }
                if (b > 10000n) throw new Error("Integer exponent must be at most 10000 for exact results");
                return a ** b;
            })));
    mathServer.tool("floorRoot", numericDescription("Calculates the exact integer floor of the nth root; the degree must be at least 1 and a negative value supports only an odd degree."),
        { number: numericInput, n: numericInput },
        async ({ number, n }) => {
            const [value, degree] = integers([number, n]);
            return reply(format(floorRoot(value, degree)));
        });
    mathServer.tool("ceilRoot", numericDescription("Calculates the exact integer ceiling of the nth root; the degree must be at least 1 and a negative value supports only an odd degree."),
        { number: numericInput, n: numericInput },
        async ({ number, n }) => {
            const [value, degree] = integers([number, n]);
            return reply(format(ceilRoot(value, degree)));
        });
    mathServer.tool("gcd", numericDescription("Calculates the exact greatest common divisor of one or more integers."), list,
        async ({ numbers }) => reply(format(gcd(integers(numbers)))));
    mathServer.tool("lcm", numericDescription("Calculates the exact least common multiple of one or more integers."), list,
        async ({ numbers }) => reply(format(lcm(integers(numbers)))));
    mathServer.tool("exp", numericDescription("Calculates e raised to the given power using floating-point arithmetic."), unary,
        async ({ number }) => reply(calculate([number], ([value]) => Math.exp(value))));
    mathServer.tool("factorial", numericDescription("Calculates the exact factorial n! for an integer from 0 through 10000."),
        { n: numericInput },
        async ({ n }) => {
            const [value] = integers([n]);
            if (value < 0n || value > 10000n) throw new Error("n must be between 0 and 10000");
            return reply(factorial(value).toString());
        });
    mathServer.tool("combination", numericDescription("Calculates the exact binomial coefficient C(n, k) for n from 0 through 100000 and 0 <= k <= n."),
        { n: numericInput, k: numericInput },
        async ({ n, k }) => {
            const [total, choose] = integers([n, k]);
            if (total < 0n || total > 100000n) throw new Error("n must be between 0 and 100000");
            if (choose < 0n || choose > total) throw new Error("k must be between 0 and n");
            return reply(combination(total, choose).toString());
        });
    mathServer.tool("permutation", numericDescription("Calculates the exact number of ordered selections P(n, k) for n from 0 through 100000 and 0 <= k <= n."),
        { n: numericInput, k: numericInput },
        async ({ n, k }) => {
            const [total, choose] = integers([n, k]);
            if (total < 0n || total > 100000n) throw new Error("n must be between 0 and 100000");
            if (choose < 0n || choose > total) throw new Error("k must be between 0 and n");
            return reply(falling(total, choose).toString());
        });
    mathServer.tool("convertBase", "Converts an exact integer string between bases 2, 8, 10, and 16 and returns lowercase digits without a prefix.",
        {
            value: z.string().min(1)
                .describe("Integer in fromBase, using digits valid for that base; an optional sign is allowed, and an optional 0x prefix is allowed for base 16"),
            fromBase: baseOption, toBase: baseOption
        },
        async ({ value, fromBase, toBase }) => {
            const match = /^([+-]?)(.*)$/.exec(value.trim());
            if (!match || !match[2]) throw new Error("Expected an integer string");
            const digits = fromBase === 16 ? match[2].replace(/^0[xX]/, "") : match[2];
            if (!baseDigits[fromBase].test(digits)) throw new Error(`Expected base ${fromBase} digits`);
            const magnitude = BigInt(basePrefix[fromBase] + digits.toLowerCase());
            return reply((match[1] === "-" ? -magnitude : magnitude).toString(toBase));
        });

    mathServer.tool("modPow", echoDescription("Calculates base raised to a nonnegative exponent modulo a nonzero modulus exactly; exponent and modulus are limited to 8192 bits."),
        { base: numericInput, exponent: numericInput, modulus: numericInput },
        async ({ base, exponent, modulus }) => {
            const [a, b, m] = integers([base, exponent, modulus]);
            return reply(formatInteger([base, exponent, modulus], modularExponentiation(a, b, m)));
        });
    mathServer.tool("modInverse", echoDescription("Calculates the exact multiplicative inverse of value modulo a nonzero modulus when that inverse exists; the modulus is limited to 8192 bits."),
        { value: numericInput, modulus: numericInput },
        async ({ value, modulus }) => {
            const [a, m] = integers([value, modulus]);
            return reply(formatInteger([value, modulus], modularInverse(a, m)));
        });
    mathServer.tool("factorize", numericDescription("Returns the exact ascending prime-power factorization for an integer from 2 through 2^64 - 1."),
        { value: numericInput },
        async ({ value }) => {
            const [number] = integers([value]);
            return reply(JSON.stringify({
                factors: factorize(number).map(({ prime, exponent }) => ({
                    prime: prime.toString(), exponent: exponent.toString()
                }))
            }));
        });
    mathServer.tool("bitLength", numericDescription("Counts the significant binary bits in a nonnegative integer; 0 has bit length 0."),
        { value: numericInput },
        async ({ value }) => {
            const [number] = integers([value]);
            return reply(bitLength(number).toString());
        });
    mathServer.tool("bitCount", numericDescription("Counts the set binary bits in a nonnegative integer."),
        { value: numericInput },
        async ({ value }) => {
            const [number] = integers([value]);
            return reply(bitCount(number).toString());
        });
    mathServer.tool("trailingZeros", numericDescription("Counts trailing zero binary bits in a nonzero nonnegative integer; 0 is undefined."),
        { value: numericInput },
        async ({ value }) => {
            const [number] = integers([value]);
            return reply(trailingZeros(number).toString());
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
    mathServer.tool("packInteger", numericDescription("Encodes an in-range integer as lowercase hexadecimal bytes using the selected width, signedness, and byte order."), packInput,
        async ({ value, bits, signed, endian }) => {
            const [number] = integers([value]);
            return reply(packInteger(number, bits, signed, endian === "little"));
        });
    mathServer.tool("unpackInteger", "Decodes exact hexadecimal bytes into an integer using the selected width, signedness, and byte order.",
        {
            value: z.string().min(1)
                .describe("Exactly width / 8 hexadecimal digits, as one string; an optional 0x prefix is allowed and surrounding or intervening whitespace is ignored"),
            bits: widthOption, signed: signedOption, endian: endianOption
        },
        async ({ value, bits, signed, endian }) => {
            return reply(format(unpackInteger(value, bits, signed, endian === "little")));
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
        async ({ number }) => reply(calculate([number], ([value]) => Arithmetic.floor(value), ([value]) => value)));
    mathServer.tool("ceiling", numericDescription("Rounds a number up to the nearest integer; integer inputs are exact."), unary,
        async ({ number }) => reply(calculate([number], ([value]) => Arithmetic.ceil(value), ([value]) => value)));
    mathServer.tool("round", numericDescription("Rounds a number to the nearest integer; integer inputs are exact."), unary,
        async ({ number }) => reply(calculate([number], ([value]) => Arithmetic.round(value), ([value]) => value)));

    mathServer.tool("sin", numericDescription("Calculates the sine of an angle in radians using floating-point arithmetic."), unary,
        async ({ number }) => reply(calculate([number], ([value]) => Trigonometric.sin(value))));
    mathServer.tool("arcsin", numericDescription("Calculates the inverse sine in radians using floating-point arithmetic; input must be in [-1, 1]."), unary,
        async ({ number }) => reply(calculate([number], ([value]) => Trigonometric.arcsin(value))));
    mathServer.tool("cos", numericDescription("Calculates the cosine of an angle in radians using floating-point arithmetic."), unary,
        async ({ number }) => reply(calculate([number], ([value]) => Trigonometric.cos(value))));
    mathServer.tool("arccos", numericDescription("Calculates the inverse cosine in radians using floating-point arithmetic; input must be in [-1, 1]."), unary,
        async ({ number }) => reply(calculate([number], ([value]) => Trigonometric.arccos(value))));
    mathServer.tool("tan", numericDescription("Calculates the tangent of an angle in radians using floating-point arithmetic."), unary,
        async ({ number }) => reply(calculate([number], ([value]) => Trigonometric.tan(value))));
    mathServer.tool("arctan", numericDescription("Calculates the inverse tangent in radians using floating-point arithmetic."), unary,
        async ({ number }) => reply(calculate([number], ([value]) => Trigonometric.arctan(value))));
    mathServer.tool("radiansToDegrees", numericDescription("Converts an angle from radians to degrees using floating-point arithmetic."), unary,
        async ({ number }) => reply(calculate([number], ([value]) => Trigonometric.radiansToDegrees(value))));
    mathServer.tool("degreesToRadians", numericDescription("Converts an angle from degrees to radians using floating-point arithmetic."), unary,
        async ({ number }) => reply(calculate([number], ([value]) => Trigonometric.degreesToRadians(value))));

    mathServer.tool("align", echoDescription("Returns the exact aligned boundaries at or below and at or above value; value must be nonnegative and boundary must be positive."),
        { value: numericInput, boundary: numericInput },
        async ({ value, boundary }) => {
            const [address, size] = integers([value, boundary]);
            if (address < 0n || size <= 0n) throw new Error("Value must be nonnegative and boundary positive");
            const down = address / size * size;
            const up = down === address ? down : down + size;
            const hex = [value, boundary].every(isHex);
            return reply(JSON.stringify({ down: formatHex(down, hex), up: formatHex(up, hex) }));
        });

    mathServer.tool("castInteger", echoDescription("Wraps an integer to a signed or unsigned 8, 16, 32, or 64-bit type and reports whether the original value was in range."),
        { value: numericInput, bits: widthOption, signed: signedOption },
        async ({ value, bits, signed }) => {
            const [input] = integers([value]);
            const width = BigInt(bits);
            const min = signed ? -(1n << (width - 1n)) : 0n;
            const max = (1n << (signed ? width - 1n : width)) - 1n;
            const result = signed ? BigInt.asIntN(bits, input) : BigInt.asUintN(bits, input);
            const hex = isHex(value);
            return reply(JSON.stringify({
                result: formatHex(result, hex), min: formatHex(min, hex), max: formatHex(max, hex),
                status: input < min ? "underflow" : input > max ? "overflow" : "inRange"
            }));
        });

    const bitPair = { firstNumber: numericInput, secondNumber: numericInput };
    mathServer.tool("bitAnd", echoDescription("Computes the exact bitwise AND of two integers using BigInt signed semantics."), bitPair,
        async ({ firstNumber, secondNumber }) => reply(bitResult([firstNumber, secondNumber], ([a, b]) => a & b)));
    mathServer.tool("bitOr", echoDescription("Computes the exact bitwise OR of two integers using BigInt signed semantics."), bitPair,
        async ({ firstNumber, secondNumber }) => reply(bitResult([firstNumber, secondNumber], ([a, b]) => a | b)));
    mathServer.tool("bitXor", echoDescription("Computes the exact bitwise XOR of two integers using BigInt signed semantics."), bitPair,
        async ({ firstNumber, secondNumber }) => reply(bitResult([firstNumber, secondNumber], ([a, b]) => a ^ b)));
    const shiftInput = { number: numericInput, count: numericInput };
    mathServer.tool("shiftLeft", echoDescription("Arithmetically shifts an integer left by 0 to 64 bits without truncating the BigInt result."), shiftInput,
        async ({ number, count }) => reply(bitResult([number, count], ([value, shift]) => {
            if (shift < 0n || shift > 64n) throw new Error("Shift count must be between 0 and 64");
            return value << shift;
        })));
    mathServer.tool("shiftRight", echoDescription("Arithmetically shifts an integer right by 0 to 64 bits without truncating the BigInt result."), shiftInput,
        async ({ number, count }) => reply(bitResult([number, count], ([value, shift]) => {
            if (shift < 0n || shift > 64n) throw new Error("Shift count must be between 0 and 64");
            return value >> shift;
        })));

    return mathServer.server;
}

function bitResult(inputs: NumericInput[], operation: (values: bigint[]) => bigint): string {
    return formatInteger(inputs, operation(integers(inputs)));
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
