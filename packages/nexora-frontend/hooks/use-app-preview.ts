'use client';

import { useState, useCallback } from 'react';
import type { PaneMode } from '@/components/app-preview';

export interface AppPreviewState {
  mode: PaneMode;
  currentHtml: string | null;
  currentAppId: string | null;
  currentTitle: string;
  isLoading: boolean;
  error: string | null;
}

/**
 * Hook managing the app preview state.
 *
 * Tracks the current pane mode, HTML content, and loading/error states.
 * Auto-activates split-pane when a custom:app/preview block arrives.
 */
export function useAppPreview() {
  const [state, setState] = useState<AppPreviewState>({
    mode: 'chat-only',
    currentHtml: null,
    currentAppId: null,
    currentTitle: '',
    isLoading: false,
    error: null,
  });

  /** Called when the backend returns a custom:app/preview block. */
  const showPreview = useCallback((appId: string, html: string, title: string) => {
    setState({
      mode: 'split',
      currentHtml: html,
      currentAppId: appId,
      currentTitle: title,
      isLoading: false,
      error: null,
    });
  }, []);

  /** Switch pane mode (chat-only, split, app-only). */
  const setMode = useCallback((mode: PaneMode) => {
    setState(prev => ({ ...prev, mode }));
  }, []);

  /** Close the preview and return to chat-only. */
  const closePreview = useCallback(() => {
    setState(prev => ({
      ...prev,
      mode: 'chat-only',
    }));
  }, []);

  /** Open the app in a new browser tab. */
  const popout = useCallback(() => {
    if (!state.currentHtml) return;
    const blob = new Blob([state.currentHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }, [state.currentHtml]);

  /** Send theme toggle to the iframe via postMessage. */
  const toggleTheme = useCallback(() => {
    // Theme toggling is handled via AppPreviewFrame.postPatch
    // This is a placeholder — the actual toggle happens in the iframe's runtime
  }, []);

  /** Update the preview HTML (for refinements). */
  const updateHtml = useCallback((html: string) => {
    setState(prev => ({ ...prev, currentHtml: html, isLoading: false }));
  }, []);

  /** Set loading state when a refinement is in progress. */
  const setLoading = useCallback((loading: boolean) => {
    setState(prev => ({ ...prev, isLoading: loading }));
  }, []);

  return {
    ...state,
    showPreview,
    setMode,
    closePreview,
    popout,
    toggleTheme,
    updateHtml,
    setLoading,
  };
}
