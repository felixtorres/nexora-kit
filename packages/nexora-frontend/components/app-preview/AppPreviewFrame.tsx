'use client';

import { useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import type { Ref } from 'react';

export interface AppPreviewFrameRef {
  /** Send a patch to the iframe via postMessage. */
  postPatch(patch: Record<string, unknown>): void;
}

interface AppPreviewFrameProps {
  html: string;
  onLoad?: () => void;
}

/**
 * Sandboxed iframe that renders a generated dashboard app.
 *
 * Security: sandbox="allow-scripts" blocks same-origin access,
 * form submissions, popups, and top navigation.
 */
export const AppPreviewFrame = forwardRef(function AppPreviewFrame(
  { html, onLoad }: AppPreviewFrameProps,
  ref: Ref<AppPreviewFrameRef>,
) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const postPatch = useCallback((patch: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'nexora-patch', patch },
      '*',
    );
  }, []);

  useImperativeHandle(ref, () => ({ postPatch }), [postPatch]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={html}
      sandbox="allow-scripts"
      onLoad={onLoad}
      className="h-full w-full border-none bg-white"
      title="Dashboard App Preview"
    />
  );
});
