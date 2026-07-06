import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, del, get, patch, post } from '../api/client';
import type { CustomFieldDef, Pipeline, TeamUser, Workflow } from '../api/types';
import { useAuth } from '../auth';
import { Badge, Button, Card, ErrorText, Field, Input, Modal, Select } from '../components/ui';

const TABS = ['team', 'pipelines', 'custom fields', 'workflows', 'profile'] as const;
type Tab = (typeof TABS)[number];

/* ---------------- Team ---------------- */

function TeamTab() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const users = useQuery({ queryKey: ['users'], queryFn: () => get<{ data: TeamUser[] }>('/users') });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'member' });
  const isAdmin = me?.role === 'admin';

  const create = useMutation({
    mutationFn: () => post('/users', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setAdding(false);
      setForm({ name: '', email: '', password: '', role: 'member' });
    },
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => patch(`/users/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <div className="space-y-3">
      {isAdmin && (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)}>+ Invite user</Button>
        </div>
      )}
      <ErrorText error={update.error} />
      <Card>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--grid)] text-xs uppercase text-[var(--ink-muted)]">
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Email</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5">Status</th>
              {isAdmin && <th className="px-4 py-2.5" />}
            </tr>
          </thead>
          <tbody>
            {(users.data?.data ?? []).map((u) => (
              <tr key={u.id} className="border-b border-[var(--grid)] last:border-0">
                <td className="px-4 py-2.5 font-medium">{u.name}{u.id === me?.id && ' (you)'}</td>
                <td className="px-4 py-2.5">{u.email}</td>
                <td className="px-4 py-2.5">
                  {isAdmin && u.id !== me?.id ? (
                    <Select
                      value={u.role}
                      onChange={(e) => update.mutate({ id: u.id, body: { role: e.target.value } })}
                      className="w-28"
                      aria-label={`Role for ${u.name}`}
                    >
                      {['admin', 'manager', 'member'].map((r) => <option key={r} value={r}>{r}</option>)}
                    </Select>
                  ) : (
                    <Badge value={u.role} />
                  )}
                </td>
                <td className="px-4 py-2.5">{u.isActive ? 'Active' : 'Deactivated'}</td>
                {isAdmin && (
                  <td className="px-4 py-2.5 text-right">
                    {u.id !== me?.id && (
                      <Button
                        variant="ghost"
                        onClick={() =>
                          update.mutate({ id: u.id, body: { isActive: !u.isActive } })
                        }
                      >
                        {u.isActive ? 'Deactivate' : 'Reactivate'}
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {adding && (
        <Modal title="Invite user" onClose={() => setAdding(false)}>
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              create.mutate();
            }}
            className="space-y-3"
          >
            <Field label="Name" required>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
            </Field>
            <Field label="Email" required>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </Field>
            <Field label="Temporary password" required>
              <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
            </Field>
            <Field label="Role">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {['member', 'manager', 'admin'].map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
            <ErrorText error={create.error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending}>Create user</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ---------------- Pipelines ---------------- */

function PipelinesTab() {
  const qc = useQueryClient();
  const pipelines = useQuery({ queryKey: ['pipelines'], queryFn: () => get<{ data: Pipeline[] }>('/pipelines') });
  const [newName, setNewName] = useState('');
  const invalidate = () => qc.invalidateQueries({ queryKey: ['pipelines'] });

  const createPipeline = useMutation({
    mutationFn: () => post('/pipelines', { name: newName }),
    onSuccess: () => {
      setNewName('');
      invalidate();
    },
  });
  const addStage = useMutation({
    mutationFn: ({ pipelineId, name }: { pipelineId: string; name: string }) =>
      post(`/pipelines/${pipelineId}/stages`, { name, probability: 50 }),
    onSuccess: invalidate,
  });
  const updateStage = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => patch(`/stages/${id}`, body),
    onSuccess: invalidate,
  });
  const deleteStage = useMutation({
    mutationFn: (id: string) => del(`/stages/${id}`),
    onSuccess: invalidate,
  });
  const setDefault = useMutation({
    mutationFn: (id: string) => patch(`/pipelines/${id}`, { isDefault: true }),
    onSuccess: invalidate,
  });

  const anyError =
    createPipeline.error ?? addStage.error ?? updateStage.error ?? deleteStage.error ?? setDefault.error;

  return (
    <div className="space-y-4">
      <ErrorText error={anyError} />
      {(pipelines.data?.data ?? []).map((p) => (
        <Card key={p.id} className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="font-semibold">{p.name}</h3>
            {p.isDefault ? (
              <Badge value="default" />
            ) : (
              <button className="text-xs text-[var(--series-1)] hover:underline" onClick={() => setDefault.mutate(p.id)}>
                Make default
              </button>
            )}
          </div>
          <ul className="space-y-1.5">
            {p.stages.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                <span className="w-6 text-center text-xs text-[var(--ink-muted)]">{s.position + 1}</span>
                <span className="flex-1">{s.name}</span>
                {s.isWon && <Badge value="won" />}
                {s.isLost && <Badge value="lost" />}
                {!s.isWon && !s.isLost && (
                  <label className="flex items-center gap-1 text-xs text-[var(--ink-muted)]">
                    win %
                    <input
                      type="number"
                      min={0}
                      max={100}
                      defaultValue={s.probability}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (v !== s.probability) updateStage.mutate({ id: s.id, body: { probability: v } });
                      }}
                      className="w-14 rounded border border-[var(--grid)] bg-[var(--surface-1)] px-1 py-0.5 text-right"
                      aria-label={`Win probability for ${s.name}`}
                    />
                  </label>
                )}
                <button
                  onClick={() => deleteStage.mutate(s.id)}
                  className="text-xs text-[var(--ink-muted)] hover:text-[var(--status-critical)]"
                  aria-label={`Delete stage ${s.name}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const input = (e.target as HTMLFormElement).elements.namedItem('stage') as HTMLInputElement;
              if (input.value.trim()) {
                addStage.mutate({ pipelineId: p.id, name: input.value.trim() });
                input.value = '';
              }
            }}
          >
            <Input name="stage" placeholder="Add stage…" className="max-w-48" />
            <Button type="submit" variant="ghost">Add</Button>
          </form>
        </Card>
      ))}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) createPipeline.mutate();
        }}
      >
        <Input
          placeholder="New pipeline name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="max-w-64"
        />
        <Button type="submit" disabled={!newName.trim() || createPipeline.isPending}>+ Add pipeline</Button>
      </form>
    </div>
  );
}

