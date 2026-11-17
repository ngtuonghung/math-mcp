# Math-MCP

Model Context Protocol (MCP) server. Small, deterministic library of math primitives. Built for LLMs and apps that need reliable calculation, exact integer ops where practical, and one consistent text-based tool interface.

Forked from [ethanhenrickson/math-mcp](https://github.com/ethanhenrickson/math-mcp).

## Primitives

- Arithmetic, roots, rounding, factorial/combinatorial ops
- Exact modular arithmetic, prime factorization
- Number-base conversion, fixed-width integer encoding
- Bitwise AND/OR/XOR/NOT, bit-shift, bit-rotation, bit-inspection, alignment, integer casting
- Statistical summaries
- Trigonometric functions, angle conversion

## Installation

Needs [Node.js](https://nodejs.org/en/download).

```bash
git clone https://github.com/ngtuonghung/math-mcp.git
cd math-mcp && npm install
```

Add to MCP config:

```json
"math": {
  "command": "node",
  "args": ["PATH/TO/PROJECT/math-mcp/build/index.js"]
}
```

Replace `PATH/TO/PROJECT` with real repo location. Build not committed. `npm install` creates it. After source change, rebuild:

```bash
npm run build
```

## Parameter names

Every tool names its operand same way. Two names only:

- **`numbers`**: list of operands. Tools: `sum`, `product`, `mean`, `median`, `mode`, `min`, `max`, `gcd`, `lcm`, `bitAnd`, `bitOr`, `bitXor`.
- **`value`**: operand of every other tool.

Second or modifying argument keeps own domain name: `addend`, `subtrahend`, `factor`, `divisor`, `exponent`, `modulus`, `degree`, `k`, `count`, `bits`, `boundary`, `signed`, `endian`, `fromBase`, `toBase`.

## Numeric behavior

Numeric params accept:

- JSON numbers.
- Decimal strings. May carry fraction or exponent (`"2.5"`, `"1e3"`). Clients that quote scalars still reach floating-point tools.
- `0x`-hex, `0o`-octal, `0b`-binary integer strings. Prefix required: hex `0x`, octal `0o`, binary `0b`. Uppercase digits and leading minus accepted. Prefixed forms are integers only.

Bare digit strings always decimal. Integers above `9007199254740991`: use plain decimal strings. Rejected: unsafe, infinite, and `NaN` JSON numbers; non-finite results.

Output radix, for arithmetic, divisibility, modular, root, combinatorial, bitwise, rotation, bit-inspection, alignment, casting, and statistics tools. Integer result follows input radix by priority:

1. Any `0x`-hex input → `0x`-hex.
2. Else any `0b`-binary input → `0b`-binary.
3. Else any `0o`-octal input → `0o`-octal.
4. Else decimal.

Negatives: `-0x` / `-0b` / `-0o`, unpadded. Decimal count, width, or degree no longer drags hex result back to decimal. Want hex output? Write one operand in hex.

Exceptions:

- Floating-point results: always decimal text.
- `mode`: echoes radix entries; frequency stays decimal.
- `packInteger`: always returns `0x`-prefixed hex bytes.
- `unpackInteger`: requires `0x` prefix on input, returns `0x`-hex.
- `convertBase`: returns base prefix `0b`, `0o`, or `0x`; base 10 plain.

Floating-point-backed ops reject large integer inputs when conversion loses precision. Discrete, modular, and bit-oriented ops use exact `BigInt` arithmetic.

## Arithmetic and rounding

Real-valued calculation, integer-safe exponentiation, exact integer roots, rounding, exact discrete counts.

| Operation | Description |
|---|---|
| `add` | Adds `addend` to `value`. |
| `subtract` | Subtracts `subtrahend` from `value`. |
| `multiply` | Multiplies `value` by `factor`. |
| `division` | Divides `value` by `divisor`. |
| `sum` | Adds one or more numbers. |
| `product` | Multiplies one or more numbers. |
| `modulo` | Remainder of division, truncated toward zero. Sign follows `value` (`-7 mod 3` is `-1`, not `2`). |
| `power` | Raises `value` to `exponent`. Nonnegative integer exponents exact, up to exponent `10000` and result `1000000` bits. |
| `exp` | Calculates `e^number`. |
| `floorRoot` | Integer floor of nth root. Degree at least `1`. Negative values support odd degrees. |
| `ceilRoot` | Integer ceiling of nth root. Degree at least `1`. Negative values support odd degrees. |
| `floor` | Rounds down to nearest integer. |
| `ceiling` | Rounds up to nearest integer. |
| `round` | Rounds to nearest integer. |
| `factorial` | `value!` exact, integers `0` through `10000`. |
| `combination` | Binomial coefficient `C(value, k)` exact, `value` up to `100000`. |
| `permutation` | Ordered selections `P(value, k)` exact, `value` up to `100000`. |

## Divisibility, modular, and prime operations

Exact integer foundations for number theory and algebra.

| Operation | Description |
|---|---|
| `gcd` | Greatest common divisor of one or more integers. |
| `lcm` | Least common multiple of one or more integers. |
| `modPow` | `value^exponent mod modulus`. Exponent nonnegative, modulus nonzero. Modulus and exponent up to 8192 bits. |
| `modInverse` | Multiplicative inverse modulo nonzero modulus, when it exists. |
| `factorize` | Ascending prime-power factors, integers `2` through `2^64 - 1`. |

`factorize(360)` returns:

```json
{"factors":[{"prime":"2","exponent":"3"},{"prime":"3","exponent":"2"},{"prime":"5","exponent":"1"}]}
```

## Number representation and conversion

Convert between common integer formats. Encode fixed-width values with explicit byte layout.

| Operation | Description |
|---|---|
| `convertBase` | Converts integer between bases `2`, `8`, `10`, `16`. Input base: `0b`/`0o`/`0x` prefix, else optional `fromBase`, default 10. Result carries base prefix (`0b`, `0o`, `0x`; base 10 plain). |
| `packInteger` | Encodes in-range integer as lowercase `0x`-prefixed hex bytes. Width `8`, `16`, `32`, or `64` bits; signed or unsigned; little- or big-endian. Out-of-range rejected. |
| `unpackInteger` | Decodes `0x`-prefixed hex bytes as integer. Same width, signedness, endian options. Returns `0x`-hex. |

`convertBase` with `value="255"`, `toBase=16` returns `"0xff"`. `value="0o755"`, `toBase=16` returns `"0x1ed"`.

## Integer and bit operations

Fixed and arbitrary `BigInt` behavior. For alignment, masking, type wrapping, low-level integer transforms.

| Operation | Description |
|---|---|
| `bitAnd` | Bitwise AND over one or more integers. |
| `bitOr` | Bitwise OR over one or more integers. |
| `bitXor` | Bitwise XOR over one or more integers. |
| `bitNot` | Bitwise NOT. No `bits`: `BigInt` semantics (`NOT value` is `-value - 1`). With `bits`: complement inside unsigned `8`, `16`, `32`, or `64`-bit field. |
| `shiftLeft` | Shifts integer left by `0` to `64` bits. |
| `shiftRight` | Arithmetic right shift by `0` to `64` bits. |
| `rotateLeft` | Rotates bits left within `8`, `16`, `32`, or `64`-bit field. |
| `rotateRight` | Rotates bits right within `8`, `16`, `32`, or `64`-bit field. |
| `bitLength` | Binary bit count of nonnegative integer. `0` has length `0`. |
| `bitCount` | Set bits in nonnegative integer. |
| `trailingZeros` | Trailing zero bits in nonzero nonnegative integer. |
| `castInteger` | Wraps integer to signed or unsigned `8`, `16`, `32`, or `64`-bit type. Reports range status. |
| `align` | Aligned boundaries at-or-below and above a nonnegative integer. |

Notes:

- `bitAnd`, `bitOr`, `bitXor` fold `numbers` array in order. Masking several values: one call.
- General bitwise ops use `BigInt` semantics. Negative values: signed bitwise behavior.
- Shifts do not truncate to 64 bits. No logical (zero-filling) right shift.
- Rotations work on unsigned fixed-width field. Rotation count taken modulo selected width.
- Bit-inspection ops reject negative values. `trailingZeros(0)` rejected: mathematically undefined.

## Statistics

Take arrays of numeric values. Integer results echo input radix.

| Operation | Description |
|---|---|
| `mean` | Arithmetic mean. |
| `median` | Median. |
| `mode` | Most frequent value or values, plus frequency. |
| `min` | Smallest value. |
| `max` | Largest value. |

## Trigonometry

Radians, except unit-conversion tools.

| Operation | Description |
|---|---|
| `sin` | Sine. |
| `cos` | Cosine. |
| `tan` | Tangent. |
| `arcsin` | Inverse sine. |
| `arccos` | Inverse cosine. |
| `arctan` | Inverse tangent. |
| `radiansToDegrees` | Radians to degrees. |
| `degreesToRadians` | Degrees to radians. |

## Development

```bash
npm run build
npm test
```

Source in `src/`. Tests in `test/`, excluded from distributed build.
