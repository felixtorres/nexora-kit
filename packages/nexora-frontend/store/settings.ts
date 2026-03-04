import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  serverUrl: string;
  apiKey: string;
  setServerUrl: (url: string) => void;
  setApiKey: (key: string) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      serverUrl: "http://localhost:3000",
      apiKey: "",
      setServerUrl: (url) => set({ serverUrl: url }),
      setApiKey: (key) => set({ apiKey: key }),
    }),
    { name: "nexora-settings" }
  )
);
