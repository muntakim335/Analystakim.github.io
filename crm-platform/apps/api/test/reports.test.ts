import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, registerOrg, api, type TestApp } from './helpers.js';

describe('reports & dashboard', () => {
  let t: TestApp;
  let org: Awaited<ReturnType<typeof registerOrg>>;
  let pipelineId: string;

  beforeAll(async () => {
    t = await createTestApp();
    org = await registerOrg(t.app);
    pipelineId = (await api(t.app, org.accessToken, 'GET', '/pipelines')).json().data[0].id;

    await api(t.app, org.accessToken, 'POST', '/contacts', { firstName: 'R1' });
    await api(t.app, org.accessToken, 'POST', '/companies', { name: 'RepCo' });
    for (const [title, value] of [['Open A', 1000], ['Open B', 2000]] as const) {
      await api(t.app, org.accessToken, 'POST', '/deals', { title, value, pipelineId });
    }
    const won = await api(t.app, org.accessToken, 'POST', '/deals', {
      title: 'Won deal', value: 5000, pipelineId,
    });
    await api(t.app, org.accessToken, 'POST', `/deals/${won.json().id}/close`, { status: 'won' });
    for (const source of ['website', 'website', 'referral']) {
      await api(t.app, org.accessToken, 'POST', '/leads', { name: `L-${source}-${Math.random()}`, source });
    }
    const convert = await api(t.app, org.accessToken, 'POST', '/leads', {
      name: 'Converting lead', source: 'website',
    });
    await api(t.app, org.accessToken, 'POST', `/leads/${convert.json().id}/convert`, {});
  });
  afterAll(async () => t.close());

  it('overview KPIs reflect the data', async () => {
    const res = await api(t.app, org.accessToken, 'GET', '/reports/overview');
    const kpi = res.json();
    expect(kpi.contacts).toBeGreaterThanOrEqual(2); // R1 + converted lead
    expect(kpi.openDeals).toBe(2);
    expect(kpi.openValue).toBe(3000);
    expect(kpi.wonThisMonth).toBe(1);
    expect(kpi.wonValueThisMonth).toBe(5000);
    expect(kpi.newLeads30d).toBe(4);
  });

  it('pipeline funnel aggregates per open stage with weighted values', async () => {
    const res = await api(t.app, org.accessToken, 'GET', `/reports/pipeline?pipeline_id=${pipelineId}`);
    const stages = res.json().stages;
    expect(stages.length).toBe(4); // won/lost excluded
    const first = stages[0];
    expect(first.count).toBe(2);
    expect(first.value).toBe(3000);
    expect(first.weightedValue).toBeCloseTo(3000 * first.probability / 100);
  });

  it('revenue by month contains the won deal in the current month', async () => {
    const res = await api(t.app, org.accessToken, 'GET', '/reports/revenue?months=3');
    const month = new Date().toISOString().slice(0, 7);
    const row = res.json().data.find((r: any) => r.month === month);
    expect(row.value).toBe(5000);
    expect(row.count).toBe(1);
  });

  it('lead sources report counts and conversion rates', async () => {
    const res = await api(t.app, org.accessToken, 'GET', '/reports/lead-sources');
    const website = res.json().data.find((r: any) => r.source === 'website');
    expect(website.total).toBe(3);
    expect(website.converted).toBe(1);
    expect(website.conversionRate).toBe(33);
  });

  it('leaderboard ranks owners by won value', async () => {
    const res = await api(t.app, org.accessToken, 'GET', '/reports/leaderboard?period=month');
    const me = res.json().data.find((r: any) => r.id === org.user.id);
    expect(me.wonValue).toBe(5000);
    expect(me.openValue).toBe(3000);
  });

  it('reports are tenant-scoped', async () => {
    const other = await registerOrg(t.app);
    const res = await api(t.app, other.accessToken, 'GET', '/reports/overview');
    expect(res.json().contacts).toBe(0);
    expect(res.json().openValue).toBe(0);
  });
});
