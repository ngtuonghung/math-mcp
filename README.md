# Math-MCP

Math-MCP is a Model Context Protocol (MCP) server exposing a small, deterministic
library of mathematical primitives. It is designed for LLMs and applications that
need reliable calculations, exact integer operations where practical, and a
consistent text-based tool interface.

## Primitives

- Arithmetic, roots, rounding, and factorial/combinatorial operations
- Exact modular arithmetic and prime factorization
- Number-base conversion and fixed-width integer encoding
- Bitwise AND/OR/XOR/NOT, bit-shift, bit-rotation, bit-inspection, alignment, and integer-casting operations
- Statistical summaries
- Trigonometric functions and angle conversion

## Installation

Requires [Node.js](https://nodejs.org/en/download).

Clone this repository and add it to your MCP configuration:

```json
"math": {
  "command": "node",
  "args": ["PATH/TO/PROJECT/math-mcp/build/index.js"]
}
```

Replace `PATH/TO/PROJECT` with the actual repository location. The build is not
committed; `npm install` creates it automatically. After modifying the source,
rebuild with:

```bash
npm run build
```

## Parameter names

Every tool names its operand the same way, so only two names have to be
remembered: **`numbers`** for a list of operands (`sum`, `product`, `mean`,
`median`, `mode`, `min`, `max`, `gcd`, `lcm`, `bitAnd`, `bitOr`, `bitXor`) and
**`value`** for the operand of every other tool. A second or modifying argument
keeps its own domain name: `addend`, `subtrahend`, `factor`, `divisor`,
`exponent`, `modulus`, `degree`, `k`, `count`, `bits`, `boundary`, `signed`,
`endian`, `fromBase`, and `toBase`.

## Numeric behavior

Numeric parameters accept JSON numbers, decimal strings, and `0x`-hex,
`0o`-octal, or `0b`-binary integer strings (hex requires the `0x` prefix, octal
`0o`, binary `0b`; all accept uppercase digits and a leading minus). Decimal
strings may carry a fraction or an exponent, such as `"2.5"` or `"1e3"`, so
clients that send scalar numbers as quoted strings can still reach the
floating-point tools. Prefixed forms are integers only. Bare digit strings are
always decimal. Use plain decimal strings for integers larger than
`9007199254740991`; unsafe, infinite, and `NaN` JSON numbers are rejected, as is
a result that is not finite.

For the arithmetic, divisibility, modular, root, combinatorial, bitwise,
rotation, bit-inspection, alignment, casting, and statistics tools, an integer
result follows the radix of the inputs by priority: any `0x`-hex input returns
`0x`-hex, otherwise any `0b`-binary input returns `0b`-binary, otherwise any
`0o`-octal input returns `0o`-octal, otherwise the result is decimal
(`-0x` / `-0b` / `-0o` for negatives, unpadded). A decimal count, width, or
degree therefore no longer drags a hexadecimal result back to decimal, and
writing one operand in hex is the way to ask for hex output. Floating-point
results are always decimal text; `mode` echoes radix entries but its frequency
stays decimal. `packInteger` always returns `0x`-prefixed hexadecimal bytes, and
`unpackInteger` requires the `0x` prefix on input and returns `0x`-hex.
`convertBase` returns the base prefix `0b`, `0o`, or `0x`; base 10 stays plain.

Operations backed by floating-point math reject large integer inputs when
conversion would lose precision. Discrete, modular, and bit-oriented operations
use exact `BigInt` arithmetic.

## Arithmetic and rounding

Arithmetic operations cover real-valued calculations, integer-safe exponentiation,
exact integer roots, rounding, and exact discrete counts.

| Operation | Description |
|---|---|
| `add` | Adds `addend` to `value`. |
| `subtract` | Subtracts `subtrahend` from `value`. |
| `multiply` | Multiplies `value` by `factor`. |
| `division` | Divides `value` by `divisor`. |
| `sum` | Adds one or more numbers. |
| `product` | Multiplies one or more numbers. |
| `modulo` | Returns the remainder of division, truncated toward zero, so the sign follows `value` (`-7 mod 3` is `-1`, not `2`). |
| `power` | Raises `value` to `exponent`. Nonnegative integer exponents are evaluated exactly, up to an exponent of `10000` and a result of `1000000` bits. |
| `exp` | Calculates `e^number`. |
| `floorRoot` | Calculates the integer floor of an nth root. Degree must be at least `1`; negative values support odd degrees. |
| `ceilRoot` | Calculates the integer ceiling of an nth root. Degree must be at least `1`; negative values support odd degrees. |
| `floor` | Rounds down to the nearest integer. |
| `ceiling` | Rounds up to the nearest integer. |
| `round` | Rounds to the nearest integer. |
| `factorial` | Calculates `value!` exactly for integers from `0` through `10000`. |
| `combination` | Calculates the binomial coefficient `C(value, k)` exactly for `value` up to `100000`. |
| `permutation` | Calculates ordered selections `P(value, k)` exactly for `value` up to `100000`. |

## Divisibility, modular, and prime operations

These operations provide exact integer foundations for number theory and
algebraic calculations.

| Operation | Description |
|---|---|
| `gcd` | Calculates the greatest common divisor of one or more integers. |
| `lcm` | Calculates the least common multiple of one or more integers. |
| `modPow` | Calculates `value^exponent mod modulus` for a nonnegative exponent and nonzero modulus. Modulus and exponent support up to 8192 bits. |
| `modInverse` | Calculates the multiplicative inverse modulo a nonzero modulus when it exists. |
| `factorize` | Returns ascending prime-power factors for integers from `2` through `2^64 - 1`. |

`factorize(360)` returns:

```json
{"factors":[{"prime":"2","exponent":"3"},{"prime":"3","exponent":"2"},{"prime":"5","exponent":"1"}]}
```

## Number representation and conversion

Representation operations convert between common integer formats and encode
fixed-width values with explicit byte layout.

| Operation | Description |
|---|---|
| `convertBase` | Converts an integer between bases `2`, `8`, `10`, and `16`. A `0b`, `0o`, or `0x` prefix on the input selects its base, otherwise the optional `fromBase` does, defaulting to base 10. The result carries the base prefix (`0b`, `0o`, `0x`; base 10 plain). |
| `packInteger` | Encodes an in-range integer as lowercase `0x`-prefixed hexadecimal bytes using a width of `8`, `16`, `32`, or `64` bits, signed or unsigned, little- or big-endian. Out-of-range values are rejected. |
| `unpackInteger` | Decodes `0x`-prefixed hexadecimal bytes as an integer using the same width, signedness, and endian options, and returns the integer as `0x`-hex. |

`convertBase` with `value="255"` and `toBase=16` returns `"0xff"`, and `value="0o755"` with
`toBase=16` returns `"0x1ed"`.

## Integer and bit operations

Bit operations use fixed and arbitrary `BigInt` behavior. They are useful for
alignment, masking, type wrapping, and low-level integer transformations.

| Operation | Description |
|---|---|
| `bitAnd` | Computes bitwise AND over one or more integers. |
| `bitOr` | Computes bitwise OR over one or more integers. |
| `bitXor` | Computes bitwise XOR over one or more integers. |
| `bitNot` | Computes bitwise NOT. Without `bits` it uses `BigInt` semantics (`NOT value` is `-value - 1`); with `bits` it complements inside an unsigned `8`, `16`, `32`, or `64`-bit field. |
| `shiftLeft` | Shifts an integer left by `0` to `64` bits. |
| `shiftRight` | Performs an arithmetic right shift by `0` to `64` bits. |
| `rotateLeft` | Rotates bits left within an `8`, `16`, `32`, or `64`-bit field. |
| `rotateRight` | Rotates bits right within an `8`, `16`, `32`, or `64`-bit field. |
| `bitLength` | Counts binary bits in a nonnegative integer; `0` has length `0`. |
| `bitCount` | Counts set bits in a nonnegative integer. |
| `trailingZeros` | Counts trailing zero bits in a nonzero nonnegative integer. |
| `castInteger` | Wraps an integer to a signed or unsigned `8`, `16`, `32`, or `64`-bit type and reports range status. |
| `align` | Returns the aligned boundaries at or below and above a nonnegative integer. |

`bitAnd`, `bitOr`, and `bitXor` fold their `numbers` array in order, so masking
several values takes one call. General bitwise operations use `BigInt`
semantics. Negative values use signed bitwise behavior, and shifts do not
truncate results to 64 bits (there is no logical, zero-filling right shift).
Rotations
operate on an unsigned fixed-width field and interpret the rotation count modulo
the selected width.
Bit-inspection operations reject negative values, and `trailingZeros(0)` is
rejected because it is mathematically undefined.

## Statistics

Statistical operations accept arrays of numeric values and echo the input radix
for integer results.

| Operation | Description |
|---|---|
| `mean` | Calculates the arithmetic mean. |
| `median` | Calculates the median. |
| `mode` | Reports the most frequent value or values and their frequency. |
| `min` | Finds the smallest value. |
| `max` | Finds the largest value. |

## Trigonometry

Trigonometric operations use radians unless explicitly converting units.

| Operation | Description |
|---|---|
| `sin` | Calculates sine. |
| `cos` | Calculates cosine. |
| `tan` | Calculates tangent. |
| `arcsin` | Calculates inverse sine. |
| `arccos` | Calculates inverse cosine. |
| `arctan` | Calculates inverse tangent. |
| `radiansToDegrees` | Converts radians to degrees. |
| `degreesToRadians` | Converts degrees to radians. |

## Development

```bash
npm run build
npm test
```

Source lives in `src/`. Tests are isolated in `test/` and intentionally excluded
from the distributed build.
