import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, post } from '../api/client';
import type { Activity, Contact, Note, Paginated, Task } from '../api/types';
import { fmtDateTime, timeAgo } from '../api/types';
import { Badge, Button, Card, ErrorText, Modal, Spinner, Textarea } from '../components/ui';
import { ContactForm } from './Contacts';
import { useCustomFields } from '../components/CustomFields';

function Timeline({ entityType, entityId }: { entityType: string; entityId: string }) {
  const { data } = useQuery({
    queryKey: ['timeline', entityType, entityId],
    queryFn: () => get<{ data: Activity[] }>(`/activities?entity_type=${entityType}&entity_id=${entityId}`),
  });
  const items = data?.data ?? [];
  if (items.length === 0) return <p className="text-sm text-[var(--ink-muted)]">No activity yet.</p>;
  return (
    <ol className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="flex gap-3 text-sm">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--series-1)]" aria-hidden />
          <div className="min-w-0">
            <p>
              <span className="font-medium">{a.actorName ?? 'System'}</span>{' '}
              <span className="text-[var(--ink-2)]">{a.type.replace(/_/g, ' ')}</span>
              {typeof a.payload.preview === 'string' && (
                <span className="text-[var(--ink-muted)]"> — “{a.payload.preview}”</span>
              )}
              {typeof a.payload.from === 'string' && typeof a.payload.to === 'string' && (
                <span className="text-[var(--ink-muted)]"> — {a.payload.from} → {a.payload.to}</span>
              )}
            </p>
            <p className="text-xs text-[var(--ink-muted)]">{timeAgo(a.createdAt)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Notes({ relatedType, relatedId }: { relatedType: string; relatedId: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const { data } = useQuery({
    queryKey: ['notes', relatedType, relatedId],
    queryFn: () => get<{ data: Note[] }>(`/notes?related_type=${relatedType}&related_id=${relatedId}`),
  });
  const create = useMutation({
    mutationFn: () => post('/notes', { body, relatedType, relatedId }),
    onSuccess: () => {
      setBody('');
      qc.invalidateQueries({ queryKey: ['notes', relatedType, relatedId] });
      qc.invalidateQueries({ queryKey: ['timeline', relatedType, relatedId] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (body.trim()) create.mutate();
  };
  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="space-y-2">
        <Textarea
          rows={3}
          placeholder="Write a note…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={create.isPending || !body.trim()}>Add note</Button>
        </div>
      </form>
      {(data?.data ?? []).map((n) => (
        <div key={n.id} className="rounded-lg border border-[var(--grid)] p-3 text-sm">
          <p className="whitespace-pre-wrap">{n.body}</p>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            {n.authorName ?? 'Unknown'} · {timeAgo(n.createdAt)}
          </p>
        </div>
      ))}
    </div>
  );
}

function RelatedTasks({ relatedType, relatedId }: { relatedType: string; relatedId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['tasks', relatedType, relatedId],
    queryFn: () => get<Paginated<Task>>(`/tasks?related_type=${relatedType}&related_id=${relatedId}&limit=50`),
  });
  const complete = useMutation({
    mutationFn: (id: string) => post(`/tasks/${id}/complete`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['timeline', relatedType, relatedId] });
    },
  });
  const [title, setTitle] = useState('');
  const create = useMutation({
    mutationFn: () => post('/tasks', { title, relatedType, relatedId }),
    onSuccess: () => {
      setTitle('');
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
  return (
    <div className="space-y-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) create.mutate();
        }}
        className="flex gap-2"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Quick task…"
          className="flex-1 rounded-md border border-[var(--grid)] bg-[var(--surface-1)] px-3 py-1.5 text-sm focus:border-[var(--series-1)] focus:outline-none"
        />
        <Button type="submit" disabled={!title.trim() || create.isPending}>Add</Button>
      </form>
      {(data?.data ?? []).map((t) => (
        <div key={t.id} className="flex items-center gap-2 rounded-lg border border-[var(--grid)] px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={t.status === 'done'}
            disabled={t.status === 'done'}
            onChange={() => complete.mutate(t.id)}
            aria-label={`Complete ${t.title}`}
            className="h-4 w-4 accent-[var(--series-1)]"
          />
          <span className={t.status === 'done' ? 'text-[var(--ink-muted)] line-through' : ''}>{t.title}</span>
          <span className="ml-auto text-xs text-[var(--ink-muted)]">{fmtDateTime(t.dueDate)}</span>
          <Badge value={t.priority} />
        </div>
      ))}
    </div>
  );
}

export function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<'timeline' | 'notes' | 'tasks'>('timeline');

  const { data: contact, isLoading, error } = useQuery({
    queryKey: ['contact', id],
    queryFn: () => get<Contact>(`/contacts/${id}`),
  });
  const fields = useCustomFields('contact');

  const remove = useMutation({
    mutationFn: () => del(`/contacts/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      navigate('/contacts');
    },
  });

  if (isLoading) return <Spinner />;
  if (error || !contact) return <p className="text-sm text-[var(--status-critical)]">Contact not found.</p>;

  const customDefs = fields.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <Link to="/contacts" className="text-xs text-[var(--series-1)] hover:underline">← Contacts</Link>
          <h1 className="text-lg font-semibold">
            {contact.firstName} {contact.lastName}
          </h1>
          <p className="text-sm text-[var(--ink-muted)]">
            {contact.title ?? '—'}{contact.companyName ? ` · ${contact.companyName}` : ''}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
          <Button
            variant="danger"
            onClick={() => confirm('Delete this contact? This cannot be undone.') && remove.mutate()}
          >
            Delete
          </Button>
        </div>
      </div>
      <ErrorText error={remove.error} />

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card className="h-fit p-4 text-sm">
          <dl className="space-y-2">
            <div><dt className="text-xs uppercase text-[var(--ink-muted)]">Email</dt><dd>{contact.email ?? '—'}</dd></div>
            <div><dt className="text-xs uppercase text-[var(--ink-muted)]">Phone</dt><dd>{contact.phone ?? '—'}</dd></div>
            <div><dt className="text-xs uppercase text-[var(--ink-muted)]">Owner</dt><dd>{contact.ownerName ?? '—'}</dd></div>
            {customDefs.map((d) => (
              <div key={d.id}>
                <dt className="text-xs uppercase text-[var(--ink-muted)]">{d.label}</dt>
                <dd>{contact.custom[d.key] === null || contact.custom[d.key] === undefined ? '—' : String(contact.custom[d.key])}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex gap-1 border-b border-[var(--grid)] pb-2" role="tablist">
            {(['timeline', 'notes', 'tasks'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1 text-sm font-medium capitalize ${tab === t ? 'bg-[var(--series-1)]/10 text-[var(--series-1)]' : 'text-[var(--ink-2)] hover:bg-black/5 dark:hover:bg-white/5'}`}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === 'timeline' && <Timeline entityType="contact" entityId={contact.id} />}
          {tab === 'notes' && <Notes relatedType="contact" relatedId={contact.id} />}
          {tab === 'tasks' && <RelatedTasks relatedType="contact" relatedId={contact.id} />}
        </Card>
      </div>

      {editing && (
        <Modal title="Edit contact" onClose={() => setEditing(false)}>
          <ContactForm initial={contact} onDone={() => setEditing(false)} />
        </Modal>
      )}
    </div>
  );
}
