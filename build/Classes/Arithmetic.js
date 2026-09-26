export class Arithmetic {
    /**
     * Add two numbers together
     * @param firstNumber - The first number
     * @param secondNumber - The second number
     * @returns sum
     */
    static add(firstNumber, secondNumber) {
        const sum = firstNumber + secondNumber;
        return sum;
    }
    /**
     * Subtract one number from another
     * @param minuend - The number to subtract from
     * @param subtrahend - The number to subtract
     * @returns difference
     */
    static subtract(minuend, subtrahend) {
        const difference = minuend - subtrahend;
        return difference;
    }
    /**
     * Multiply two numbers together
     * @param firstNumber - The first number
     * @param secondNumber - The second number
     * @returns product
     */
    static multiply(firstNumber, secondNumber) {
        const product = firstNumber * secondNumber;
        return product;
    }
    /**
     * Divide one number by another
     * @param numerator - The number to be divided
     * @param denominator - The number to divide by
     * @returns quotient
     */
    static division(numerator, denominator) {
        const quotient = numerator / denominator;
        return quotient;
    }
    /**
     * Calculate the sum of an array of numbers
     * @param numbers - Array of numbers to sum
     * @returns sum of all numbers in the array
     */
    static sum(numbers) {
        // Use reduce to accumulate the sum, starting with 0
        const sum = numbers.reduce((accumulator, currentValue) => accumulator + currentValue, 0);
        return sum;
    }
    /**
     * Calculate the floor of a number
     * @param number - Number to find the floor of
     * @returns floor of the number
     */
    static floor(number) {
        const floor = Math.floor(number);
        return floor;
    }
    /**
     * Calculate the ceil of a number
     * @param number - Number to find the ceil of
     * @returns ceil of the number
     */
    static ceil(number) {
        const ceil = Math.ceil(number);
        return ceil;
    }
    /**
     * Calculate the round of a number
     * @param number - Number to find the round of
     * @returns round of the number
     */
    static round(number) {
        const round = Math.round(number);
        return round;
    }
    /**
     * Get the remainder of a division equation.
     * Ex: modulo(5,2) = 1
     * @param numerator - The number to be divided
     * @param denominator - The number to divide by
     * @returns remainder of division
     */
    static modulo(numerator, denominator) {
        const remainder = numerator % denominator;
        return remainder;
    }
    /**
     * Raise a base to an exponent (floating-point path)
     * @param base - The base
     * @param exponent - The exponent
     * @returns base raised to exponent
     */
    static power(base, exponent) {
        const power = Math.pow(base, exponent);
        return power;
    }
    /**
     * Calculate the nth root of a number
     * @param number - The number to find the root of
     * @param degree - The root degree (nonzero integer; odd for negative numbers)
     * @returns the nth root
     */
    static nthRoot(number, degree) {
        if (!Number.isInteger(degree) || degree === 0) {
            throw new Error("Root degree must be a nonzero integer");
        }
        if (number < 0) {
            if (degree % 2 === 0)
                throw new Error("An even root of a negative number is not a real number");
            return -Math.pow(-number, 1 / degree);
        }
        return Math.pow(number, 1 / degree);
    }
}
