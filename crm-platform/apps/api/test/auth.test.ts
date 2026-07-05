import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, registerOrg, api, type TestApp } from './helpers.js';

describe('auth & session', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  it('registers an org with admin user and seeded pipeline', async () => {
    const org = await registerOrg(t.app);
    expect(org.user.role).toBe('admin');

    const me = await api(t.app, org.accessToken, 'GET', '/auth/me');
    expect(me.statusCode).toBe(200);
    expect(me.json().org.name).toBe(org.orgName);

    const pipelines = await api(t.app, org.accessToken, 'GET', '/pipelines');
    const list = pipelines.json().data;
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Sales');
    expect(list[0].stages.length).toBe(6);
    expect(list[0].stages.some((s: any) => s.isWon)).toBe(true);
  });

  it('rejects duplicate email registration', async () => {
    const org = await registerOrg(t.app);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { orgName: 'X', name: 'Y', email: org.email, password: 'password123' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('logs in with valid credentials and rejects bad ones', async () => {
    const org = await registerOrg(t.app);
    const ok = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: org.email, password: org.password },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().accessToken).toBeTruthy();

    const bad = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: org.email, password: 'wrong-password' },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('rotates refresh tokens: old token is single-use', async () => {
    const org = await registerOrg(t.app);
    const first = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: org.refreshToken },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().refreshToken).not.toBe(org.refreshToken);

    const replay = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: org.refreshToken },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('logout revokes the refresh token', async () => {
    const org = await registerOrg(t.app);
    await api(t.app, org.accessToken, 'POST', '/auth/logout', { refreshToken: org.refreshToken });
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: org.refreshToken },
    });
    expect(res.statusCode).toBe(401);
  });

  it('requires auth on protected routes', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/contacts' });
    expect(res.statusCode).toBe(401);
  });

  it('change password revokes other sessions and old password stops working', async () => {
    const org = await registerOrg(t.app);
    const res = await api(t.app, org.accessToken, 'PATCH', '/auth/me', {
      currentPassword: org.password,
      newPassword: 'new-password-456',
    });
    expect(res.statusCode).toBe(200);

    const oldLogin = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: org.email, password: org.password },
    });
    expect(oldLogin.statusCode).toBe(401);

    const refresh = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: org.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);
  });
});
