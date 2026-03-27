'use client';

import { createContext, useContext } from 'react';
import type { AppPreviewBlockData } from './AppPreviewBlock';

interface AppPreviewContextValue {
  showPreview: (appId: string, html: string, title: string) => void;
}

const AppPreviewContext = createContext<AppPreviewContextValue | null>(null);

export const AppPreviewProvider = AppPreviewContext.Provider;

export function useAppPreviewContext(): AppPreviewContextValue | null {
  return useContext(AppPreviewContext);
}