/* ---------------- Custom fields ---------------- */

function CustomFieldsTab() {
  const qc = useQueryClient();
  const fields = useQuery({
    queryKey: ['custom-fields'],
    queryFn: () => get<{ data: CustomFieldDef[] }>('/custom-fields'),
  });
  const [form, setForm] = useState({
    entityType: 'contact', label: '', key: '', fieldType: 'text', options: '',
  });
  const create = useMutation({
    mutationFn: () =>
      post('/custom-fields', {
        entityType: form.entityType,
        label: form.label,
        key: form.key || form.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
        fieldType: form.fieldType,
        options: form.fieldType === 'select' ? form.options.split(',').map((o) => o.trim()).filter(Boolean) : [],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-fields'] });
      setForm({ ...form, label: '', key: '', options: '' });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/custom-fields/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-fields'] }),
  });

  const grouped = (fields.data?.data ?? []).reduce<Record<string, CustomFieldDef[]>>((acc, f) => {
    (acc[f.entityType] ??= []).push(f);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold">Add custom field</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="grid gap-3 md:grid-cols-4"
        >
          <Field label="Entity">
            <Select value={form.entityType} onChange={(e) => setForm({ ...form, entityType: e.target.value })}>
              {['contact', 'company', 'lead', 'deal'].map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Label" required>
            <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required />
          </Field>
          <Field label="Type">
            <Select value={form.fieldType} onChange={(e) => setForm({ ...form, fieldType: e.target.value })}>
              {['text', 'number', 'date', 'select', 'checkbox'].map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          {form.fieldType === 'select' ? (
            <Field label="Options (comma-separated)" required>
              <Input value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} required />
            </Field>
          ) : (
            <div />
          )}
          <div className="md:col-span-4 flex justify-end">
            <Button type="submit" disabled={create.isPending}>Add field</Button>
          </div>
        </form>
        <ErrorText error={create.error} />
      </Card>

      {Object.entries(grouped).map(([entity, defs]) => (
        <Card key={entity} className="p-4">
          <h3 className="mb-2 text-sm font-semibold capitalize">{entity} fields</h3>
          <ul className="space-y-1.5 text-sm">
            {defs.map((d) => (
              <li key={d.id} className="flex items-center gap-2">
                <span className="font-medium">{d.label}</span>
                <code className="rounded bg-black/5 px-1 text-xs dark:bg-white/10">{d.key}</code>
                <Badge value={d.fieldType} />
                {d.fieldType === 'select' && (
                  <span className="text-xs text-[var(--ink-muted)]">{d.options.join(' · ')}</span>
                )}
                <button
                  onClick={() => confirm(`Delete field “${d.label}”?`) && remove.mutate(d.id)}
                  className="ml-auto text-xs text-[var(--ink-muted)] hover:text-[var(--status-critical)]"
                  aria-label={`Delete field ${d.label}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

/* ---------------- Workflows ---------------- */

const TRIGGERS = [
  ['lead.created', 'a lead is created'],
  ['contact.created', 'a contact is created'],
  ['deal.created', 'a deal is created'],
  ['deal.stage_changed', 'a deal changes stage'],
  ['deal.won', 'a deal is won'],
  ['deal.lost', 'a deal is lost'],
  ['task.completed', 'a task is completed'],
] as const;

function WorkflowsTab() {
  const qc = useQueryClient();
  const workflows = useQuery({ queryKey: ['workflows'], queryFn: () => get<{ data: Workflow[] }>('/workflows') });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '',
    triggerType: 'lead.created',
    condField: '',
    condValue: '',
    actionType: 'create_task',
    actionText: '',
    dueInDays: '1',
  });

  const create = useMutation({
    mutationFn: () => {
      const conditions = form.condField.trim()
        ? [{ field: form.condField.trim(), op: 'eq', value: form.condValue }]
        : [];
      const action =
        form.actionType === 'create_task'
          ? { type: 'create_task', title: form.actionText, dueInDays: Number(form.dueInDays) || 1, assign: 'owner' }
          : { type: 'notify', target: 'owner', message: form.actionText };
      return post('/workflows', {
        name: form.name, triggerType: form.triggerType, conditions, actions: [action],
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] });
      setCreating(false);
      setForm({ ...form, name: '', condField: '', condValue: '', actionText: '' });
    },
  });
  const toggle = useMutation({
    mutationFn: (wf: Workflow) => patch(`/workflows/${wf.id}`, { isActive: !wf.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows'] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/workflows/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows'] }),
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>+ New workflow</Button>
      </div>
      <ErrorText error={toggle.error ?? remove.error} />
      {(workflows.data?.data ?? []).length === 0 && (
        <Card className="p-6 text-center text-sm text-[var(--ink-muted)]">
          Automate the busywork: “When a lead is created from the website, create a follow-up task.”
        </Card>
      )}
      {(workflows.data?.data ?? []).map((wf) => (
        <Card key={wf.id} className="flex items-center gap-3 p-4 text-sm">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{wf.name}</p>
            <p className="text-xs text-[var(--ink-muted)]">
              When {TRIGGERS.find(([t]) => t === wf.triggerType)?.[1] ?? wf.triggerType}
              {wf.conditions.length > 0 &&
                ` if ${wf.conditions.map((c) => `${c.field} ${c.op} ${c.value ?? ''}`).join(' and ')}`}
              {' → '}
              {wf.actions.map((a) => String(a.type).replace(/_/g, ' ')).join(', ')}
            </p>
          </div>
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={wf.isActive}
              onChange={() => toggle.mutate(wf)}
              className="h-4 w-4 accent-[var(--series-1)]"
            />
            Active
          </label>
          <Button variant="ghost" onClick={() => confirm(`Delete workflow “${wf.name}”?`) && remove.mutate(wf.id)}>
            🗑
          </Button>
        </Card>
      ))}

      {creating && (
        <Modal title="New workflow" onClose={() => setCreating(false)} wide>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
            className="space-y-3 text-sm"
          >
            <Field label="Name" required>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
            </Field>
            <Field label="When…">
              <Select value={form.triggerType} onChange={(e) => setForm({ ...form, triggerType: e.target.value })}>
                {TRIGGERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Only if field equals (optional)">
                <Input
                  placeholder="e.g. source or toStage"
                  value={form.condField}
                  onChange={(e) => setForm({ ...form, condField: e.target.value })}
                />
              </Field>
              <Field label="Value">
                <Input
                  placeholder="e.g. website"
                  value={form.condValue}
                  onChange={(e) => setForm({ ...form, condValue: e.target.value })}
                  disabled={!form.condField.trim()}
                />
              </Field>
            </div>
            <div className="grid grid-cols-[10rem_1fr_6rem] gap-3">
              <Field label="Then…">
                <Select value={form.actionType} onChange={(e) => setForm({ ...form, actionType: e.target.value })}>
                  <option value="create_task">Create a task</option>
                  <option value="notify">Notify the owner</option>
                </Select>
              </Field>
              <Field label={form.actionType === 'create_task' ? 'Task title' : 'Message'} required>
                <Input value={form.actionText} onChange={(e) => setForm({ ...form, actionText: e.target.value })} required />
              </Field>
              {form.actionType === 'create_task' ? (
                <Field label="Due in days">
                  <Input type="number" min="0" value={form.dueInDays} onChange={(e) => setForm({ ...form, dueInDays: e.target.value })} />
                </Field>
              ) : (
                <div />
              )}
            </div>
            <ErrorText error={create.error} />
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending}>Create workflow</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ---------------- Profile ---------------- */

function ProfileTab() {
  const { user } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [passwords, setPasswords] = useState({ current: '', next: '' });
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      api('PATCH', '/auth/me', {
        name: name !== user?.name ? name : undefined,
        ...(passwords.next
          ? { currentPassword: passwords.current, newPassword: passwords.next }
          : {}),
      }),
    onSuccess: () => {
      setSaved(true);
      setPasswords({ current: '', next: '' });
      setTimeout(() => setSaved(false), 3000);
    },
  });

  return (
    <Card className="max-w-md p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="space-y-3"
      >
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email">
          <Input value={user?.email ?? ''} disabled />
        </Field>
        <hr className="border-[var(--grid)]" />
        <p className="text-sm font-medium">Change password</p>
        <Field label="Current password">
          <Input type="password" value={passwords.current} onChange={(e) => setPasswords({ ...passwords, current: e.target.value })} />
        </Field>
        <Field label="New password">
          <Input type="password" minLength={8} value={passwords.next} onChange={(e) => setPasswords({ ...passwords, next: e.target.value })} />
        </Field>
        <ErrorText error={save.error} />
        {saved && <p className="text-sm" style={{ color: 'var(--delta-good)' }}>Saved ✓ (password changes sign out other sessions)</p>}
        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending}>Save</Button>
        </div>
      </form>
    </Card>
  );
}

/* ---------------- Shell ---------------- */

export function Settings() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('team');
  const canManage = user?.role === 'admin' || user?.role === 'manager';
  const visible = TABS.filter((t) => {
    if (t === 'custom fields') return user?.role === 'admin';
    if (t === 'workflows' || t === 'pipelines') return canManage;
    return true;
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Settings</h1>
      <div className="flex flex-wrap gap-1 border-b border-[var(--grid)] pb-2" role="tablist">
        {visible.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize ${tab === t ? 'bg-[var(--series-1)]/10 text-[var(--series-1)]' : 'text-[var(--ink-2)] hover:bg-black/5 dark:hover:bg-white/5'}`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'team' && <TeamTab />}
      {tab === 'pipelines' && canManage && <PipelinesTab />}
      {tab === 'custom fields' && user?.role === 'admin' && <CustomFieldsTab />}
      {tab === 'workflows' && canManage && <WorkflowsTab />}
      {tab === 'profile' && <ProfileTab />}
    </div>
  );
}
