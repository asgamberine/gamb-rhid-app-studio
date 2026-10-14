import { describe, expect, it } from 'vitest';
import {
  automaticLocationDecision,
  automaticLunchWindowDecision,
  automaticSafetyExitDecision,
  calculateSafetyExitThreshold,
} from './punchPolicy.mjs';

const minute = 60_000;

describe('automatic lunch backend policy', () => {
  it('blocks manual return from minute 58 until the safety window ends', () => {
    expect(automaticLunchWindowDecision({
      automatic: false,
      lunchExitAt: 0,
      now: 58 * minute,
    }).code).toBe('AUTOMATIC_LUNCH_MANUAL_LOCK_ACTIVE');
  });

  it('allows automatic return only from minute 59 through minute 83', () => {
    expect(automaticLunchWindowDecision({
      automatic: true,
      lunchExitAt: 0,
      now: 58 * minute,
    }).allowed).toBe(false);
    expect(automaticLunchWindowDecision({
      automatic: true,
      lunchExitAt: 0,
      now: 59 * minute,
    }).allowed).toBe(true);
    expect(automaticLunchWindowDecision({
      automatic: true,
      lunchExitAt: 0,
      now: 84 * minute,
    }).allowed).toBe(false);
  });

  it('treats lunch exit timestamps with seconds as minute-aligned', () => {
    const lunchExitAt = new Date('2026-06-22T13:02:45-03:00').getTime();

    expect(automaticLunchWindowDecision({
      automatic: true,
      lunchExitAt,
      now: new Date('2026-06-22T14:01:00-03:00').getTime(),
    }).allowed).toBe(true);
  });

  it('requires exactly the confirmed entry and lunch exit', () => {
    expect(automaticLunchWindowDecision({
      automatic: true,
      lunchExitAt: null,
      now: 59 * minute,
    }).code).toBe('AUTOMATIC_LUNCH_STATE_INVALID');
  });
});

describe('automatic location backend policy', () => {
  const reference = { latitude: -23.55052, longitude: -46.633308 };

  it('accepts an accurate point inside the authorized radius', () => {
    expect(automaticLocationDecision(
      { ...reference, accuracy: 15 },
      [reference],
    ).allowed).toBe(true);
  });

  it('does not reject a point only because the GPS accuracy is low', () => {
    expect(automaticLocationDecision(
      { ...reference, accuracy: 101 },
      [reference],
    ).allowed).toBe(true);
  });

  it('rejects missing-reference and distant points', () => {
    expect(automaticLocationDecision(
      { ...reference, accuracy: 15 },
      [],
    ).code).toBe('AUTOMATIC_LOCATION_REFERENCE_MISSING');
    expect(automaticLocationDecision(
      { latitude: -23.561414, longitude: -46.655881, accuracy: 15 },
      [reference],
    ).code).toBe('AUTOMATIC_LOCATION_OUTSIDE_RANGE');
  });
});

describe('automatic safety exit backend policy', () => {
  it('blocks safety exit if there are fewer than 3 punches', () => {
    expect(automaticSafetyExitDecision({
      punches: [Date.parse('2026-06-22T08:00:00-03:00'), Date.parse('2026-06-22T12:00:00-03:00')],
      now: Date.parse('2026-06-22T19:00:00-03:00'),
    }).code).toBe('SAFETY_EXIT_INCOMPLETE_SEQUENCE');
  });

  it('blocks safety exit if 4 or more punches already exist', () => {
    const punches = [
      Date.parse('2026-06-22T08:00:00-03:00'),
      Date.parse('2026-06-22T12:00:00-03:00'),
      Date.parse('2026-06-22T13:00:00-03:00'),
      Date.parse('2026-06-22T17:05:00-03:00'),
    ];
    expect(automaticSafetyExitDecision({
      punches,
      now: Date.parse('2026-06-22T19:00:00-03:00'),
    }).code).toBe('SAFETY_EXIT_ALREADY_COMPLETED');
  });

  it('rejects inconsistent punch sequences', () => {
    const punches = [
      Date.parse('2026-06-22T12:00:00-03:00'),
      Date.parse('2026-06-22T08:00:00-03:00'),
      Date.parse('2026-06-22T13:00:00-03:00'),
    ];
    expect(automaticSafetyExitDecision({
      punches,
      now: Date.parse('2026-06-22T19:00:00-03:00'),
    }).code).toBe('SAFETY_EXIT_INCONSISTENT_SEQUENCE');
  });

  it('calculates planned finish + 01:45 safety threshold correctly for standard 8h day', () => {
    // 08:00 Entrada 1, 12:00 Saida 1 (4h trabalhadas manha)
    // 13:00 Entrada 2 (retorno) -> Faltam 4h para 8h -> Saida prevista 17:00
    // Limite de seguranca = 17:00 + 01:45 = 18:45
    const punches = [
      '2026-06-22T08:00:00-03:00',
      '2026-06-22T12:00:00-03:00',
      '2026-06-22T13:00:00-03:00',
    ];
    const threshold = calculateSafetyExitThreshold(punches, 480);
    expect(new Date(threshold).toISOString()).toBe(new Date('2026-06-22T18:45:00-03:00').toISOString());

    // 18:44 -> Antes do limite
    const beforeDecision = automaticSafetyExitDecision({
      punches,
      targetMinutes: 480,
      now: Date.parse('2026-06-22T18:44:59-03:00'),
    });
    expect(beforeDecision.allowed).toBe(false);
    expect(beforeDecision.code).toBe('SAFETY_EXIT_BEFORE_THRESHOLD');

    // 18:45 -> No limite exato
    const atThresholdDecision = automaticSafetyExitDecision({
      punches,
      targetMinutes: 480,
      now: Date.parse('2026-06-22T18:45:00-03:00'),
    });
    expect(atThresholdDecision.allowed).toBe(true);
    expect(atThresholdDecision.code).toBeNull();

    // 19:15 -> Apos o limite
    const afterDecision = automaticSafetyExitDecision({
      punches,
      targetMinutes: 480,
      now: Date.parse('2026-06-22T19:15:00-03:00'),
    });
    expect(afterDecision.allowed).toBe(true);
  });

  it('adapts to variable morning durations', () => {
    // 09:00 a 12:00 (3h trabalhadas)
    // 13:00 retorno -> faltam 5h -> prevista 18:00 -> seguranca 19:45
    const punches = [
      '2026-06-22T09:00:00-03:00',
      '2026-06-22T12:00:00-03:00',
      '2026-06-22T13:00:00-03:00',
    ];
    expect(new Date(calculateSafetyExitThreshold(punches, 480)).toISOString())
      .toBe(new Date('2026-06-22T19:45:00-03:00').toISOString());

    expect(automaticSafetyExitDecision({
      punches,
      targetMinutes: 480,
      now: Date.parse('2026-06-22T19:44:00-03:00'),
    }).allowed).toBe(false);

    expect(automaticSafetyExitDecision({
      punches,
      targetMinutes: 480,
      now: Date.parse('2026-06-22T19:45:00-03:00'),
    }).allowed).toBe(true);
  });
});

