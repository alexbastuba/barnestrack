/**
 * Result types shared across the analysis modules. The review flag types
 * live in the contracts since D66 (they are persisted on the derived layer)
 * and are re-exported here for the modules that import them from the
 * analysis layer.
 */
export type { ReviewFlag, ReviewFlagCode } from '../contracts/reviewFlags.js';
export { reviewFlagCodes } from '../contracts/reviewFlags.js';
