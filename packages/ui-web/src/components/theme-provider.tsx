'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'ice' | 'system';
type ResolvedTheme = 'light' | 'dark' | 'ice';

export interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function resolveSystem(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'clary-theme',
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return defaultTheme;
    return (window.localStorage.getItem(storageKey) as Theme | null) ?? defaultTheme;
  });

  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    theme === 'system' ? resolveSystem() : (theme as ResolvedTheme),
  );

  useEffect(() => {
    const root = document.documentElement;
    const apply = (mode: ResolvedTheme) => {
      root.classList.remove('light', 'dark', 'ice');
      root.classList.add(mode);
      root.style.colorScheme = mode === 'dark' ? 'dark' : 'light';
      setResolvedTheme(mode);
    };

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handle = () => apply(mq.matches ? 'dark' : 'light');
      handle();
      mq.addEventListener('change', handle);
      return () => mq.removeEventListener('change', handle);
    }
    apply(theme as ResolvedTheme);
    return undefined;
  }, [theme]);

  const value: ThemeContextValue = {
    theme,
    resolvedTheme,
    setTheme: (next) => {
      window.localStorage.setItem(storageKey, next);
      setThemeState(next);
    },
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
