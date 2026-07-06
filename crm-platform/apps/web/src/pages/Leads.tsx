import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, del, get, post } from '../api/client';
import type { Lead, Pipeline } from '../api/types';
import { fmtDate } from '../api/types';
import { useList } from '../lib/useList';
import { DataTable, type Column } from '../components/DataTable';
import { Badge, Button, ErrorText, Field, Input, Modal, Select } from '../components/ui';
import { CustomFieldInputs } from '../components/CustomFields';

const STATUSES = ['new', 'contacted', 'qualified', 'unqualified'] as const;

function LeadForm({ initial, onDone }: { initial?: Lead; onDone(): void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    companyName: initial?.companyName ?? '',
    source: initial?.source ?? '',
    status: initial?.status ?? 'new',
  });
  const [custom, setCustom] = useState<Record<string, unknown>>(initial?.custom ?? {});
  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      initial ? api('PATCH', `/leads/${initial.id}`, body) : post('/leads', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate({
      name: form.name,
      email: form.email || null,
      phone: form.phone || null,
      companyName: form.companyName || null,
      source: form.source || null,
      status: form.status,
      custom,
    });
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Name" required>
        <Input value={form.name} onChange={set('name')} required autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Email"><Input type="email" value={form.email ?? ''} onChange={set('email')} /></Field>
        <Field label="Phone"><Input value={form.phone ?? ''} onChange={set('phone')} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Company"><Input value={form.companyName ?? ''} onChange={set('companyName')} /></Field>
        <Field label="Source">
          <Input value={form.source ?? ''} onChange={set('source')} placeholder="website, referral…" list="lead-sources" />
        </Field>
      </div>
      <datalist id="lead-sources">
        {['website', 'referral', 'coldcall', 'event', 'ads', 'social'].map((s) => <option key={s} value={s} />)}
      </datalist>
      <Field label="Status">
        <Select value={form.status} onChange={set('status')}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </Field>
      <CustomFieldInputs entityType="lead" value={custom} onChange={setCustom} />
      <ErrorText error={mutation.error} />
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={mutation.isPending}>{initial ? 'Save changes' : 'Create lead'}</Button>
      </div>
    </form>
  );
}

function ConvertModal({ lead, onDone }: { lead: Lead; onDone(): void }) {
  const qc = useQueryClient();
  const pipelines = useQuery({
    queryKey: ['pipelines'],
    queryFn: () => get<{ data: Pipeline[] }>('/pipelines'),
  });
  const [withDeal, setWithDeal] = useState(true);
  const [deal, setDeal] = useState({ title: `${lead.companyName ?? lead.name} – New deal`, value: '0' });

  const convert = useMutation({
    mutationFn: () =>
      post(`/leads/${lead.id}/convert`, {
        createCompany: true,
        ...(withDeal ? { deal: { title: deal.title, value: Number(deal.value) || 0 } } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['companies'] });
      qc.invalidateQueries({ queryKey: ['board'] });
      onDone();
    },
  });

  return (
    <Modal title={`Convert “${lead.name}”`} onClose={onDone}>
      <div className="space-y-3 text-sm">
        <p className="text-[var(--ink-muted)]">
          Conversion creates a <strong>contact</strong>
          {lead.companyName ? <> and links or creates the company <strong>{lead.companyName}</strong></> : null}, all in one step.
        </p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={withDeal}
            onChange={(e) => setWithDeal(e.target.checked)}
            className="h-4 w-4 accent-[var(--series-1)]"
          />
          Also create a deal in {pipelines.data?.data.find((p) => p.isDefault)?.name ?? 'the default pipeline'}
        </label>
        {withDeal && (
          <div className="grid grid-cols-[1fr_8rem] gap-3">
            <Field label="Deal title" required>
              <Input value={deal.title} onChange={(e) => setDeal({ ...deal, title: e.target.value })} required />
            </Field>
            <Field label="Value (USD)">
              <Input type="number" min="0" value={deal.value} onChange={(e) => setDeal({ ...deal, value: e.target.value })} />
            </Field>
          </div>
        )}
        <ErrorText error={convert.error} />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onDone}>Cancel</Button>
          <Button onClick={() => convert.mutate()} disabled={convert.isPending || (withDeal && !deal.title.trim())}>
            {convert.isPending ? 'Converting…' : 'Convert lead'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function Leads() {
  const [status, setStatus] = useState('');
  const list = useList<Lead>('leads', { status: status || undefined });
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [converting, setConverting] = useState<Lead | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => del(`/leads/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });

  const columns: Column<Lead>[] = [
    { key: 'name', header: 'Name', sortable: true, render: (l) => <span className="font-medium">{l.name}</span> },
    { key: 'companyName', header: 'Company', render: (l) => l.companyName ?? '—' },
    { key: 'source', header: 'Source', render: (l) => l.source ?? '—' },
    { key: 'status', header: 'Status', sortable: true, render: (l) => <Badge value={l.status} /> },
    { key: 'ownerName', header: 'Owner', render: (l) => l.ownerName ?? '—' },
    { key: 'created_at', header: 'Created', sortable: true, render: (l) => fmtDate(l.createdAt) },
    {
      key: 'actions', header: '', render: (l) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {l.status !== 'converted' && (
            <>
              <Button onClick={() => setConverting(l)}>Convert</Button>
              <Button variant="ghost" onClick={() => setEditing(l)}>Edit</Button>
            </>
          )}
          <Button
            variant="ghost"
            onClick={() => confirm(`Delete lead “${l.name}”?`) && remove.mutate(l.id)}
            aria-label={`Delete ${l.name}`}
          >
            🗑
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">Leads</h1>
        <div className="ml-auto flex items-center gap-2">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36" aria-label="Filter by status">
            <option value="">All statuses</option>
            {[...STATUSES, 'converted'].map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Input
            placeholder="Search leads…"
            value={list.q}
            onChange={(e) => list.onSearch(e.target.value)}
            className="w-56"
            aria-label="Search leads"
          />
          <Button onClick={() => setCreating(true)}>+ New lead</Button>
        </div>
      </div>
      <ErrorText error={remove.error} />

      <DataTable
        columns={columns}
        result={list.query.data}
        loading={list.query.isLoading}
        sort={list.sort}
        order={list.order}
        onSort={list.onSort}
        page={list.page}
        onPage={list.setPage}
        empty={{
          title: 'No leads yet',
          hint: 'Leads are unqualified prospects. Qualify them, then convert to contacts and deals.',
          action: <Button onClick={() => setCreating(true)}>+ New lead</Button>,
        }}
      />

      {creating && (
        <Modal title="New lead" onClose={() => setCreating(false)}>
          <LeadForm onDone={() => setCreating(false)} />
        </Modal>
      )}
      {editing && (
        <Modal title="Edit lead" onClose={() => setEditing(null)}>
          <LeadForm initial={editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
      {converting && <ConvertModal lead={converting} onDone={() => setConverting(null)} />}
    </div>
  );
}
