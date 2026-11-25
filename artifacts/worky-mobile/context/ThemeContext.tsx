import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type WorkyThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'worky-mobile-theme';

interface ThemeContextValue {
  mode: WorkyThemeMode;
  toggleMode: () => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<WorkyThemeMode>('light');

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((storedMode) => {
        if (!cancelled && (storedMode === 'light' || storedMode === 'dark')) {
          setMode(storedMode);
        }
      })
      .catch((error: unknown) => {
        console.warn('No se pudo recuperar la apariencia guardada de Worky.', error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const toggleMode = useCallback(async () => {
    const nextMode: WorkyThemeMode = mode === 'dark' ? 'light' : 'dark';
    await AsyncStorage.setItem(THEME_STORAGE_KEY, nextMode);
    setMode(nextMode);
  }, [mode]);

  const value = useMemo(() => ({ mode, toggleMode }), [mode, toggleMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme debe usarse dentro de ThemeProvider.');
  return value;
}
