// Feature: bella-vrm-avatar, Property 1: Idle bone rotation follows sinusoidal formula
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  computeSpineZ,
  computeSpineX,
  computeHeadY,
  computeHeadX,
  computeLeftUpperArmZ,
  computeRightUpperArmZ,
} from './BellaOverlay';

describe('Property 1: Idle bone rotation follows sinusoidal formula', () => {
  it('spine Z rotation matches sin(t*0.8)*0.02', () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: 1000, noNaN: true }), (t) => {
        expect(computeSpineZ(t)).toBeCloseTo(Math.sin(t * 0.8) * 0.02, 10);
      }),
      { numRuns: 100 }
    );
  });

  it('spine X rotation matches sin(t*0.5)*0.01', () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: 1000, noNaN: true }), (t) => {
        expect(computeSpineX(t)).toBeCloseTo(Math.sin(t * 0.5) * 0.01, 10);
      }),
      { numRuns: 100 }
    );
  });

  it('head Y rotation matches sin(t*0.4)*0.08', () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: 1000, noNaN: true }), (t) => {
        expect(computeHeadY(t)).toBeCloseTo(Math.sin(t * 0.4) * 0.08, 10);
      }),
      { numRuns: 100 }
    );
  });

  it('head X rotation matches sin(t*0.3)*0.04', () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: 1000, noNaN: true }), (t) => {
        expect(computeHeadX(t)).toBeCloseTo(Math.sin(t * 0.3) * 0.04, 10);
      }),
      { numRuns: 100 }
    );
  });

  it('left upper arm Z rotation matches 0.6 + sin(t*0.6)*0.03', () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: 1000, noNaN: true }), (t) => {
        expect(computeLeftUpperArmZ(t)).toBeCloseTo(0.6 + Math.sin(t * 0.6) * 0.03, 10);
      }),
      { numRuns: 100 }
    );
  });

  it('right upper arm Z rotation matches -(0.6 + sin(t*0.6+1)*0.03)', () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: 1000, noNaN: true }), (t) => {
        expect(computeRightUpperArmZ(t)).toBeCloseTo(-(0.6 + Math.sin(t * 0.6 + 1) * 0.03), 10);
      }),
      { numRuns: 100 }
    );
  });
});
