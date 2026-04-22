import { describe, it, expect } from 'vitest';
import { deriveCluster } from './github-issues';

describe('deriveCluster', () => {
  it('returns the cluster for the first matching label (first-match wins)', () => {
    // 'hero' → 'heroes-combat' comes before 'systems:render' → 'engine'.
    expect(deriveCluster(['hero', 'systems:render'])).toBe('heroes-combat');
  });

  it('returns the correct cluster when only one label matches', () => {
    expect(deriveCluster(['enemies', 'type:bug'])).toBe('creatures');
    expect(deriveCluster(['infrastructure'])).toBe('engine');
    expect(deriveCluster(['world'])).toBe('worlds');
  });

  it('returns other when no label maps to a cluster', () => {
    expect(deriveCluster(['type:bug', 'size:s'])).toBe('other');
    expect(deriveCluster([])).toBe('other');
  });
});
