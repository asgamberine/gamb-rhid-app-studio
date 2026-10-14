import { describe, expect, it } from 'vitest';
import { filterCountableWorkdays, isCountableWorkday, isWorkAbsenceRequest, previousEligibleWorkday } from './workday';
import type { RhidRequestRecord } from '../types';

describe('workday calendar', () => {
  it('excludes weekends', () => {
    expect(isCountableWorkday('2026-06-27')).toBe(false);
    expect(isCountableWorkday('2026-06-28')).toBe(false);
  });

  it('excludes national holidays and movable holidays', () => {
    expect(isCountableWorkday('2026-01-01')).toBe(false);
    expect(isCountableWorkday('2026-04-03')).toBe(false);
    expect(isCountableWorkday('2026-05-01')).toBe(false);
  });

  it('keeps ordinary weekdays', () => {
    expect(isCountableWorkday('2026-06-26')).toBe(true);
  });

  it('filters non-countable dates out of a list', () => {
    expect(filterCountableWorkdays([
      '2026-06-26',
      '2026-06-27',
      '2026-05-01',
    ])).toEqual(['2026-06-26']);
  });

  it('finds the previous eligible workday after weekends and official absences', () => {
    const vacation: RhidRequestRecord = {
      id: 'vacation',
      type: 'Férias',
      status: 'approved',
      requestedAt: '2026-07-10',
      startDate: '2026-07-13',
      endDate: '2026-07-15',
      description: 'Período de férias',
      filesUrl: [],
      source: 'rhid',
    };
    expect(previousEligibleWorkday('2026-07-16', [vacation])).toBe('2026-07-10');
  });

  it('does not treat rejected absence requests as an exclusion', () => {
    const rejectedLeave: RhidRequestRecord = {
      id: 'leave',
      type: 'Atestado',
      status: 'rejected',
      requestedAt: '2026-07-15',
      startDate: '2026-07-15',
      endDate: '2026-07-15',
      description: 'Atestado médico',
      filesUrl: [],
      source: 'rhid',
    };
    expect(isWorkAbsenceRequest(rejectedLeave)).toBe(false);
    expect(previousEligibleWorkday('2026-07-16', [rejectedLeave])).toBe('2026-07-15');
  });

  it('does not confuse a time adjustment mentioning falta with an absence', () => {
    const adjustment: RhidRequestRecord = {
      id: 'adjustment',
      type: 'Relocar extra/falta',
      status: 'approved',
      requestedAt: '2026-07-15',
      startDate: '2026-07-15',
      endDate: '2026-07-15',
      description: 'Relocar horas para falta',
      filesUrl: [],
      source: 'rhid',
    };
    expect(isWorkAbsenceRequest(adjustment)).toBe(false);
  });
});
