import { useState, type FormEvent, type DragEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, del, get, post } from '../api/client';
import type { BoardStage, Company, Contact, Deal, Paginated, Pipeline } from '../api/types';
import { fmtMoney } from '../api/types';
import { Button, Card, ErrorText, Field, Input, Modal, Select, Spinner } from '../components/ui';
import { CustomFieldInputs } from '../components/CustomFields';

interface Board {
  pipeline: { id: string; name: string };
  stages: BoardStage[];
}

function DealForm({
  pipeline,
  initial,
  onDone,
}: {
  pipeline: Pipeline;
  initial?: Deal;
  onDone(): void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: initial?.title ?? '',
    value: initial ? String(initial.value) : '0',
    stageId: initial?.stageId ?? pipeline.stages.find((s) => !s.isWon && !s.isLost)?.id ?? '',
    contactId: initial?.contactId ?? '',
    companyId: initial?.companyId ?? '',
    expectedCloseDate: initial?.expectedCloseDate?.slice(0, 10) ?? '',
  });
  const [custom, setCustom] = useState<Record<string, unknown>>(initial?.custom ?? {});
  const contacts = useQuery({
    queryKey: ['contacts', 'picker'],
    queryFn: () => get<Paginated<Contact>>('/contacts?limit=100&sort=name&order=asc'),
  });
  const companies = useQuery({
    queryKey: ['companies', 'picker'],
    queryFn: () => get<Paginated<Company>>('/companies?limit=100&sort=name&order=asc'),
  });

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      initial ? api('PATCH', `/deals/${initial.id}`, body) : post('/deals', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['board'] });
      onDone();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate({
      title: form.title,
      value: Number(form.value) || 0,
      pipelineId: pipeline.id,
      stageId: form.stageId,
      contactId: form.contactId || null,
      companyId: form.companyId || null,
      expectedCloseDate: form.expectedCloseDate || null,
      custom,
    });
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Title" required>
        <Input value={form.title} onChange={set('title')} required autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Value (USD)">
          <Input type="number" min="0" step="0.01" value={form.value} onChange={set('value')} />
        </Field>
        <Field label="Stage">
          <Select value={form.stageId} onChange={set('stageId')}>
            {pipeline.stages.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Contact">
          <Select value={form.contactId ?? ''} onChange={set('contactId')}>
            <option value="">—</option>
            {(contacts.data?.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
            ))}
          </Select>
        </Field>
        <Field label="Company">
          <Select value={form.companyId ?? ''} onChange={set('companyId')}>
            <option value="">—</option>
            {(companies.data?.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Expected close date">
        <Input type="date" value={form.expectedCloseDate} onChange={set('expectedCloseDate')} />
      </Field>
      <CustomFieldInputs entityType="deal" value={custom} onChange={setCustom} />
      <ErrorText error={mutation.error} />
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={mutation.isPending}>{initial ? 'Save changes' : 'Create deal'}</Button>
      </div>
    </form>
  );
}

function DealCard({
  deal,
  onEdit,
  onDelete,
}: {
  deal: Deal;
  onEdit(): void;
  onDelete(): void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/deal-id', deal.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className="group cursor-grab rounded-lg border border-[var(--grid)] bg-[var(--surface-1)] p-3 shadow-sm transition-shadow hover:shadow active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-1">
        <button onClick={onEdit} className="text-left text-sm font-medium hover:text-[var(--series-1)]">
          {deal.title}
        </button>
        <button
          onClick={onDelete}
          aria-label={`Delete ${deal.title}`}
          className="invisible text-xs text-[var(--ink-muted)] hover:text-[var(--status-critical)] group-hover:visible"
        >
          ✕
        </button>
      </div>
      <p className="mt-1 text-sm tabular-nums text-[var(--ink-2)]">{fmtMoney(deal.value, deal.currency)}</p>
      {(deal.companyName || deal.contactName) && (
        <p className="mt-0.5 truncate text-xs text-[var(--ink-muted)]">
          {deal.companyName ?? deal.contactName}
        </p>
      )}
    </div>
  );
}

