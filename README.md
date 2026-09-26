# Math-MCP

A Model Context Protocol (MCP) server that provides basic mathematical, statistical and trigonometric functions to Large Language Models (LLMs). This server enables LLMs to perform accurate numerical calculations through a simple API.

<a href="https://glama.ai/mcp/servers/exa5lt8dgd">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/exa5lt8dgd/badge" alt="Math-MCP MCP server" />
</a>

## Features

- Basic arithmetic operations (addition, subtraction, multiplication, division, sum, modulo)
- Statistical functions (mean, median, mode, min, max)
- Rounding functions (floor, ceiling, round)
- Trigonometric functions (sin, cos, tan, and their inverses; degrees/radians conversions)
- Exponentiation, nth roots, and base conversion (2, 8, 10, 16)
- Decimal-only inputs, alignment, and bitwise operations

## Installation
> **Note:** Ensure you have [Node.js](https://nodejs.org/en/download) installed on your computer.

Just clone this repository and save it locally somewhere on your computer.

Then add this server to your MCP configuration file:

```json
"math": {
  "command": "node",
  "args": ["PATH\\TO\\PROJECT\\math-mcp\\build\\index.js"]
}
```

Here is an example for OpenCode

```json
{
  "mcp": {
    "math-mcp": {
      "type": "local",
      "command": [
        "node",
        "PATH\\TO\\PROJECT\\math-mcp\\build\\index.js"
      ]
    }
  }
}
```

Replace `PATH\\TO\\PROJECT` with the actual path to where you cloned the repository.

> **Note:** This project comes prebuilt, so installation is easy but if you change anything in the code, rebuild the project with `npm run build`.

## Available Functions

The Math-MCP server provides the following mathematical operations:

All numeric parameters accept JSON numbers and decimal integer strings (for
example, `"9007199254740993"`). Hexadecimal, octal, and binary inputs are
rejected; use the `convertBase` tool for base conversion. Use strings for
integers larger than `9007199254740991`; unsafe JSON integers are rejected.
Decimal strings do not support fractional values; pass those as JSON numbers.

Results remain MCP text and are always decimal. Calculations requiring floating
point values reject large integer inputs when converting them would lose precision.

### Arithmetic Operations
| Function | Description | Parameters |
|----------|-------------|------------|
| `add` | Adds two numbers together | `firstNumber`: The first addend<br>`secondNumber`: The second addend |
| `subtract` | Subtracts the second number from the first number | `minuend`: The number to subtract from (minuend)<br>`subtrahend`: The number being subtracted (subtrahend) |
| `multiply` | Multiplies two numbers together | `firstNumber`: The first number<br>`secondNumber`: The second number |
| `division` | Divides the first number by the second number | `numerator`: The number being divided (numerator)<br>`denominator`: The number to divide by (denominator) |
| `sum` | Adds any number of numbers together | `numbers`: Array of numbers to sum |
| `modulo` | Divides two numbers and returns the remainder | `numerator`: The number being divided (numerator)<br>`denominator`: The number to divide by (denominator) |
| `power` | Raises a base to an exponent; exact integer math for nonnegative integer exponents (exponent at most 10000), decimal otherwise | `base`: The base<br>`exponent`: The exponent |
| `nthRoot` | Calculates the nth root of a number; odd roots of negative numbers are supported | `number`: The number to find the root of<br>`n`: The root degree (nonzero integer) |
| `exp` | Calculates e raised to the given power | `number`: The exponent |
| `factorial` | Calculates the factorial of a nonnegative integer exactly | `n`: Nonnegative integer, at most `10000` |
| `combination` | Calculates the binomial coefficient C(n, k) exactly | `n`: Total items, at most `100000`<br>`k`: Items to choose |
| `permutation` | Calculates the number of ordered selections P(n, k) exactly | `n`: Total items, at most `100000`<br>`k`: Items to select |
| `floor` | Rounds a number down to the nearest integer | `number`: The number to round down |
| `ceiling` | Rounds a number up to the nearest integer | `number`: The number to round up |
| `round` | Rounds a number to the nearest integer | `number`: The number to round |

### Statistical Operations
| Function | Description | Parameters |
|----------|-------------|------------|
| `mean` | Calculates the arithmetic mean of a list of numbers | `numbers`: Array of numbers to find the mean of |
| `median` | Calculates the median of a list of numbers | `numbers`: Array of numbers to find the median of |
| `mode` | Finds the most common number in a list of numbers | `numbers`: Array of numbers to find the mode of |
| `min` | Finds the minimum value from a list of numbers | `numbers`: Array of numbers to find the minimum of |
| `max` | Finds the maximum value from a list of numbers | `numbers`: Array of numbers to find the maximum of |

### Trigonometric Operations
| Function | Description | Parameters |
|----------|-------------|------------|
| `sin` | Calculates the sine of a number in radians | `number`: The number in radians to find the sine of |
| `arcsin` | Calculates the arcsine (in radians) of a number | `number`: The number to find the arcsine of |
| `cos` | Calculates the cosine of a number in radians | `number`: The number in radians to find the cosine of |
| `arccos` | Calculates the arccosine (in radians) of a number | `number`: The number to find the arccosine of |
| `tan` | Calculates the tangent of a number in radians | `number`: The number in radians to find the tangent of |
| `arctan` | Calculates the arctangent (in radians) of a number | `number`: The number to find the arctangent of |
| `radiansToDegrees` | Converts a radian value to its equivalent in degrees | `number`: The number in radians to convert to degrees |
| `degreesToRadians` | Converts a degree value to its equivalent in radians | `number`: The number in degrees to convert to radians |

### Base Conversion
| Function | Description | Parameters |
|----------|-------------|------------|
| `convertBase` | Converts an integer string between bases 2, 8, 10, and 16 and returns lowercase digits with a `-` sign for negatives (no prefixes) | `value`: Integer string<br>`fromBase`: `2`, `8`, `10`, or `16`<br>`toBase`: `2`, `8`, `10`, or `16` |

For example, `{"value":"255","fromBase":10,"toBase":16}` returns `"ff"`, and
`{"value":"0xff","fromBase":16,"toBase":10}` returns `"255"`. Hex input may
include an optional `0x` prefix.

### Alignment and Bitwise Operations
| Function | Description | Parameters |
|----------|-------------|------------|
| `align` | Returns the aligned value at or below and at or above a nonnegative integer as JSON text, such as `{"down":"4096","up":"8192"}` | `value`: Nonnegative integer<br>`boundary`: Positive integer |
| `castInteger` | Wraps an integer to the selected type and returns `result`, `min`, `max`, and `status` (`inRange`, `overflow`, or `underflow`) as JSON text | `value`: Integer<br>`bits`: `8`, `16`, `32`, or `64`<br>`signed`: Boolean |
| `bitAnd` | Bitwise AND | `firstNumber`, `secondNumber`: Integers |
| `bitOr` | Bitwise OR | `firstNumber`, `secondNumber`: Integers |
| `bitXor` | Bitwise XOR | `firstNumber`, `secondNumber`: Integers |
| `shiftLeft` | Left shift | `number`: Integer<br>`count`: Integer from 0 to 64 |
| `shiftRight` | Arithmetic right shift | `number`: Integer<br>`count`: Integer from 0 to 64 |

Bitwise operations use `BigInt` semantics. Negative values use signed bitwise
behavior; shifts do not truncate results to 64 bits.

`castInteger` keeps the low `bits` bits and interprets them as signed or
unsigned. For example, `{"value":300,"bits":8,"signed":false}` returns
`{"result":"44","min":"0","max":"255","status":"overflow"}`.
