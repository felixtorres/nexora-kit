'use client';

import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { ReactNode } from 'react';

export type PaneMode = 'chat-only' | 'split' | 'app-only';

interface SplitPaneProps {
  chatPanel: ReactNode;
  previewPanel: ReactNode;
  mode: PaneMode;
}

/**
 * Resizable split-pane layout: chat on the left, app preview on the right.
 *
 * - chat-only: full-width chat, no preview
 * - split: resizable side-by-side (40/60 default)
 * - app-only: full-width preview, chat hidden
 */
export function SplitPane({ chatPanel, previewPanel, mode }: SplitPaneProps) {
  if (mode === 'chat-only') {
    return <>{chatPanel}</>;
  }

  if (mode === 'app-only') {
    return <>{previewPanel}</>;
  }

  return (
    <PanelGroup
      direction="horizontal"
      autoSaveId="nexora-app-preview"
      className="h-full"
    >
      <Panel defaultSize={40} minSize={25} order={1}>
        {chatPanel}
      </Panel>
      <PanelResizeHandle className="w-1.5 bg-border hover:bg-primary/20 transition-colors" />
      <Panel defaultSize={60} minSize={30} order={2}>
        {previewPanel}
      </Panel>
    </PanelGroup>
  );
}
