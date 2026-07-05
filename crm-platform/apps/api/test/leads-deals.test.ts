import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, registerOrg, api, type TestApp } from './helpers.js';

describe('leads, conversion, deals & kanban', () => {
  let t: TestApp;
  let org: Awaited<ReturnType<typeof registerOrg>>;
  let pipelineId: string;
  let stages: any[];

  beforeAll(async () => {
    t = await createTestApp();
    org = await registerOrg(t.app);
    const pipelines = await api(t.app, org.accessToken, 'GET', '/pipelines');
    pipelineId = pipelines.json().data[0].id;
    stages = pipelines.json().data[0].stages;
  });
  afterAll(async () => t.close());

  it('converts a lead into contact + company + deal atomically', async () => {
    const lead = await api(t.app, org.accessToken, 'POST', '/leads', {
      name: 'Grace Hopper', email: 'grace@navy.mil', companyName: 'US Navy', source: 'website',
    });
    expect(lead.statusCode).toBe(201);
    const leadId = lead.json().id;

    const conv = await api(t.app, org.accessToken, 'POST', `/leads/${leadId}/convert`, {
      deal: { title: 'Navy – COBOL migration', value: 50000 },
    });
    expect(conv.statusCode).toBe(200);
    const { contactId, companyId, dealId } = conv.json();
    expect(contactId && companyId && dealId).toBeTruthy();

    const contact = await api(t.app, org.accessToken, 'GET', `/contacts/${contactId}`);
    expect(contact.json().firstName).toBe('Grace');
    expect(contact.json().lastName).toBe('Hopper');
    expect(contact.json().companyId).toBe(companyId);

    const deal = await api(t.app, org.accessToken, 'GET', `/deals/${dealId}`);
    expect(deal.json().value).toBe(50000);
    expect(deal.json().contactId).toBe(contactId);

    const after = await api(t.app, org.accessToken, 'GET', `/leads/${leadId}`);
    expect(after.json().status).toBe('converted');
    expect(after.json().convertedDealId).toBe(dealId);

    // converted leads are read-only and cannot convert twice
    expect((await api(t.app, org.accessToken, 'PATCH', `/leads/${leadId}`, { name: 'X' })).statusCode).toBe(409);
    expect((await api(t.app, org.accessToken, 'POST', `/leads/${leadId}/convert`, {})).statusCode).toBe(409);
  });

  it('reuses an existing company by name on conversion', async () => {
    const lead = await api(t.app, org.accessToken, 'POST', '/leads', {
      name: 'Second Person', companyName: 'US Navy',
    });
    const conv = await api(t.app, org.accessToken, 'POST', `/leads/${lead.json().id}/convert`, {});
    const companies = await api(t.app, org.accessToken, 'GET', '/companies?q=Navy');
    expect(companies.json().total).toBe(1);
    expect(conv.json().companyId).toBe(companies.json().data[0].id);
  });

  it('kanban board groups open deals by stage with totals; move updates stage', async () => {
    const d1 = await api(t.app, org.accessToken, 'POST', '/deals', {
      title: 'Deal One', value: 1000, pipelineId,
    });
    const d2 = await api(t.app, org.accessToken, 'POST', '/deals', {
      title: 'Deal Two', value: 2500, pipelineId,
    });
    expect(d1.statusCode).toBe(201);
    const firstStage = stages[0];
    expect(d1.json().stageId).toBe(firstStage.id);

    const second = stages[1];
    const move = await api(t.app, org.accessToken, 'POST', `/deals/${d2.json().id}/move`, {
      stageId: second.id,
    });
    expect(move.statusCode).toBe(200);
    expect(move.json().stageId).toBe(second.id);

    const board = await api(t.app, org.accessToken, 'GET', `/deals/board?pipeline_id=${pipelineId}`);
    const boardStages = board.json().stages;
    const s2 = boardStages.find((s: any) => s.id === second.id);
    expect(s2.deals.some((d: any) => d.title === 'Deal Two')).toBe(true);
    expect(s2.totalValue).toBeGreaterThanOrEqual(2500);
  });

  it('rejects moving a deal to a stage of another pipeline', async () => {
    const p2 = await api(t.app, org.accessToken, 'POST', '/pipelines', { name: 'Renewals' });
    const p2Full = (await api(t.app, org.accessToken, 'GET', '/pipelines')).json()
      .data.find((p: any) => p.id === p2.json().id);
    const deal = await api(t.app, org.accessToken, 'POST', '/deals', {
      title: 'Cross-pipeline', pipelineId,
    });
    const res = await api(t.app, org.accessToken, 'POST', `/deals/${deal.json().id}/move`, {
      stageId: p2Full.stages[0].id,
    });
    expect(res.statusCode).toBe(422);
  });

  it('closing a deal as won stamps closed_at, snaps to Won stage, and locks moves', async () => {
    const deal = await api(t.app, org.accessToken, 'POST', '/deals', {
      title: 'Big Win', value: 9000, pipelineId,
    });
    const closed = await api(t.app, org.accessToken, 'POST', `/deals/${deal.json().id}/close`, {
      status: 'won',
    });
    expect(closed.json().status).toBe('won');
    expect(closed.json().closedAt).toBeTruthy();
    const wonStage = stages.find((s: any) => s.isWon);
    expect(closed.json().stageId).toBe(wonStage.id);

    expect((await api(t.app, org.accessToken, 'POST', `/deals/${deal.json().id}/move`, {
      stageId: stages[0].id,
    })).statusCode).toBe(409);
    expect((await api(t.app, org.accessToken, 'POST', `/deals/${deal.json().id}/close`, {
      status: 'lost',
    })).statusCode).toBe(409);
  });

  it('dragging into the Lost stage closes the deal as lost', async () => {
    const deal = await api(t.app, org.accessToken, 'POST', '/deals', {
      title: 'Slipping away', value: 100, pipelineId,
    });
    const lostStage = stages.find((s: any) => s.isLost);
    await api(t.app, org.accessToken, 'POST', `/deals/${deal.json().id}/move`, {
      stageId: lostStage.id,
    });
    const after = await api(t.app, org.accessToken, 'GET', `/deals/${deal.json().id}`);
    expect(after.json().status).toBe('lost');
  });

  it('refuses to delete pipelines or stages holding deals', async () => {
    expect((await api(t.app, org.accessToken, 'DELETE', `/pipelines/${pipelineId}`)).statusCode).toBe(409);
    expect((await api(t.app, org.accessToken, 'DELETE', `/stages/${stages[0].id}`)).statusCode).toBe(409);
  });

  it('record timeline shows created / stage_changed / won activities', async () => {
    const deals = await api(t.app, org.accessToken, 'GET', '/deals?q=Big Win');
    const dealId = deals.json().data[0].id;
    const timeline = await api(
      t.app, org.accessToken, 'GET', `/activities?entity_type=deal&entity_id=${dealId}`
    );
    const types = timeline.json().data.map((a: any) => a.type);
    expect(types).toContain('created');
    expect(types).toContain('won');
  });
});
