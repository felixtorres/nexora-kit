'use client';

import { useState } from 'react';
import { Cpu, Plus, Pencil, Trash2, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
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
import { useAgentList, useCreateAgent, useUpdateAgent, useDeleteAgent } from '@/hooks/use-admin';
import { useCreateConversation } from '@/hooks/use-conversation';
import type { Agent } from '@/lib/api';

type AgentForm = {
  slug: string;
  name: string;
  description: string;
  orchestrationStrategy: string;
  botId: string;
  fallbackBotId: string;
  messagesPerMinute: string;
  conversationsPerDay: string;
  authMode: string;
};

const emptyForm: AgentForm = {
  slug: '',
  name: '',
  description: '',
  orchestrationStrategy: 'single',
  botId: '',
  fallbackBotId: '',
  messagesPerMinute: '',
  conversationsPerDay: '',
  authMode: 'anonymous',
};

function agentToForm(agent: Agent): AgentForm {
  return {
    slug: agent.slug,
    name: agent.name,
    description: agent.description ?? '',
    orchestrationStrategy: agent.orchestrationStrategy ?? 'single',
    botId: agent.botId ?? '',
    fallbackBotId: agent.fallbackBotId ?? '',
    messagesPerMinute: agent.rateLimits?.messagesPerMinute != null ? String(agent.rateLimits.messagesPerMinute) : '',
    conversationsPerDay: agent.rateLimits?.conversationsPerDay != null ? String(agent.rateLimits.conversationsPerDay) : '',
    authMode: agent.endUserAuth?.mode ?? 'anonymous',
  };
}

function formToData(form: AgentForm): Partial<Agent> {
  return {
    slug: form.slug,
    name: form.name,
    description: form.description || undefined,
    orchestrationStrategy: form.orchestrationStrategy as Agent['orchestrationStrategy'],
    botId: form.botId || undefined,
    fallbackBotId: form.fallbackBotId || undefined,
    rateLimits: {
      messagesPerMinute: form.messagesPerMinute ? Number(form.messagesPerMinute) : undefined,
      conversationsPerDay: form.conversationsPerDay ? Number(form.conversationsPerDay) : undefined,
    },
    endUserAuth: { mode: form.authMode as 'anonymous' | 'token' | 'jwt' },
  };
}

export default function AgentsPage() {
  const { data, isLoading } = useAgentList();
  const createAgent = useCreateAgent();
  const updateAgent = useUpdateAgent();
  const deleteAgent = useDeleteAgent();
  const createConversation = useCreateConversation();
  const router = useRouter();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [form, setForm] = useState<AgentForm>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);

  const agents = data?.agents ?? [];

  const openCreate = () => {
    setEditingAgent(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (agent: Agent) => {
    setEditingAgent(agent);
    setForm(agentToForm(agent));
    setDialogOpen(true);
  };

  const handleSave = () => {
    const payload = formToData(form);
    if (editingAgent) {
      updateAgent.mutate({ id: editingAgent.id, data: payload }, { onSuccess: () => setDialogOpen(false) });
    } else {
      createAgent.mutate(payload, { onSuccess: () => setDialogOpen(false) });
    }
  };

  const handleDelete = () => {
    if (deleteTarget) {
      deleteAgent.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
    }
  };

  const handleOpenInChat = (agent: Agent) => {
    createConversation.mutate({ agentId: agent.id }, {
      onSuccess: (conv) => router.push(`/chat/${conv.id}`),
    });
  };

  const update = (field: keyof AgentForm, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const isSaving = createAgent.isPending || updateAgent.isPending;

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Agents</h1>
          <p className="text-sm text-muted-foreground">Manage agent deployments</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 size-4" />
          Create Agent
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Cpu className="mb-3 size-10 opacity-50" />
          <p className="text-sm">No agents configured yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {agents.map((agent) => (
            <Card key={agent.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  {agent.name}
                  <Badge variant="outline" className="ml-2 text-xs font-mono">{agent.slug}</Badge>
                </CardTitle>
                <CardAction>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" title="Open in Chat" onClick={() => handleOpenInChat(agent)}>
                      <ExternalLink className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(agent)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(agent)}>
                      <Trash2 className="size-4 text-red-500" />
                    </Button>
                  </div>
                </CardAction>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="secondary">{agent.orchestrationStrategy ?? 'single'}</Badge>
                  <Badge variant={agent.enabled !== false ? 'default' : 'outline'}>
                    {agent.enabled !== false ? 'Enabled' : 'Disabled'}
                  </Badge>
                  {agent.description && <span>{agent.description}</span>}
                  <span className="ml-auto text-xs font-mono">{agent.id.slice(0, 8)}</span>
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
            <DialogTitle>{editingAgent ? 'Edit Agent' : 'Create Agent'}</DialogTitle>
            <DialogDescription>
              {editingAgent ? 'Update agent configuration.' : 'Deploy a new agent.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Support Agent" />
              </div>
              <div className="space-y-1.5">
                <Label>Slug</Label>
                <Input value={form.slug} onChange={(e) => update('slug', e.target.value)} placeholder="support" disabled={!!editingAgent} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="Optional description" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Strategy</Label>
                <select
                  value={form.orchestrationStrategy}
                  onChange={(e) => update('orchestrationStrategy', e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="single">Single Bot</option>
                  <option value="orchestrate">Orchestrate</option>
                  <option value="route">Route</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Auth Mode</Label>
                <select
                  value={form.authMode}
                  onChange={(e) => update('authMode', e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="anonymous">Anonymous</option>
                  <option value="token">Token</option>
                  <option value="jwt">JWT</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Bot ID</Label>
                <Input value={form.botId} onChange={(e) => update('botId', e.target.value)} placeholder="Primary bot ID" />
              </div>
              <div className="space-y-1.5">
                <Label>Fallback Bot ID</Label>
                <Input value={form.fallbackBotId} onChange={(e) => update('fallbackBotId', e.target.value)} placeholder="Optional" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Messages/min limit</Label>
                <Input type="number" min="1" value={form.messagesPerMinute} onChange={(e) => update('messagesPerMinute', e.target.value)} placeholder="60" />
              </div>
              <div className="space-y-1.5">
                <Label>Conversations/day limit</Label>
                <Input type="number" min="1" value={form.conversationsPerDay} onChange={(e) => update('conversationsPerDay', e.target.value)} placeholder="100" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name || !form.slug || isSaving}>
              {isSaving ? 'Saving...' : editingAgent ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Agent</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteAgent.isPending}>
              {deleteAgent.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
