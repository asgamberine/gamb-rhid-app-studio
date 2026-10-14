import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePersistentState } from './usePersistentState';

describe('usePersistentState', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('writes an update to localStorage immediately', () => {
    const { result } = renderHook(() => usePersistentState('official-punches', [] as string[]));

    act(() => {
      result.current[1](['2026-05-26T09:05:00-03:00']);
      expect(localStorage.getItem('official-punches')).toBe('["2026-05-26T09:05:00-03:00"]');
    });
  });

  it('applies consecutive functional updates without losing saved records', () => {
    const { result } = renderHook(() => usePersistentState('official-punches', [] as string[]));

    act(() => {
      result.current[1]((records) => [...records, 'entrada']);
      result.current[1]((records) => [...records, 'saida']);
    });

    expect(JSON.parse(localStorage.getItem('official-punches') ?? '[]')).toEqual(['entrada', 'saida']);
  });
});
