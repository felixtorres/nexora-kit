import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useState, useEffect } from "react";

interface SettingsState {
  serverUrl: string;
  apiKey: string;
  _hydrated: boolean;
  setServerUrl: (url: string) => void;
  setApiKey: (key: string) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      serverUrl: "http://localhost:3000",
      apiKey: "",
      _hydrated: false,
      setServerUrl: (url) => set({ serverUrl: url }),
      setApiKey: (key) => set({ apiKey: key }),
    }),
    {
      name: "nexora-settings",
      onRehydrateStorage: () => (state) => {
        if (state) state._hydrated = true;
      },
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        apiKey: state.apiKey,
      }),
    }
  )
);

/**
 * Returns true once the settings store has hydrated from localStorage.
 * Prevents components from acting on stale default values (e.g. empty apiKey)
 * before the persisted state is loaded.
 */
export function useSettingsHydrated(): boolean {
  return useSettings((s) => s._hydrated);
}
