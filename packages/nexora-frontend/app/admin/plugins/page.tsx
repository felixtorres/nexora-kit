'use client';

import { useState } from 'react';
import { Puzzle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { usePluginList, useTogglePlugin, useUninstallPlugin } from '@/hooks/use-admin';

export default function PluginsPage() {
  const { data, isLoading } = usePluginList();
  const togglePlugin = useTogglePlugin();
  const uninstallPlugin = useUninstallPlugin();
  const [uninstallTarget, setUninstallTarget] = useState<string | null>(null);

  const plugins = data?.plugins ?? [];

  const isEnabled = (plugin: { state?: string }) => plugin.state === 'enabled';

  const handleToggle = (name: string, currentlyEnabled: boolean) => {
    togglePlugin.mutate({ name, enabled: !currentlyEnabled });
  };

  const handleUninstall = () => {
    if (uninstallTarget) {
      uninstallPlugin.mutate(uninstallTarget, { onSuccess: () => setUninstallTarget(null) });
    }
  };

  return (
    <div className="flex-1 space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Plugins</h1>
        <p className="text-sm text-muted-foreground">Manage installed plugins</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : plugins.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Puzzle className="mb-3 size-10 opacity-50" />
          <p className="text-sm">No plugins installed.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {plugins.map((plugin) => (
            <Card key={plugin.namespace}>
              <CardHeader>
                <CardTitle className="text-base">
                  {plugin.name}
                  <Badge variant="outline" className="ml-2 text-xs font-mono">{plugin.namespace}</Badge>
                </CardTitle>
                <CardAction>
                  <div className="flex items-center gap-2">
                    <Button
                      variant={isEnabled(plugin) ? 'outline' : 'default'}
                      size="sm"
                      onClick={() => handleToggle(plugin.namespace, isEnabled(plugin))}
                      disabled={togglePlugin.isPending}
                    >
                      {isEnabled(plugin) ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setUninstallTarget(plugin.namespace)}
                    >
                      <Trash2 className="size-4 text-red-500" />
                    </Button>
                  </div>
                </CardAction>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant={isEnabled(plugin) ? 'default' : 'secondary'}>
                    {isEnabled(plugin) ? 'Enabled' : 'Disabled'}
                  </Badge>
                  {plugin.version && <span className="text-xs font-mono">v{plugin.version}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Uninstall confirmation */}
      <Dialog open={!!uninstallTarget} onOpenChange={(open) => !open && setUninstallTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Uninstall Plugin</DialogTitle>
            <DialogDescription>
              Are you sure you want to uninstall <strong>{uninstallTarget}</strong>? This will remove all plugin data.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUninstallTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleUninstall} disabled={uninstallPlugin.isPending}>
              {uninstallPlugin.isPending ? 'Uninstalling...' : 'Uninstall'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
