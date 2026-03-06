import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  serverUrl: string;
  apiKey: string;
  _hydrated: boolean;
  setServerUrl: (url: string) => void;
  setApiKey: (key: string) => void;
  _setHydrated: () => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      serverUrl: 'http://localhost:3000',
      apiKey: '',
      _hydrated: false,
      setServerUrl: (url) => set({ serverUrl: url }),
      setApiKey: (key) => set({ apiKey: key }),
      _setHydrated: () => set({ _hydrated: true }),
    }),
    {
      name: 'nexora-settings',
      // Skip automatic hydration — we trigger it manually from a client
      // component (StoreHydration) so React components always see a clean
      // _hydrated=false on the first SSR pass and true after the client mounts.
      skipHydration: true,
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        apiKey: state.apiKey,
      }),
    },
  ),
);

/**
 * Returns true once the settings store has hydrated from localStorage.
 * Prevents components from acting on stale default values (e.g. empty apiKey)
 * before the persisted state is loaded.
 */
export function useSettingsHydrated(): boolean {
  return useSettings((s) => s._hydrated);
}
