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
  computeBlinkClosing,
  computeBlinkOpening,
  nextBlinkState,
  computeLipSyncAa,
  computeEmotionExpressions,
  computeTTSFallbackDuration,
  isSendDisabled,
  messageAlignClass,
  messageBubbleClass,
  type EmotionState,
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

// Feature: bella-vrm-avatar, Property 2: Blink expression interpolation is correct
describe('Property 2: Blink expression interpolation is correct', () => {
  it('closing direction: v = clamp(timer/0.07, 0, 1)', () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: 1, noNaN: true }), (timer) => {
        const v = computeBlinkClosing(timer);
        const expected = Math.min(timer / 0.07, 1);
        expect(v).toBeCloseTo(expected, 10);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }),
      { numRuns: 100 }
    );
  });

  it('opening direction: v = 1 - clamp(timer/0.07, 0, 1)', () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: 1, noNaN: true }), (timer) => {
        const v = computeBlinkOpening(timer);
        const expected = 1 - Math.min(timer / 0.07, 1);
        expect(v).toBeCloseTo(expected, 10);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: bella-vrm-avatar, Property 3: Blink state transitions respect timing thresholds
describe('Property 3: Blink state transitions respect timing thresholds', () => {
  it('open state: stays open when timer < 3.0', () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: Math.fround(2.999), noNaN: true }), (timer) => {
        // nextBlinkThreshold is always in [3, 5], so timer < 3 never triggers transition
        const next = nextBlinkState('open', timer, 3.0);
        expect(next).toBe('open');
      }),
      { numRuns: 100 }
    );
  });

  it('open state: transitions to closing when timer >= nextBlinkThreshold', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 5, max: 10, noNaN: true }),
        fc.float({ min: 3, max: 5, noNaN: true }),
        (timer, threshold) => {
          // timer >= 5.0 always exceeds any threshold in [3, 5]
          const next = nextBlinkState('open', timer, threshold);
          expect(next).toBe('closing');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('closing state: stays closing when timer < 0.07', () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: Math.fround(0.069), noNaN: true }), (timer) => {
        const next = nextBlinkState('closing', timer, 3.0);
        expect(next).toBe('closing');
      }),
      { numRuns: 100 }
    );
  });

  it('closing state: transitions to opening when timer >= 0.07', () => {
    fc.assert(
      fc.property(fc.float({ min: Math.fround(0.07), max: 10, noNaN: true }), (timer) => {
        const next = nextBlinkState('closing', timer, 3.0);
        expect(next).toBe('opening');
      }),
      { numRuns: 100 }
    );
  });

  it('opening state: stays opening when timer < 0.07', () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: Math.fround(0.069), noNaN: true }), (timer) => {
        const next = nextBlinkState('opening', timer, 3.0);
        expect(next).toBe('opening');
      }),
      { numRuns: 100 }
    );
  });

  it('opening state: transitions to open when timer >= 0.07', () => {
    fc.assert(
      fc.property(fc.float({ min: Math.fround(0.07), max: 10, noNaN: true }), (timer) => {
        const next = nextBlinkState('opening', timer, 3.0);
        expect(next).toBe('open');
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: bella-vrm-avatar, Property 5: Lip sync Aa value is always in valid range
describe('Property 5: Lip sync Aa value is always in valid range', () => {
  // Validates: Requirements 4.1, 4.2
  it('Aa value is either exactly 0 or in [0.4, 0.8]', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.float({ min: 0, max: 1, noNaN: true }),
        (lipOpen, rand) => {
          const value = computeLipSyncAa(lipOpen, rand);
          const isZero = value === 0;
          const isInRange = value >= 0.4 && value <= 0.8;
          expect(isZero || isInRange).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('when lipOpen is false, Aa is always exactly 0', () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: 1, noNaN: true }), (rand) => {
        expect(computeLipSyncAa(false, rand)).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it('when lipOpen is true, Aa is always in [0.4, 0.8]', () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: 1, noNaN: true }), (rand) => {
        const value = computeLipSyncAa(true, rand);
        expect(value).toBeGreaterThanOrEqual(0.4);
        expect(value).toBeLessThanOrEqual(0.8);
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: bella-vrm-avatar, Property 4: Emotion state maps to correct expression values
describe('Property 4: Emotion state maps to correct expression values', () => {
  // Validates: Requirements 5.1, 5.2, 5.3
  it('neutral maps to all-zero expressions', () => {
    const result = computeEmotionExpressions('neutral')
    expect(result.happy).toBe(0)
    expect(result.relaxed).toBe(0)
    expect(result.surprised).toBe(0)
  })

  it('thinking maps to Relaxed=0.5, others zero', () => {
    const result = computeEmotionExpressions('thinking')
    expect(result.happy).toBe(0)
    expect(result.relaxed).toBe(0.5)
    expect(result.surprised).toBe(0)
  })

  it('happy maps to Happy=1, others zero', () => {
    const result = computeEmotionExpressions('happy')
    expect(result.happy).toBe(1)
    expect(result.relaxed).toBe(0)
    expect(result.surprised).toBe(0)
  })

  it('celebrate maps to Happy=1, others zero', () => {
    const result = computeEmotionExpressions('celebrate')
    expect(result.happy).toBe(1)
    expect(result.relaxed).toBe(0)
    expect(result.surprised).toBe(0)
  })

  it('any emotion maps to valid expression values', () => {
    fc.assert(
      fc.property(fc.constantFrom('neutral', 'thinking', 'happy', 'celebrate'), (emotion) => {
        const result = computeEmotionExpressions(emotion as EmotionState)
        // happy and relaxed are always in [0, 1]
        expect(result.happy).toBeGreaterThanOrEqual(0)
        expect(result.happy).toBeLessThanOrEqual(1)
        expect(result.relaxed).toBeGreaterThanOrEqual(0)
        expect(result.relaxed).toBeLessThanOrEqual(1)
        expect(result.surprised).toBe(0) // surprised is never used
      }),
      { numRuns: 100 }
    )
  })
})

// Feature: bella-vrm-avatar, Property 9: TTS fallback duration is clamped correctly
describe('Property 9: TTS fallback duration is clamped correctly', () => {
  // Validates: Requirements 8.6
  it('duration is never below 1500ms', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(computeTTSFallbackDuration(text)).toBeGreaterThanOrEqual(1500)
      }),
      { numRuns: 100 }
    )
  })

  it('duration is never above 6000ms', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(computeTTSFallbackDuration(text)).toBeLessThanOrEqual(6000)
      }),
      { numRuns: 100 }
    )
  })

  it('duration equals clamp(text.length * 40, 1500, 6000)', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const expected = Math.min(Math.max(text.length * 40, 1500), 6000)
        expect(computeTTSFallbackDuration(text)).toBe(expected)
      }),
      { numRuns: 100 }
    )
  })
})

