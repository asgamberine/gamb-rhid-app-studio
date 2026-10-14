import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';

export function usePersistentState<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : initialValue;
  });
  const currentValue = useRef(value);

  useEffect(() => {
    currentValue.current = value;
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  const setPersistentValue = useCallback((nextValue: SetStateAction<T>) => {
    const updatedValue = typeof nextValue === 'function'
      ? (nextValue as (currentValue: T) => T)(currentValue.current)
      : nextValue;
    currentValue.current = updatedValue;
    localStorage.setItem(key, JSON.stringify(updatedValue));
    setValue(updatedValue);
  }, [key]);

  return [value, setPersistentValue] as const;
}
