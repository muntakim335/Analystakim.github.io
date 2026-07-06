import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, get, post } from '../api/client';
import type { Company, Contact, Paginated } from '../api/types';
import { fmtDate } from '../api/types';
import { useList } from '../lib/useList';
import { DataTable, type Column } from '../components/DataTable';
import { Button, ErrorText, Field, Input, Modal, Select } from '../components/ui';
import { CustomFieldInputs } from '../components/CustomFields';

export function ContactForm({
  initial,
  onDone,
}: {
  initial?: Partial<Contact> & { id?: string };
  onDone(): void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    firstName: initial?.firstName ?? '',
    lastName: initial?.lastName ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    title: initial?.title ?? '',
    companyId: initial?.companyId ?? '',
  });
  const [custom, setCustom] = useState<Record<string, unknown>>(initial?.custom ?? {});
  const companies = useQuery({
    queryKey: ['companies', 'picker'],
    queryFn: () => get<Paginated<Company>>('/companies?limit=100&sort=name&order=asc'),
  });

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      initial?.id ? api('PATCH', `/contacts/${initial.id}`, body) : post('/contacts', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['contact'] });
      onDone();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate({
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email || null,
      phone: form.phone || null,
      title: form.title || null,
      companyId: form.companyId || null,
      custom,
    });
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" required>
          <Input value={form.firstName} onChange={set('firstName')} required autoFocus />
        </Field>
        <Field label="Last name">
          <Input value={form.lastName} onChange={set('lastName')} />
        </Field>
      </div>
      <Field label="Email">
        <Input type="email" value={form.email ?? ''} onChange={set('email')} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone">
          <Input value={form.phone ?? ''} onChange={set('phone')} />
        </Field>
        <Field label="Job title">
          <Input value={form.title ?? ''} onChange={set('title')} />
        </Field>
      </div>
      <Field label="Company">
        <Select value={form.companyId ?? ''} onChange={set('companyId')}>
          <option value="">—</option>
          {(companies.data?.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <CustomFieldInputs entityType="contact" value={custom} onChange={setCustom} />
      <ErrorText error={mutation.error} />
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={mutation.isPending}>
          {initial?.id ? 'Save changes' : 'Create contact'}
        </Button>
      </div>
    </form>
  );
}

function ImportModal({ onDone }: { onDone(): void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<{ created: number; skipped: number; errors: { row: number; message: string }[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (e: FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api<typeof result>('POST', '/contacts/import', fd);
      setResult(r);
      qc.invalidateQueries({ queryKey: ['contacts'] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Import contacts from CSV" onClose={onDone}>
      {result ? (
        <div className="space-y-2 text-sm">
          <p>✅ Created <strong>{result.created}</strong> · skipped {result.skipped} duplicates</p>
          {result.errors.length > 0 && (
            <div>
              <p className="font-medium">Rows with problems:</p>
              <ul className="mt-1 list-inside list-disc text-[var(--ink-muted)]">
                {result.errors.slice(0, 10).map((e) => (
                  <li key={e.row}>Row {e.row}: {e.message}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end pt-2"><Button onClick={onDone}>Done</Button></div>
        </div>
      ) : (
        <form onSubmit={upload} className="space-y-3 text-sm">
          <p className="text-[var(--ink-muted)]">
            Upload a CSV with headers like <code>First Name, Last Name, Email, Phone, Title</code>.
            Rows matching an existing email are skipped.
          </p>
          <input ref={fileRef} type="file" accept=".csv,text/csv" required className="block w-full text-sm" />
          <ErrorText error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Importing…' : 'Import'}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function Contacts() {
  const navigate = useNavigate();
  const list = useList<Contact>('contacts');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const columns: Column<Contact>[] = [
    {
      key: 'name', header: 'Name', sortable: true,
      render: (c) => (
        <span className="font-medium">{c.firstName} {c.lastName}</span>
      ),
    },
    { key: 'email', header: 'Email', sortable: true, render: (c) => c.email ?? '—' },
    { key: 'companyName', header: 'Company', render: (c) => c.companyName ?? '—' },
    { key: 'title', header: 'Title', render: (c) => c.title ?? '—' },
    { key: 'ownerName', header: 'Owner', render: (c) => c.ownerName ?? '—' },
    { key: 'created_at', header: 'Created', sortable: true, render: (c) => fmtDate(c.createdAt) },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">Contacts</h1>
        <div className="ml-auto flex items-center gap-2">
          <Input
            placeholder="Search contacts…"
            value={list.q}
            onChange={(e) => list.onSearch(e.target.value)}
            className="w-56"
            aria-label="Search contacts"
          />
          <Button variant="ghost" onClick={() => setImporting(true)}>Import CSV</Button>
          <Button variant="ghost" onClick={() => window.open('/api/v1/contacts/export', '_blank')}>
            Export
          </Button>
          <Button onClick={() => setCreating(true)}>+ New contact</Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        result={list.query.data}
        loading={list.query.isLoading}
        sort={list.sort}
        order={list.order}
        onSort={list.onSort}
        page={list.page}
        onPage={list.setPage}
        onRowClick={(c) => navigate(`/contacts/${c.id}`)}
        empty={{
          title: 'No contacts yet',
          hint: 'Create your first contact or import your spreadsheet to get going.',
          action: (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setImporting(true)}>Import CSV</Button>
              <Button onClick={() => setCreating(true)}>+ New contact</Button>
            </div>
          ),
        }}
      />

      {creating && (
        <Modal title="New contact" onClose={() => setCreating(false)}>
          <ContactForm onDone={() => setCreating(false)} />
        </Modal>
      )}
      {importing && <ImportModal onDone={() => setImporting(false)} />}
    </div>
  );
}
