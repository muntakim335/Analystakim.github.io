import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { get } from '../api/client';
import { fmtMoney, fmtDateTime, type Task, type Activity } from '../api/types';
import { BarChart, StatTile } from '../components/charts';
import { Card, Spinner, Badge } from '../components/ui';
import { useAuth } from '../auth';

interface Overview {
  contacts: number;
  companies: number;
  openDeals: number;
  openValue: number;
  wonThisMonth: number;
  wonValueThisMonth: number;
  wonValuePrevMonth: number;
  newLeads30d: number;
  overdueTasks: number;
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => get<Overview>('/reports/overview') });
  const pipeline = useQuery({
    queryKey: ['report-pipeline'],
    queryFn: () => get<{ stages: { name: string; count: number; value: number }[] }>('/reports/pipeline'),
  });
  const revenue = useQuery({
    queryKey: ['report-revenue'],
    queryFn: () => get<{ data: { month: string; value: number }[] }>('/reports/revenue?months=12'),
  });
  const sources = useQuery({
    queryKey: ['report-sources'],
    queryFn: () => get<{ data: { source: string; total: number; conversionRate: number }[] }>('/reports/lead-sources'),
  });
  const myTasks = useQuery({
    queryKey: ['my-tasks', user?.id],
    queryFn: () => get<{ data: Task[] }>(`/tasks?assignee_id=${user!.id}&status=open&sort=due_date&order=asc&limit=6`),
    enabled: !!user,
  });
  const feed = useQuery({
    queryKey: ['feed'],
    queryFn: () => get<{ data: Activity[] }>('/activities?limit=8'),
  });

  if (overview.isLoading) return <Spinner />;
  const kpi = overview.data;
  const delta =
    kpi && kpi.wonValuePrevMonth > 0
      ? Math.round(((kpi.wonValueThisMonth - kpi.wonValuePrevMonth) / kpi.wonValuePrevMonth) * 100)
      : null;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Open pipeline" value={fmtMoney(kpi?.openValue ?? 0)} sub={`${kpi?.openDeals ?? 0} open deals`} />
        <StatTile
          label="Won this month"
          value={fmtMoney(kpi?.wonValueThisMonth ?? 0)}
          sub={delta === null ? `${kpi?.wonThisMonth ?? 0} deals won` : `${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta)}% vs last month`}
          subTone={delta === null ? undefined : delta >= 0 ? 'good' : 'bad'}
        />
        <StatTile label="New leads (30d)" value={String(kpi?.newLeads30d ?? 0)} />
        <StatTile label="Contacts" value={String(kpi?.contacts ?? 0)} sub={`${kpi?.companies ?? 0} companies`} />
        <StatTile
          label="Overdue tasks"
          value={String(kpi?.overdueTasks ?? 0)}
          sub={kpi?.overdueTasks ? 'Needs attention' : 'All clear'}
          subTone={kpi?.overdueTasks ? 'bad' : 'good'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Pipeline by stage (open deal value)">
          {pipeline.data && (
            <BarChart
              data={pipeline.data.stages.map((s) => ({
                label: s.name, value: s.value, display: `${fmtMoney(s.value)} · ${s.count} deals`,
              }))}
              formatValue={(v) => fmtMoney(v)}
            />
          )}
        </Section>
        <Section title="Revenue won by month">
          {revenue.data && (
            <BarChart
              data={revenue.data.data.map((r) => ({
                label: r.month.slice(5), value: r.value, display: fmtMoney(r.value),
              }))}
              formatValue={(v) => fmtMoney(v)}
            />
          )}
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Lead sources" action={<Link to="/leads" className="text-xs text-[var(--series-1)] hover:underline">View leads</Link>}>
          {sources.data && (
            <BarChart
              horizontal
              data={sources.data.data.slice(0, 6).map((s) => ({
                label: s.source, value: s.total, display: `${s.total} · ${s.conversionRate}% conv.`,
              }))}
            />
          )}
        </Section>

        <Section title="My upcoming tasks" action={<Link to="/tasks" className="text-xs text-[var(--series-1)] hover:underline">All tasks</Link>}>
          <ul className="space-y-2">
            {(myTasks.data?.data ?? []).map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{t.title}</span>
                <span className="shrink-0 text-xs text-[var(--ink-muted)]">{fmtDateTime(t.dueDate)}</span>
              </li>
            ))}
            {(myTasks.data?.data ?? []).length === 0 && (
              <p className="text-sm text-[var(--ink-muted)]">Nothing due. Enjoy the calm.</p>
            )}
          </ul>
        </Section>

        <Section title="Recent activity">
          <ul className="space-y-2">
            {(feed.data?.data ?? []).map((a) => (
              <li key={a.id} className="flex items-start gap-2 text-sm">
                <Badge value={a.type.replace(/_/g, ' ')} />
                <span className="min-w-0 flex-1 truncate text-[var(--ink-2)]">
                  {a.actorName ?? 'System'} · {a.entityType}
                  {typeof a.payload.name === 'string' && ` · ${a.payload.name}`}
                  {typeof a.payload.title === 'string' && ` · ${a.payload.title}`}
                </span>
              </li>
            ))}
            {(feed.data?.data ?? []).length === 0 && (
              <p className="text-sm text-[var(--ink-muted)]">Activity will appear here as your team works.</p>
            )}
          </ul>
        </Section>
      </div>
    </div>
  );
}
