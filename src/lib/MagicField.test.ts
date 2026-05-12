import { describe, expect, it } from 'vitest';
import { MagicField } from './MagicField';

function expectDensityInRange(value: number): void {
  expect(value).toBeGreaterThanOrEqual(0);
  expect(value).toBeLessThanOrEqual(1);
}

describe('MagicField', (): void => {
  it('starts without nodes for later world-node wiring', (): void => {
    const field = new MagicField();

    expect(field.getNodes()).toEqual([]);
  });

  it('samples density within [0, 1]', (): void => {
    const field = new MagicField();

    expectDensityInRange(field.sampleDensity(0, 0));
    expectDensityInRange(field.sampleDensity(2400, 1800));
    expectDensityInRange(field.sampleDensity(-500, 900));
  });

  it('drifts over time while keeping the same node set', (): void => {
    const field = new MagicField();
    const before = field.sampleDensity(0, 0);

    field.update(30_000);

    expect(field.sampleDensity(0, 0)).not.toBe(before);
    expect(field.getTime()).toBe(30);
    expect(field.getNodes()).toEqual([]);
  });

  it('adds and removes magic nodes with stable generated ids', (): void => {
    const field = new MagicField();

    const firstId = field.addNode({ wx: 100, wy: 200, strength: 0.8, radius: 500 });
    const secondId = field.addNode({ wx: 300, wy: 400, strength: -0.4, radius: 600 });

    expect(firstId).toBe('0');
    expect(secondId).toBe('1');
    expect(field.getNodes()).toHaveLength(2);

    field.removeNode(firstId);

    expect(field.getNodes()).toEqual([
      { id: secondId, wx: 300, wy: 400, strength: -0.4, radius: 600 },
    ]);
  });

  it('returns a normalised flow vector from full samples', (): void => {
    const field = new MagicField();
    const sample = field.sample(1200, 700);
    const length = Math.sqrt(sample.dx * sample.dx + sample.dy * sample.dy);

    expectDensityInRange(sample.density);
    expect(length).toBeGreaterThan(0.999);
    expect(length).toBeLessThan(1.001);
  });
});
