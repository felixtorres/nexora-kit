'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect, type ReactNode } from 'react';
import { useSettings } from '@/store/settings';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  // Trigger Zustand persist rehydration from localStorage on the client.
  // We use skipHydration in the store so SSR always starts with defaults,
  // then rehydrate here on first client render and mark _hydrated=true so
  // all gated queries/hooks know the real apiKey/serverUrl are loaded.
  //
  // IMPORTANT: rehydrate() is async — it reads localStorage and dispatches
  // state updates before returning. We must wait for it to finish before
  // signalling hydration, otherwise gated hooks see hydrated=true but still
  // read the empty default apiKey. onFinishHydration fires after the store
  // has been updated with the persisted values.
  useEffect(() => {
    const unsub = useSettings.persist.onFinishHydration(() => {
      useSettings.getState()._setHydrated();
      unsub();
    });
    useSettings.persist.rehydrate();
  }, []);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
