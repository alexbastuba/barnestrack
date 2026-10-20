import { describe, expect, it } from 'vitest';
import {
  CONFIRMED_ENTRY,
  INFERRED_ENTRY,
  MARKED_ENTRY,
  RECLASSIFIED_LOSS,
  evidenceWording,
  eventWording,
  reclassifyRefusal,
} from '../../src/ui/event-wording.js';

const entry = { kind: 'escape_entry', source: 'auto', confirmed: false } as const;

describe('what an event is called (D67)', () => {
  it('names the detector’s escape entry an inference', () => {
    expect(eventWording(entry)).toBe('Inferred escape entry');
    expect(INFERRED_ENTRY).toBe('Inferred escape entry');
  });

  it('names a person’s entry, a confirmed entry and a reclassified loss as theirs', () => {
    expect(eventWording({ ...entry, source: 'corrected' })).toBe(MARKED_ENTRY);
    expect(MARKED_ENTRY).toBe('Escape entry — marked by you');
    expect(eventWording({ ...entry, confirmed: true })).toBe(CONFIRMED_ENTRY);
    expect(CONFIRMED_ENTRY).toBe('Escape entry — confirmed');
    expect(eventWording({ kind: 'tracking_failure', source: 'corrected', confirmed: false }, true)).toBe(RECLASSIFIED_LOSS);
    expect(RECLASSIFIED_LOSS).toBe('Tracking loss — reclassified by you');
  });

  it('leaves the other kinds as they were', () => {
    expect(eventWording({ kind: 'investigation', source: 'auto', confirmed: false })).toBe('Investigation');
    expect(eventWording({ kind: 'tracking_failure', source: 'auto', confirmed: false })).toBe('Tracking failure');
  });

  it('prefixes only an inferred entry’s evidence, leaving the engine’s sentence intact', () => {
    const evidence = 'Escape-box entry at the target hole 7: lost for 2.3 s.';
    expect(evidenceWording({ ...entry, evidence })).toBe(`Inferred — ${evidence}`);
    expect(evidenceWording({ ...entry, confirmed: true, evidence })).toBe(evidence);
    expect(evidenceWording({ kind: 'investigation', source: 'auto', confirmed: false, evidence: 'x' })).toBe('x');
  });

  it('allows reclassifying only an escape entry the detector produced', () => {
    expect(reclassifyRefusal(entry)).toBeNull();
    expect(reclassifyRefusal({ ...entry, confirmed: true })).toBeNull();
    expect(reclassifyRefusal({ ...entry, source: 'corrected' })).toContain('marked by you');
    expect(reclassifyRefusal({ kind: 'investigation', source: 'auto', confirmed: false })).toContain('Only an escape entry');
    expect(reclassifyRefusal(null)).toContain('Select an escape entry first');
  });
});