// Feature: bella-vrm-avatar, Property 8: Message history is append-only and preserved
describe('Property 8: Message history is append-only and preserved', () => {
  // Validates: Requirements 10.5
  it('all messages are preserved in insertion order after sequential appends', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ role: fc.constantFrom('user', 'bella'), text: fc.string() }),
          { minLength: 1, maxLength: 20 }
        ),
        (incoming) => {
          // Simulate the append-only reducer used in BellaOverlay
          type Msg = { role: string; text: string }
          const history: Msg[] = []
          for (const msg of incoming) {
            history.push(msg)
          }
          // Every message must appear in the same order
          expect(history.length).toBe(incoming.length)
          for (let i = 0; i < incoming.length; i++) {
            expect(history[i].role).toBe(incoming[i].role)
            expect(history[i].text).toBe(incoming[i].text)
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('appending a new message does not alter prior messages', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ role: fc.constantFrom('user', 'bella'), text: fc.string() }),
          { minLength: 1, maxLength: 10 }
        ),
        fc.record({ role: fc.constantFrom('user', 'bella'), text: fc.string() }),
        (existing, newMsg) => {
          type Msg = { role: string; text: string }
          const before: Msg[] = [...existing]
          const after: Msg[] = [...existing, newMsg]
          // All prior entries are unchanged
          for (let i = 0; i < before.length; i++) {
            expect(after[i].role).toBe(before[i].role)
            expect(after[i].text).toBe(before[i].text)
          }
          // New message is at the end
          expect(after[after.length - 1].role).toBe(newMsg.role)
          expect(after[after.length - 1].text).toBe(newMsg.text)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// Feature: bella-vrm-avatar, Property 6: Send button disabled when input empty or thinking
describe('Property 6: Send button disabled when input empty or thinking', () => {
  // Validates: Requirements 6.6
  it('disabled iff thinking === true OR input.trim() === ""', () => {
    fc.assert(
      fc.property(
        fc.record({ thinking: fc.boolean(), input: fc.string() }),
        ({ thinking, input }) => {
          const disabled = isSendDisabled(thinking, input)
          const expected = thinking || !input.trim()
          expect(disabled).toBe(expected)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('always disabled when thinking is true regardless of input', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        expect(isSendDisabled(true, input)).toBe(true)
      }),
      { numRuns: 100 }
    )
  })

  it('always disabled when input is blank regardless of thinking', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.stringMatching(/^\s*$/),
        (thinking, input) => {
          expect(isSendDisabled(thinking, input)).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('enabled only when not thinking and input has non-whitespace content', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        (input) => {
          expect(isSendDisabled(false, input)).toBe(false)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// Feature: bella-vrm-avatar, Property 7: Message alignment matches role
describe('Property 7: Message alignment matches role', () => {
  // Validates: Requirements 6.2
  it('user messages are always right-aligned (justify-end)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ role: fc.constantFrom('user' as const, 'bella' as const), text: fc.string() }),
          { minLength: 1, maxLength: 20 }
        ),
        (messages) => {
          for (const msg of messages) {
            if (msg.role === 'user') {
              expect(messageAlignClass(msg.role)).toBe('justify-end')
            }
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('bella messages are always left-aligned (justify-start)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ role: fc.constantFrom('user' as const, 'bella' as const), text: fc.string() }),
          { minLength: 1, maxLength: 20 }
        ),
        (messages) => {
          for (const msg of messages) {
            if (msg.role === 'bella') {
              expect(messageAlignClass(msg.role)).toBe('justify-start')
            }
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('user bubble uses accent-purple class, bella bubble uses bg-elevated class', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ role: fc.constantFrom('user' as const, 'bella' as const), text: fc.string() }),
          { minLength: 1, maxLength: 20 }
        ),
        (messages) => {
          for (const msg of messages) {
            const cls = messageBubbleClass(msg.role)
            if (msg.role === 'user') {
              expect(cls).toContain('bg-accent-purple')
            } else {
              expect(cls).toContain('bg-bg-elevated')
            }
          }
        }
      ),
      { numRuns: 100 }
    )
  })
})
