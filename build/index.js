import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { Arithmetic } from "./Classes/Arithmetic.js";
import { Statistics } from "./Classes/Statistics.js";
import { Trigonometric } from "./Classes/Trigonometric.js";
import { calculate, format, integers, isHex, mode, numericInput } from "./Numeric.js";
const reply = (text) => ({ content: [{ type: "text", text }] });
const pair = { firstNumber: numericInput, secondNumber: numericInput };
const list = { numbers: z.array(numericInput).min(1) };
const unary = { number: numericInput };
const sum = (values) => values.reduce((total, value) => total + value, 0n);
const safe = (value) => {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("A non-integer calculation cannot safely use this large integer");
    }
};
export default function createServer() {
    const mathServer = new McpServer({ name: "math", version: "0.1.1" });
    mathServer.tool("add", "Adds two numbers together", pair, async ({ firstNumber, secondNumber }) => reply(calculate([firstNumber, secondNumber], ([a, b]) => Arithmetic.add(a, b), ([a, b]) => a + b)));
    mathServer.tool("subtract", "Subtracts the second number from the first number", { minuend: numericInput, subtrahend: numericInput }, async ({ minuend, subtrahend }) => reply(calculate([minuend, subtrahend], ([a, b]) => Arithmetic.subtract(a, b), ([a, b]) => a - b)));
    mathServer.tool("multiply", "Multiplies two numbers together", pair, async ({ firstNumber, secondNumber }) => reply(calculate([firstNumber, secondNumber], ([a, b]) => Arithmetic.multiply(a, b), ([a, b]) => a * b)));
    mathServer.tool("division", "Divides the first number by the second number", { numerator: numericInput, denominator: numericInput }, async ({ numerator, denominator }) => reply(calculate([numerator, denominator], ([a, b]) => Arithmetic.division(a, b), ([a, b]) => {
        if (b === 0n)
            throw new Error("Division by zero");
        if (a % b === 0n)
            return a / b;
        safe(a);
        safe(b);
    })));
    mathServer.tool("sum", "Adds any number of numbers together", list, async ({ numbers }) => reply(calculate(numbers, values => Arithmetic.sum(values), sum)));
    mathServer.tool("modulo", "Divides two numbers and returns the remainder", { numerator: numericInput, denominator: numericInput }, async ({ numerator, denominator }) => reply(calculate([numerator, denominator], ([a, b]) => Arithmetic.modulo(a, b), ([a, b]) => {
        if (b === 0n)
            throw new Error("Modulo by zero");
        return a % b;
    })));
    mathServer.tool("mean", "Calculates the arithmetic mean of a list of numbers", list, async ({ numbers }) => reply(calculate(numbers, values => Statistics.mean(values), values => {
        const total = sum(values);
        const count = BigInt(values.length);
        if (total % count === 0n)
            return total / count;
        safe(total);
    })));
    mathServer.tool("median", "Calculates the median of a list of numbers", list, async ({ numbers }) => reply(calculate(numbers, values => Statistics.median(values), values => {
        const sorted = [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
        const middle = Math.floor(sorted.length / 2);
        if (sorted.length % 2)
            return sorted[middle];
        const total = sorted[middle - 1] + sorted[middle];
        if (total % 2n === 0n)
            return total / 2n;
        safe(total);
    })));
    mathServer.tool("mode", "Finds the most common number in a list of numbers", { numbers: z.array(numericInput) }, async ({ numbers }) => reply(mode(numbers)));
    mathServer.tool("min", "Finds the minimum value from a list of numbers", { numbers: z.array(numericInput) }, async ({ numbers }) => reply(calculate(numbers, values => Statistics.min(values), values => values.reduce((min, value) => value < min ? value : min))));
    mathServer.tool("max", "Finds the maximum value from a list of numbers", { numbers: z.array(numericInput) }, async ({ numbers }) => reply(calculate(numbers, values => Statistics.max(values), values => values.reduce((max, value) => value > max ? value : max))));
    mathServer.tool("floor", "Rounds a number down to the nearest integer", unary, async ({ number }) => reply(calculate([number], ([value]) => Arithmetic.floor(value), ([value]) => value)));
    mathServer.tool("ceiling", "Rounds a number up to the nearest integer", unary, async ({ number }) => reply(calculate([number], ([value]) => Arithmetic.ceil(value), ([value]) => value)));
    mathServer.tool("round", "Rounds a number to the nearest integer", unary, async ({ number }) => reply(calculate([number], ([value]) => Arithmetic.round(value), ([value]) => value)));
    mathServer.tool("sin", "Calculates the sine of a number in radians", unary, async ({ number }) => reply(calculate([number], ([value]) => Trigonometric.sin(value))));
    mathServer.tool("arcsin", "Calculates the arcsine of a number in radians", unary, async ({ number }) => reply(calculate([number], ([value]) => Trigonometric.arcsin(value))));
    mathServer.tool("cos", "Calculates the cosine of a number in radians", unary, async ({ number }) => reply(calculate([number], ([value]) => Trigonometric.cos(value))));
    mathServer.tool("arccos", "Calculates the arccosine of a number in radians", unary, async ({ number }) => reply(calculate([number], ([value]) => Trigonometric.arccos(value))));
    mathServer.tool("tan", "Calculates the tangent of a number in radians", unary, async ({ number }) => reply(calculate([number], ([value]) => Trigonometric.tan(value))));
    mathServer.tool("arctan", "Calculates the arctangent of a number in radians", unary, async ({ number }) => reply(calculate([number], ([value]) => Trigonometric.arctan(value))));
    mathServer.tool("radiansToDegrees", "Converts radians to degrees", unary, async ({ number }) => reply(calculate([number], ([value]) => Trigonometric.radiansToDegrees(value))));
    mathServer.tool("degreesToRadians", "Converts degrees to radians", unary, async ({ number }) => reply(calculate([number], ([value]) => Trigonometric.degreesToRadians(value))));
    mathServer.tool("align", "Returns the aligned boundaries at or below and at or above a value", { value: numericInput, boundary: numericInput }, async ({ value, boundary }) => {
        const [address, size] = integers([value, boundary]);
        if (address < 0n || size <= 0n)
            throw new Error("Value must be nonnegative and boundary positive");
        const down = address / size * size;
        const up = down === address ? down : down + size;
        const hex = isHex(value) || isHex(boundary);
        return reply(JSON.stringify({ down: format(down, hex), up: format(up, hex) }));
    });
    mathServer.tool("castInteger", "Wraps an integer to a signed or unsigned 8, 16, 32, or 64-bit type", { value: numericInput, bits: z.union([z.literal(8), z.literal(16), z.literal(32), z.literal(64)]), signed: z.boolean() }, async ({ value, bits, signed }) => {
        const [input] = integers([value]);
        const width = BigInt(bits);
        const min = signed ? -(1n << (width - 1n)) : 0n;
        const max = (1n << (signed ? width - 1n : width)) - 1n;
        const result = signed ? BigInt.asIntN(bits, input) : BigInt.asUintN(bits, input);
        const hex = isHex(value);
        return reply(JSON.stringify({
            result: format(result, hex), min: format(min, hex), max: format(max, hex),
            status: input < min ? "underflow" : input > max ? "overflow" : "inRange"
        }));
    });
    const bitPair = { firstNumber: numericInput, secondNumber: numericInput };
    mathServer.tool("bitAnd", "Bitwise AND of two integers", bitPair, async ({ firstNumber, secondNumber }) => reply(bitResult([firstNumber, secondNumber], ([a, b]) => a & b)));
    mathServer.tool("bitOr", "Bitwise OR of two integers", bitPair, async ({ firstNumber, secondNumber }) => reply(bitResult([firstNumber, secondNumber], ([a, b]) => a | b)));
    mathServer.tool("bitXor", "Bitwise XOR of two integers", bitPair, async ({ firstNumber, secondNumber }) => reply(bitResult([firstNumber, secondNumber], ([a, b]) => a ^ b)));
    const shiftInput = { number: numericInput, count: numericInput };
    mathServer.tool("shiftLeft", "Shifts an integer left by 0 to 64 bits", shiftInput, async ({ number, count }) => reply(bitResult([number, count], ([value, shift]) => {
        if (shift < 0n || shift > 64n)
            throw new Error("Shift count must be between 0 and 64");
        return value << shift;
    })));
    mathServer.tool("shiftRight", "Arithmetic right shift by 0 to 64 bits", shiftInput, async ({ number, count }) => reply(bitResult([number, count], ([value, shift]) => {
        if (shift < 0n || shift > 64n)
            throw new Error("Shift count must be between 0 and 64");
        return value >> shift;
    })));
    return mathServer.server;
}
function bitResult(inputs, operation) {
    return format(operation(integers(inputs)), inputs.some(isHex));
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
