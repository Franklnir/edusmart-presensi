import { useState, useEffect } from 'react';

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
  // Try to load from cache immediately on mount
  const [data, setData] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  // Track if we had a cache hit to prevent unnecessary skeleton loading
  const hasCache = !!window.localStorage.getItem(key);

  // Wrap setState to also write to localStorage
  const setCachedData = (newValue) => {
    try {
      // Allow value to be a function so we have same API as useState
      const valueToStore =
        newValue instanceof Function ? newValue(data) : newValue;
      
      setData(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.warn(`Error setting localStorage key "${key}":`, error);
    }
  };

  return [data, setCachedData, hasCache];
}
