import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useLocalCache
 * 
 * A custom hook that acts like useState but automatically reads from and writes to localStorage.
 * This provides a Stale-While-Revalidate (SWR) experience where the UI paints instantly
 * using cached data while background requests fetch fresh data.
 * 
 * @param {string} key - Unique key for localStorage
 * @param {any} initialValue - Fallback value if cache is empty
 * @returns {[any, Function, boolean]} [state, setState, isLoadedFromCache]
 */
export function useLocalCache(key, initialValue) {
  const initialValueRef = useRef(initialValue);
  initialValueRef.current = initialValue;

  const readCache = useCallback(() => {
    if (typeof window === 'undefined') {
      return { value: initialValueRef.current, hasCache: false };
    }

    try {
      const item = window.localStorage.getItem(key);
      return {
        value: item ? JSON.parse(item) : initialValueRef.current,
        hasCache: Boolean(item)
      };
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return { value: initialValueRef.current, hasCache: false };
    }
  }, [key]);

  // Try to load from cache immediately on mount
  const [cacheState, setCacheState] = useState(() => {
    const cached = readCache();
    return { key, value: cached.value, hasCache: cached.hasCache };
  });

  useEffect(() => {
    const cached = readCache();
    setCacheState({ key, value: cached.value, hasCache: cached.hasCache });
  }, [key, readCache]);

  // Wrap setState to also write to localStorage
  const setCachedData = useCallback((newValue) => {
    setCacheState((previousState) => {
      try {
        const previous =
          previousState.key === key ? previousState.value : readCache().value;
        // Allow value to be a function so we have same API as useState.
        const valueToStore =
          newValue instanceof Function ? newValue(previous) : newValue;

        if (typeof window !== 'undefined') {
          window.localStorage.setItem(key, JSON.stringify(valueToStore));
        }

        return { key, value: valueToStore, hasCache: true };
      } catch (error) {
        console.warn(`Error setting localStorage key "${key}":`, error);
        return previousState;
      }
    });
  }, [key, readCache]);

  const visibleState = cacheState.key === key
    ? cacheState
    : (() => {
      const cached = readCache();
      return { key, value: cached.value, hasCache: cached.hasCache };
    })();

  return [visibleState.value, setCachedData, visibleState.hasCache];
}
