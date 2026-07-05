import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, registerOrg, api, type TestApp } from './helpers.js';
import { evaluateConditions } from '../src/modules/workflows.js';

describe('workflow automation engine', () => {
  let t: TestApp;
  let org: Awaited<ReturnType<typeof registerOrg>>;

  beforeAll(async () => {
    t = await createTestApp();
    org = await registerOrg(t.app);
  });
  afterAll(async () => t.close());

  it('condition evaluator covers all operators', () => {
    const data = { source: 'website', value: 5000, custom: { region: 'EMEA' }, empty: '' };
    expect(evaluateConditions([{ field: 'source', op: 'eq', value: 'website' }], data)).toBe(true);
    expect(evaluateConditions([{ field: 'source', op: 'neq', value: 'ads' }], data)).toBe(true);
    expect(evaluateConditions([{ field: 'value', op: 'gt', value: 4999 }], data)).toBe(true);
    expect(evaluateConditions([{ field: 'value', op: 'lte', value: 5000 }], data)).toBe(true);
    expect(evaluateConditions([{ field: 'source', op: 'contains', value: 'WEB' }], data)).toBe(true);
    expect(evaluateConditions([{ field: 'custom.region', op: 'eq', value: 'EMEA' }], data)).toBe(true);
    expect(evaluateConditions([{ field: 'missing', op: 'not_set' }], data)).toBe(true);
    expect(evaluateConditions([{ field: 'empty', op: 'is_set' }], data)).toBe(false);
    expect(evaluateConditions([{ field: 'value', op: 'lt', value: 100 }], data)).toBe(false);
  });

  it('lead.created workflow creates a task and a notification when conditions match', async () => {
    const wf = await api(t.app, org.accessToken, 'POST', '/workflows', {
      name: 'First-call SLA',
      triggerType: 'lead.created',
      conditions: [{ field: 'source', op: 'eq', value: 'website' }],
      actions: [
        { type: 'create_task', title: 'Call within 24h', dueInDays: 1, assign: 'owner' },
        { type: 'notify', target: 'owner', message: 'New website lead' },
      ],
    });
    expect(wf.statusCode).toBe(201);

    await api(t.app, org.accessToken, 'POST', '/leads', {
      name: 'Hot Lead', source: 'website',
    });
    await api(t.app, org.accessToken, 'POST', '/leads', {
      name: 'Cold Lead', source: 'coldcall',
    });
    await t.bus.settle();

    const tasks = await api(t.app, org.accessToken, 'GET', '/tasks?q=Call within');
    expect(tasks.json().total).toBe(1); // only the matching lead fired

    const notif = await api(t.app, org.accessToken, 'GET', '/notifications');
    expect(notif.json().data.some((n: any) => n.title === 'New website lead')).toBe(true);

    const runs = await api(t.app, org.accessToken, 'GET', `/workflows/${wf.json().id}/runs`);
    expect(runs.json().data).toHaveLength(1);
    expect(runs.json().data[0].status).toBe('success');
  });

  it('deal.stage_changed workflow fires on kanban moves', async () => {
    const pipelines = await api(t.app, org.accessToken, 'GET', '/pipelines');
    const pipeline = pipelines.json().data[0];
    await api(t.app, org.accessToken, 'POST', '/workflows', {
      name: 'Proposal follow-up',
      triggerType: 'deal.stage_changed',
      conditions: [{ field: 'toStage', op: 'eq', value: 'Proposal Sent' }],
      actions: [{ type: 'create_task', title: 'Follow up on proposal', dueInDays: 2 }],
    });
    const deal = await api(t.app, org.accessToken, 'POST', '/deals', {
      title: 'WF Deal', pipelineId: pipeline.id,
    });
    const proposalStage = pipeline.stages.find((s: any) => s.name === 'Proposal Sent');
    await api(t.app, org.accessToken, 'POST', `/deals/${deal.json().id}/move`, {
      stageId: proposalStage.id,
    });
    await t.bus.settle();

    const tasks = await api(t.app, org.accessToken, 'GET', '/tasks?q=Follow up on proposal');
    expect(tasks.json().total).toBe(1);
    expect(tasks.json().data[0].relatedType).toBe('deal');
    expect(tasks.json().data[0].relatedId).toBe(deal.json().id);
  });

  it('update_field action mutates the entity within the whitelist', async () => {
    await api(t.app, org.accessToken, 'POST', '/workflows', {
      name: 'Auto-qualify referrals',
      triggerType: 'lead.created',
      conditions: [{ field: 'source', op: 'eq', value: 'referral' }],
      actions: [{ type: 'update_field', field: 'status', value: 'qualified' }],
    });
    const lead = await api(t.app, org.accessToken, 'POST', '/leads', {
      name: 'Referred Lead', source: 'referral',
    });
    await t.bus.settle();
    const after = await api(t.app, org.accessToken, 'GET', `/leads/${lead.json().id}`);
    expect(after.json().status).toBe('qualified');
  });

  it('send_email without SMTP records a failed/partial run, not a crash', async () => {
    const wf = await api(t.app, org.accessToken, 'POST', '/workflows', {
      name: 'Email on won',
      triggerType: 'deal.won',
      actions: [{ type: 'send_email', to: 'owner', subject: 'Won!', body: 'gg' }],
    });
    const pipelines = await api(t.app, org.accessToken, 'GET', '/pipelines');
    const deal = await api(t.app, org.accessToken, 'POST', '/deals', {
      title: 'Email Deal', pipelineId: pipelines.json().data[0].id,
    });
    await api(t.app, org.accessToken, 'POST', `/deals/${deal.json().id}/close`, { status: 'won' });
    await t.bus.settle();

    const runs = await api(t.app, org.accessToken, 'GET', `/workflows/${wf.json().id}/runs`);
    expect(runs.json().data).toHaveLength(1);
    expect(runs.json().data[0].status).toBe('failed');
    expect(runs.json().data[0].detail.results[0].detail).toContain('SMTP');
  });

  it('disabled workflows do not fire', async () => {
    const wf = await api(t.app, org.accessToken, 'POST', '/workflows', {
      name: 'Disabled', triggerType: 'lead.created', isActive: false,
      actions: [{ type: 'create_task', title: 'Should never exist' }],
    });
    expect(wf.json().isActive).toBe(false);
    await api(t.app, org.accessToken, 'POST', '/leads', { name: 'Quiet lead' });
    await t.bus.settle();
    const tasks = await api(t.app, org.accessToken, 'GET', '/tasks?q=Should never exist');
    expect(tasks.json().total).toBe(0);
  });

  it('workflows are org-scoped: another org’s events do not trigger them', async () => {
    const other = await registerOrg(t.app);
    await api(t.app, other.accessToken, 'POST', '/leads', { name: 'Other org lead', source: 'website' });
    await t.bus.settle();
    const tasks = await api(t.app, other.accessToken, 'GET', '/tasks');
    expect(tasks.json().total).toBe(0);
  });
});
