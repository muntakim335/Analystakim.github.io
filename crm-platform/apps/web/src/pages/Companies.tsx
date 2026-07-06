import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, del, post } from '../api/client';
import type { Company } from '../api/types';
import { fmtDate } from '../api/types';
import { useList } from '../lib/useList';
import { DataTable, type Column } from '../components/DataTable';
import { Button, ErrorText, Field, Input, Modal } from '../components/ui';
import { CustomFieldInputs } from '../components/CustomFields';

function CompanyForm({ initial, onDone }: { initial?: Company; onDone(): void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    domain: initial?.domain ?? '',
    industry: initial?.industry ?? '',
    size: initial?.size ?? '',
    website: initial?.website ?? '',
    phone: initial?.phone ?? '',
  });
  const [custom, setCustom] = useState<Record<string, unknown>>(initial?.custom ?? {});
  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      initial ? api('PATCH', `/companies/${initial.id}`, body) : post('/companies', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['companies'] });
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate({
      name: form.name,
      domain: form.domain || null,
      industry: form.industry || null,
      size: form.size || null,
      website: form.website || null,
      phone: form.phone || null,
      custom,
    });
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Name" required>
        <Input value={form.name} onChange={set('name')} required autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Domain"><Input value={form.domain ?? ''} onChange={set('domain')} placeholder="acme.com" /></Field>
        <Field label="Industry"><Input value={form.industry ?? ''} onChange={set('industry')} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Size"><Input value={form.size ?? ''} onChange={set('size')} placeholder="11-50" /></Field>
        <Field label="Phone"><Input value={form.phone ?? ''} onChange={set('phone')} /></Field>
      </div>
      <Field label="Website"><Input value={form.website ?? ''} onChange={set('website')} /></Field>
      <CustomFieldInputs entityType="company" value={custom} onChange={setCustom} />
      <ErrorText error={mutation.error} />
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={mutation.isPending}>{initial ? 'Save changes' : 'Create company'}</Button>
      </div>
    </form>
  );
}

export function Companies() {
  const list = useList<Company>('companies');
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => del(`/companies/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['companies'] }),
  });

  const columns: Column<Company>[] = [
    { key: 'name', header: 'Name', sortable: true, render: (c) => <span className="font-medium">{c.name}</span> },
    { key: 'industry', header: 'Industry', render: (c) => c.industry ?? '—' },
    { key: 'contactCount', header: 'Contacts', render: (c) => c.contactCount },
    { key: 'openDealCount', header: 'Open deals', render: (c) => c.openDealCount },
    { key: 'ownerName', header: 'Owner', render: (c) => c.ownerName ?? '—' },
    { key: 'created_at', header: 'Created', sortable: true, render: (c) => fmtDate(c.createdAt) },
    {
      key: 'actions', header: '', render: (c) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" onClick={() => setEditing(c)}>Edit</Button>
          <Button
            variant="ghost"
            onClick={() => confirm(`Delete ${c.name}?`) && remove.mutate(c.id)}
            aria-label={`Delete ${c.name}`}
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
        <h1 className="text-lg font-semibold">Companies</h1>
        <div className="ml-auto flex items-center gap-2">
          <Input
            placeholder="Search companies…"
            value={list.q}
            onChange={(e) => list.onSearch(e.target.value)}
            className="w-56"
            aria-label="Search companies"
          />
          <Button variant="ghost" onClick={() => window.open('/api/v1/companies/export', '_blank')}>Export</Button>
          <Button onClick={() => setCreating(true)}>+ New company</Button>
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
          title: 'No companies yet',
          hint: 'Companies are created automatically when you convert leads, or add one now.',
          action: <Button onClick={() => setCreating(true)}>+ New company</Button>,
        }}
      />

      {creating && (
        <Modal title="New company" onClose={() => setCreating(false)}>
          <CompanyForm onDone={() => setCreating(false)} />
        </Modal>
      )}
      {editing && (
        <Modal title="Edit company" onClose={() => setEditing(null)}>
          <CompanyForm initial={editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}
