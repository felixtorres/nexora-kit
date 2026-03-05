'use client';

import { useState } from 'react';
import { Shield, Trash2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuditLog, usePurgeAuditLog } from '@/hooks/use-admin';

export default function AuditPage() {
  const [filters, setFilters] = useState<{
    actor?: string;
    action?: string;
    target?: string;
  }>({});
  const [purgeOpen, setPurgeOpen] = useState(false);

  const { data, isLoading } = useAuditLog({ ...filters, limit: 100 });
  const purge = usePurgeAuditLog();

  const events = data?.events ?? [];
  const count = data?.count ?? 0;

  const handlePurge = () => {
    purge.mutate(undefined, { onSuccess: () => setPurgeOpen(false) });
  };

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Audit Log</h1>
          <p className="text-sm text-muted-foreground">
            {count > 0 ? `${count} event${count !== 1 ? 's' : ''}` : 'System activity log'}
          </p>
        </div>
        <Button variant="outline" onClick={() => setPurgeOpen(true)}>
          <Trash2 className="mr-2 size-4" />
          Purge
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter by actor..."
            className="pl-9"
            value={filters.actor ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, actor: e.target.value || undefined }))}
          />
        </div>
        <Input
          placeholder="Action..."
          className="w-40"
          value={filters.action ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value || undefined }))}
        />
        <Input
          placeholder="Target..."
          className="w-40"
          value={filters.target ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, target: e.target.value || undefined }))}
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Shield className="mb-3 size-10 opacity-50" />
          <p className="text-sm">No audit events found.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Timestamp</th>
                <th className="px-4 py-2 text-left font-medium">Actor</th>
                <th className="px-4 py-2 text-left font-medium">Action</th>
                <th className="px-4 py-2 text-left font-medium">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {events.map((event) => (
                <tr key={event.id} className="hover:bg-muted/20">
                  <td className="px-4 py-2 text-xs text-muted-foreground font-mono whitespace-nowrap">
                    {new Date(event.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">{event.actor}</td>
                  <td className="px-4 py-2">
                    <Badge variant="outline" className="text-xs">{event.action}</Badge>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground font-mono text-xs">
                    {event.target ?? '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Purge confirmation */}
      <Dialog open={purgeOpen} onOpenChange={setPurgeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Purge Audit Log</DialogTitle>
            <DialogDescription>
              This will permanently delete all audit log entries. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPurgeOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handlePurge} disabled={purge.isPending}>
              {purge.isPending ? 'Purging...' : 'Purge All'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
