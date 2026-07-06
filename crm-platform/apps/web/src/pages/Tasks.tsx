import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, del, get, post } from '../api/client';
import type { Task, TeamUser } from '../api/types';
import { fmtDateTime } from '../api/types';
import { useList } from '../lib/useList';
import { useAuth } from '../auth';
import { DataTable, type Column } from '../components/DataTable';
import { Badge, Button, ErrorText, Field, Input, Modal, Select, Textarea } from '../components/ui';

function TaskForm({ initial, onDone }: { initial?: Task; onDone(): void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const users = useQuery({ queryKey: ['users'], queryFn: () => get<{ data: TeamUser[] }>('/users') });
  const [form, setForm] = useState({
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    dueDate: initial?.dueDate ? initial.dueDate.slice(0, 16) : '',
    priority: initial?.priority ?? 'medium',
    assigneeId: initial?.assigneeId ?? user?.id ?? '',
  });
  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      initial ? api('PATCH', `/tasks/${initial.id}`, body) : post('/tasks', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate({
      title: form.title,
      description: form.description,
      dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
      priority: form.priority,
      assigneeId: form.assigneeId || null,
    });
  };
  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [k]: e.target.value });

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Title" required>
        <Input value={form.title} onChange={set('title')} required autoFocus />
      </Field>
      <Field label="Description">
        <Textarea rows={3} value={form.description} onChange={set('description')} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Due">
          <Input type="datetime-local" value={form.dueDate} onChange={set('dueDate')} />
        </Field>
        <Field label="Priority">
          <Select value={form.priority} onChange={set('priority')}>
            {['low', 'medium', 'high'].map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Assignee">
        <Select value={form.assigneeId} onChange={set('assigneeId')}>
          {(users.data?.data ?? []).filter((u) => u.isActive).map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </Select>
      </Field>
      <ErrorText error={mutation.error} />
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={mutation.isPending}>{initial ? 'Save changes' : 'Create task'}</Button>
      </div>
    </form>
  );
}

export function Tasks() {
  const { user } = useAuth();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [status, setStatus] = useState<'open' | 'done' | ''>('open');
  const [due, setDue] = useState('');
  const list = useList<Task>('tasks', {
    assignee_id: scope === 'mine' ? user?.id : undefined,
    status: status || undefined,
    due: due || undefined,
  });
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  const complete = useMutation({
    mutationFn: (id: string) => post(`/tasks/${id}/complete`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/tasks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const overdue = (t: Task) => t.status === 'open' && t.dueDate && new Date(t.dueDate) < new Date();

  const columns: Column<Task>[] = [
    {
      key: 'done', header: '', render: (t) => (
        <input
          type="checkbox"
          checked={t.status === 'done'}
          disabled={t.status === 'done'}
          onChange={() => complete.mutate(t.id)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Complete ${t.title}`}
          className="h-4 w-4 accent-[var(--series-1)]"
        />
      ),
    },
    {
      key: 'title', header: 'Task', sortable: true, render: (t) => (
        <div>
          <span className={t.status === 'done' ? 'text-[var(--ink-muted)] line-through' : 'font-medium'}>
            {t.title}
          </span>
          {t.relatedType && (
            <span className="ml-2 text-xs text-[var(--ink-muted)]">on {t.relatedType}</span>
          )}
        </div>
      ),
    },
    {
      key: 'due_date', header: 'Due', sortable: true, render: (t) => (
        <span className={overdue(t) ? 'font-medium text-[var(--status-critical)]' : ''}>
          {fmtDateTime(t.dueDate)}
        </span>
      ),
    },
    { key: 'priority', header: 'Priority', sortable: true, render: (t) => <Badge value={t.priority} /> },
    { key: 'assigneeName', header: 'Assignee', render: (t) => t.assigneeName ?? '—' },
    {
      key: 'actions', header: '', render: (t) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" onClick={() => setEditing(t)}>Edit</Button>
          <Button variant="ghost" onClick={() => confirm('Delete this task?') && remove.mutate(t.id)} aria-label={`Delete ${t.title}`}>
            🗑
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">Tasks</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={scope} onChange={(e) => setScope(e.target.value as 'mine' | 'all')} className="w-32" aria-label="Scope">
            <option value="mine">My tasks</option>
            <option value="all">All tasks</option>
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="w-28" aria-label="Status">
            <option value="open">Open</option>
            <option value="done">Done</option>
            <option value="">All</option>
          </Select>
          <Select value={due} onChange={(e) => setDue(e.target.value)} className="w-32" aria-label="Due filter">
            <option value="">Any due date</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="week">Next 7 days</option>
          </Select>
          <Button onClick={() => setCreating(true)}>+ New task</Button>
        </div>
      </div>
      <ErrorText error={complete.error ?? remove.error} />

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
          title: scope === 'mine' ? 'No tasks assigned to you' : 'No tasks',
          hint: 'Stay on top of follow-ups by always scheduling the next step.',
          action: <Button onClick={() => setCreating(true)}>+ New task</Button>,
        }}
      />

      {creating && (
        <Modal title="New task" onClose={() => setCreating(false)}>
          <TaskForm onDone={() => setCreating(false)} />
        </Modal>
      )}
      {editing && (
        <Modal title="Edit task" onClose={() => setEditing(null)}>
          <TaskForm initial={editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}
