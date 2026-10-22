/** NeoV8's own response curves: [label, bytes, comment] (tools/gen-curves.mjs). */
export declare const CURVES: [string, number[], string][];
/** the original Rev4 ADSR rate table (128 × 16 bit) */
export declare const ADSR_RATE_ORIGINAL: number[];
/** NeoV8's former 3-segment formula (reference) */
export declare function adsrRateFormula(i: number): number;