export function Deals() {
  const qc = useQueryClient();
  const pipelines = useQuery({
    queryKey: ['pipelines'],
    queryFn: () => get<{ data: Pipeline[] }>('/pipelines'),
  });
  const [pipelineId, setPipelineId] = useState<string>('');
  const activePipelineId =
    pipelineId ||
    pipelines.data?.data.find((p) => p.isDefault)?.id ||
    pipelines.data?.data[0]?.id ||
    '';
  const activePipeline = pipelines.data?.data.find((p) => p.id === activePipelineId);

  const board = useQuery({
    queryKey: ['board', activePipelineId],
    queryFn: () => get<Board>(`/deals/board?pipeline_id=${activePipelineId}`),
    enabled: !!activePipelineId,
  });

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Deal | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const move = useMutation({
    mutationFn: ({ dealId, stageId }: { dealId: string; stageId: string }) =>
      post(`/deals/${dealId}/move`, { stageId }),
    // Optimistic update: move the card immediately, reconcile on settle.
    onMutate: async ({ dealId, stageId }) => {
      await qc.cancelQueries({ queryKey: ['board', activePipelineId] });
      const prev = qc.getQueryData<Board>(['board', activePipelineId]);
      if (prev) {
        const deal = prev.stages.flatMap((s) => s.deals).find((d) => d.id === dealId);
        if (deal) {
          qc.setQueryData<Board>(['board', activePipelineId], {
            ...prev,
            stages: prev.stages.map((s) => {
              const deals = s.deals.filter((d) => d.id !== dealId);
              if (s.id === stageId) deals.unshift({ ...deal, stageId });
              return { ...s, deals, totalValue: deals.reduce((sum, d) => sum + Number(d.value), 0) };
            }),
          });
        }
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['board', activePipelineId], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['board', activePipelineId] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => del(`/deals/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['board', activePipelineId] }),
  });

  const onDrop = (stageId: string) => (e: DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const dealId = e.dataTransfer.getData('text/deal-id');
    if (dealId) move.mutate({ dealId, stageId });
  };

  if (pipelines.isLoading) return <Spinner />;

  return (
    <div className="flex h-full flex-col space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">Deals</h1>
        <Select
          value={activePipelineId}
          onChange={(e) => setPipelineId(e.target.value)}
          className="w-48"
          aria-label="Pipeline"
        >
          {(pipelines.data?.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" onClick={() => window.open('/api/v1/deals/export', '_blank')}>Export</Button>
          <Button onClick={() => setCreating(true)} disabled={!activePipeline}>+ New deal</Button>
        </div>
      </div>
      <ErrorText error={move.error ?? remove.error} />

      {board.isLoading ? (
        <Spinner />
      ) : (
        <div className="board-scroll -mx-1 flex flex-1 gap-3 overflow-x-auto px-1 pb-2">
          {(board.data?.stages ?? []).map((stage) => (
            <section
              key={stage.id}
              aria-label={`Stage ${stage.name}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(stage.id);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={onDrop(stage.id)}
              className={`flex w-64 shrink-0 flex-col rounded-xl border p-2 transition-colors ${
                dragOver === stage.id
                  ? 'border-[var(--series-1)] bg-[var(--series-1)]/5'
                  : 'border-[var(--grid)] bg-black/[.02] dark:bg-white/[.03]'
              }`}
            >
              <header className="mb-2 px-1">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-sm font-semibold">
                    {stage.name}
                    {(stage.isWon || stage.isLost) && (
                      <span className="ml-1 text-xs text-[var(--ink-muted)]">{stage.isWon ? '✓' : '✗'}</span>
                    )}
                  </h2>
                  <span className="text-xs text-[var(--ink-muted)]">{stage.deals.length}</span>
                </div>
                <p className="text-xs tabular-nums text-[var(--ink-muted)]">{fmtMoney(stage.totalValue)}</p>
              </header>
              <div className="board-scroll flex-1 space-y-2 overflow-y-auto">
                {stage.deals.map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    onEdit={() => setEditing(deal)}
                    onDelete={() => confirm(`Delete “${deal.title}”?`) && remove.mutate(deal.id)}
                  />
                ))}
                {stage.deals.length === 0 && (
                  <p className="px-1 py-4 text-center text-xs text-[var(--ink-muted)]">Drop deals here</p>
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      {creating && activePipeline && (
        <Modal title="New deal" onClose={() => setCreating(false)}>
          <DealForm pipeline={activePipeline} onDone={() => setCreating(false)} />
        </Modal>
      )}
      {editing && activePipeline && (
        <Modal title="Edit deal" onClose={() => setEditing(null)}>
          <DealForm pipeline={activePipeline} initial={editing} onDone={() => setEditing(null)} />
          <CloseDealActions deal={editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}

function CloseDealActions({ deal, onDone }: { deal: Deal; onDone(): void }) {
  const qc = useQueryClient();
  const close = useMutation({
    mutationFn: (status: 'won' | 'lost') => post(`/deals/${deal.id}/close`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['board'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      onDone();
    },
  });
  if (deal.status !== 'open') return null;
  return (
    <Card className="mt-4 flex items-center justify-between gap-2 p-3">
      <span className="text-sm text-[var(--ink-muted)]">Close this deal:</span>
      <div className="flex gap-2">
        <Button onClick={() => close.mutate('won')} disabled={close.isPending}>Mark won 🎉</Button>
        <Button variant="danger" onClick={() => close.mutate('lost')} disabled={close.isPending}>Mark lost</Button>
      </div>
    </Card>
  );
}
