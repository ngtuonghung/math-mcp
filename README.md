# Math-MCP

Math-MCP is a Model Context Protocol (MCP) server exposing a small, deterministic
library of mathematical primitives. It is designed for LLMs and applications that
need reliable calculations, exact integer operations where practical, and a
consistent text-based tool interface.

## Primitives

- Arithmetic, roots, rounding, and factorial/combinatorial operations
- Exact modular arithmetic and prime factorization
- Number-base conversion and fixed-width integer encoding
- Bitwise, bit-shift, bit-rotation, bit-inspection, alignment, and integer-casting operations
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

Replace `PATH/TO/PROJECT` with the actual repository location. The repository
ships with a build. If you modify the source, rebuild with:

```bash
npm run build
```

## Numeric behavior

Numeric parameters accept JSON numbers and decimal integer strings. Use strings
for integers larger than `9007199254740991`; unsafe JSON integers are rejected.
Decimal integer strings do not accept fractional parts or alternate bases.

Results are returned as decimal MCP text. Operations backed by floating-point
math reject large integer inputs when conversion would lose precision. Discrete,
modular, and bit-oriented operations use exact `BigInt` arithmetic.

## Arithmetic and rounding

Arithmetic operations cover real-valued calculations, integer-safe exponentiation,
exact integer roots, rounding, and exact discrete counts.

| Operation | Description |
|---|---|
| `add` | Adds two numbers. |
| `subtract` | Subtracts the second number from the first. |
| `multiply` | Multiplies two numbers. |
| `division` | Divides the first number by the second. |
| `sum` | Adds an array of numbers. |
| `modulo` | Returns the remainder of division. |
| `power` | Raises a base to an exponent. Nonnegative integer exponents are evaluated exactly, up to an exponent of `10000`. |
| `exp` | Calculates `e^number`. |
| `floorRoot` | Calculates the integer floor of an nth root. Degree must be at least `1`; negative values support odd degrees. |
| `ceilRoot` | Calculates the integer ceiling of an nth root. Degree must be at least `1`; negative values support odd degrees. |
| `floor` | Rounds down to the nearest integer. |
| `ceiling` | Rounds up to the nearest integer. |
| `round` | Rounds to the nearest integer. |
| `factorial` | Calculates `n!` exactly for integers from `0` through `10000`. |
| `combination` | Calculates the binomial coefficient `C(n, k)` exactly for `n` up to `100000`. |
| `permutation` | Calculates ordered selections `P(n, k)` exactly for `n` up to `100000`. |

## Divisibility, modular, and prime operations

These operations provide exact integer foundations for number theory and
algebraic calculations.

| Operation | Description |
|---|---|
| `gcd` | Calculates the greatest common divisor of one or more integers. |
| `lcm` | Calculates the least common multiple of one or more integers. |
| `modPow` | Calculates `base^exponent mod modulus` for a nonnegative exponent and nonzero modulus. Modulus and exponent support up to 8192 bits. |
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
| `convertBase` | Converts an integer between bases `2`, `8`, `10`, and `16`. Hex input may include an optional `0x` prefix. |
| `packInteger` | Encodes an in-range integer as lowercase hexadecimal bytes using a width of `8`, `16`, `32`, or `64` bits, signed or unsigned, little- or big-endian. Out-of-range values are rejected. |
| `unpackInteger` | Decodes hexadecimal bytes as an integer using the same width, signedness, and endian options. |

`convertBase` with `value="255"`, `fromBase=10`, and `toBase=16` returns `"ff"`.

## Integer and bit operations

Bit operations use fixed and arbitrary `BigInt` behavior. They are useful for
alignment, masking, type wrapping, and low-level integer transformations.

| Operation | Description |
|---|---|
| `bitAnd` | Computes bitwise AND. |
| `bitOr` | Computes bitwise OR. |
| `bitXor` | Computes bitwise XOR. |
| `shiftLeft` | Shifts an integer left by `0` to `64` bits. |
| `shiftRight` | Performs an arithmetic right shift by `0` to `64` bits. |
| `rotateLeft` | Rotates bits left within an `8`, `16`, `32`, or `64`-bit field. |
| `rotateRight` | Rotates bits right within an `8`, `16`, `32`, or `64`-bit field. |
| `bitLength` | Counts binary bits in a nonnegative integer; `0` has length `0`. |
| `bitCount` | Counts set bits in a nonnegative integer. |
| `trailingZeros` | Counts trailing zero bits in a nonzero nonnegative integer. |
| `castInteger` | Wraps an integer to a signed or unsigned `8`, `16`, `32`, or `64`-bit type and reports range status. |
| `align` | Returns the aligned boundaries at or below and above a nonnegative integer. |

General bitwise operations use `BigInt` semantics. Negative values use signed
bitwise behavior, and shifts do not truncate results to 64 bits. Rotations
operate on an unsigned fixed-width field and interpret the rotation count modulo
the selected width.
Bit-inspection operations reject negative values, and `trailingZeros(0)` is
rejected because it is mathematically undefined.

## Statistics

Statistical operations accept arrays of numeric values and return decimal text.

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
