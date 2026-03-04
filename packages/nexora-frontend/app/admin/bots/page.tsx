'use client';

import { useState } from 'react';
import { Bot as BotIcon, Plus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { useBotList, useCreateBot, useUpdateBot, useDeleteBot } from '@/hooks/use-admin';
import type { Bot } from '@/lib/api';

type BotForm = {
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  temperature: string;
  maxTurns: string;
  pluginNamespaces: string;
};

const emptyForm: BotForm = {
  name: '',
  description: '',
  systemPrompt: '',
  model: '',
  temperature: '',
  maxTurns: '',
  pluginNamespaces: '',
};

function botToForm(bot: Bot): BotForm {
  return {
    name: bot.name,
    description: bot.description ?? '',
    systemPrompt: bot.systemPrompt,
    model: bot.model,
    temperature: bot.temperature != null ? String(bot.temperature) : '',
    maxTurns: bot.maxTurns != null ? String(bot.maxTurns) : '',
    pluginNamespaces: (bot.pluginNamespaces ?? []).join(', '),
  };
}

function formToData(form: BotForm): Partial<Bot> {
  return {
    name: form.name,
    description: form.description || undefined,
    systemPrompt: form.systemPrompt,
    model: form.model,
    temperature: form.temperature ? Number(form.temperature) : undefined,
    maxTurns: form.maxTurns ? Number(form.maxTurns) : undefined,
    pluginNamespaces: form.pluginNamespaces
      ? form.pluginNamespaces.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined,
  };
}

export default function BotsPage() {
  const { data, isLoading } = useBotList();
  const createBot = useCreateBot();
  const updateBot = useUpdateBot();
  const deleteBot = useDeleteBot();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBot, setEditingBot] = useState<Bot | null>(null);
  const [form, setForm] = useState<BotForm>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<Bot | null>(null);

  const bots = data?.bots ?? [];

  const openCreate = () => {
    setEditingBot(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (bot: Bot) => {
    setEditingBot(bot);
    setForm(botToForm(bot));
    setDialogOpen(true);
  };

  const handleSave = () => {
    const payload = formToData(form);
    if (editingBot) {
      updateBot.mutate({ id: editingBot.id, data: payload }, { onSuccess: () => setDialogOpen(false) });
    } else {
      createBot.mutate(payload, { onSuccess: () => setDialogOpen(false) });
    }
  };

  const handleDelete = () => {
    if (deleteTarget) {
      deleteBot.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
    }
  };

  const update = (field: keyof BotForm, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const isSaving = createBot.isPending || updateBot.isPending;

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Bots</h1>
          <p className="text-sm text-muted-foreground">Manage bot configurations</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 size-4" />
          Create Bot
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : bots.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <BotIcon className="mb-3 size-10 opacity-50" />
          <p className="text-sm">No bots configured yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bots.map((bot) => (
            <Card key={bot.id}>
              <CardHeader>
                <CardTitle className="text-base">{bot.name}</CardTitle>
                <CardAction>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(bot)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(bot)}>
                      <Trash2 className="size-4 text-red-500" />
                    </Button>
                  </div>
                </CardAction>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="secondary">{bot.model}</Badge>
                  {bot.description && <span>{bot.description}</span>}
                  {bot.pluginNamespaces && bot.pluginNamespaces.length > 0 && (
                    <span className="text-xs">
                      {bot.pluginNamespaces.length} plugin{bot.pluginNamespaces.length > 1 ? 's' : ''}
                    </span>
                  )}
                  <span className="ml-auto text-xs font-mono">{bot.id.slice(0, 8)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingBot ? 'Edit Bot' : 'Create Bot'}</DialogTitle>
            <DialogDescription>
              {editingBot ? 'Update bot configuration.' : 'Configure a new bot.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="my-bot" />
            </div>
            <div className="space-y-1.5">
              <Label>Model</Label>
              <Input value={form.model} onChange={(e) => update('model', e.target.value)} placeholder="claude-sonnet-4-6" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="Optional description" />
            </div>
            <div className="space-y-1.5">
              <Label>System Prompt</Label>
              <textarea
                value={form.systemPrompt}
                onChange={(e) => update('systemPrompt', e.target.value)}
                rows={4}
                placeholder="You are a helpful assistant..."
                className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Temperature</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={form.temperature}
                  onChange={(e) => update('temperature', e.target.value)}
                  placeholder="0.7"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Max Turns</Label>
                <Input
                  type="number"
                  min="1"
                  value={form.maxTurns}
                  onChange={(e) => update('maxTurns', e.target.value)}
                  placeholder="10"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Plugin Namespaces</Label>
              <Input
                value={form.pluginNamespaces}
                onChange={(e) => update('pluginNamespaces', e.target.value)}
                placeholder="faq, onboarding (comma-separated)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name || !form.model || !form.systemPrompt || isSaving}>
              {isSaving ? 'Saving...' : editingBot ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Bot</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteBot.isPending}>
              {deleteBot.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
