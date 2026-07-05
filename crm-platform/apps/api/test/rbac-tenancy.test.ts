import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, registerOrg, api, type TestApp } from './helpers.js';

describe('multi-tenancy isolation & RBAC', () => {
  let t: TestApp;
  let orgA: Awaited<ReturnType<typeof registerOrg>>;
  let orgB: Awaited<ReturnType<typeof registerOrg>>;
  let contactA: string;

  beforeAll(async () => {
    t = await createTestApp();
    orgA = await registerOrg(t.app);
    orgB = await registerOrg(t.app);
    const res = await api(t.app, orgA.accessToken, 'POST', '/contacts', {
      firstName: 'Alice', lastName: 'Anderson', email: 'alice@a.com',
    });
    contactA = res.json().id;
  });
  afterAll(async () => t.close());

  it('org B cannot read org A records (404, no existence leak)', async () => {
    const res = await api(t.app, orgB.accessToken, 'GET', `/contacts/${contactA}`);
    expect(res.statusCode).toBe(404);
  });

  it('org B cannot update or delete org A records', async () => {
    const patch = await api(t.app, orgB.accessToken, 'PATCH', `/contacts/${contactA}`, {
      firstName: 'Hacked',
    });
    expect(patch.statusCode).toBe(404);
    const del = await api(t.app, orgB.accessToken, 'DELETE', `/contacts/${contactA}`);
    expect(del.statusCode).toBe(404);

    const still = await api(t.app, orgA.accessToken, 'GET', `/contacts/${contactA}`);
    expect(still.json().firstName).toBe('Alice');
  });

  it('org B lists never contain org A data', async () => {
    const res = await api(t.app, orgB.accessToken, 'GET', '/contacts');
    expect(res.json().total).toBe(0);
  });

  it('members cannot manage users, custom fields, or workflows', async () => {
    const member = await api(t.app, orgA.accessToken, 'POST', '/users', {
      name: 'Member', email: `member-${Date.now()}@a.com`, password: 'password123', role: 'member',
    });
    expect(member.statusCode).toBe(201);
    const login = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: member.json().email, password: 'password123' },
    });
    const memberToken = login.json().accessToken;

    expect((await api(t.app, memberToken, 'POST', '/users', {
      name: 'X', email: 'x@a.com', password: 'password123',
    })).statusCode).toBe(403);
    expect((await api(t.app, memberToken, 'POST', '/custom-fields', {
      entityType: 'contact', key: 'x', label: 'X', fieldType: 'text',
    })).statusCode).toBe(403);
    expect((await api(t.app, memberToken, 'POST', '/workflows', {
      name: 'X', triggerType: 'lead.created', actions: [{ type: 'notify', target: 'owner', message: 'hi' }],
    })).statusCode).toBe(403);
    expect((await api(t.app, memberToken, 'GET', '/audit-logs')).statusCode).toBe(403);
  });

  it('member cannot delete a contact they do not own; manager can', async () => {
    const memberRes = await api(t.app, orgA.accessToken, 'POST', '/users', {
      name: 'M2', email: `m2-${Date.now()}@a.com`, password: 'password123', role: 'member',
    });
    const managerRes = await api(t.app, orgA.accessToken, 'POST', '/users', {
      name: 'Mgr', email: `mgr-${Date.now()}@a.com`, password: 'password123', role: 'manager',
    });
    const memberToken = (await t.app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { email: memberRes.json().email, password: 'password123' },
    })).json().accessToken;
    const managerToken = (await t.app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { email: managerRes.json().email, password: 'password123' },
    })).json().accessToken;

    const del = await api(t.app, memberToken, 'DELETE', `/contacts/${contactA}`);
    expect(del.statusCode).toBe(403);

    const managerDel = await api(t.app, managerToken, 'DELETE', `/contacts/${contactA}`);
    expect(managerDel.statusCode).toBe(200);
  });

  it('cannot demote or deactivate the last admin', async () => {
    const solo = await registerOrg(t.app);
    const demote = await api(t.app, solo.accessToken, 'PATCH', `/users/${solo.user.id}`, {
      role: 'member',
    });
    expect(demote.statusCode).toBe(409);
    const deactivate = await api(t.app, solo.accessToken, 'DELETE', `/users/${solo.user.id}`);
    expect(deactivate.statusCode).toBe(409);
  });

  it('deactivated users cannot use /auth/me and cannot log in', async () => {
    const userRes = await api(t.app, orgA.accessToken, 'POST', '/users', {
      name: 'Gone', email: `gone-${Date.now()}@a.com`, password: 'password123', role: 'member',
    });
    const token = (await t.app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { email: userRes.json().email, password: 'password123' },
    })).json().accessToken;

    await api(t.app, orgA.accessToken, 'DELETE', `/users/${userRes.json().id}`);

    expect((await api(t.app, token, 'GET', '/auth/me')).statusCode).toBe(401);
    const login = await t.app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { email: userRes.json().email, password: 'password123' },
    });
    expect(login.statusCode).toBe(401);
  });

  it('audit log records mutations with actor and changes (admin only)', async () => {
    const res = await api(t.app, orgA.accessToken, 'GET', '/audit-logs?entity_type=contact');
    expect(res.statusCode).toBe(200);
    const actions = res.json().data.map((l: any) => l.action);
    expect(actions).toContain('contact.created');
    expect(actions).toContain('contact.deleted');
  });
});
