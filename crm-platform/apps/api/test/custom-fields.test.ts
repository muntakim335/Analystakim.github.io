import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, registerOrg, api, type TestApp } from './helpers.js';

describe('custom fields', () => {
  let t: TestApp;
  let org: Awaited<ReturnType<typeof registerOrg>>;

  beforeAll(async () => {
    t = await createTestApp();
    org = await registerOrg(t.app);
    for (const field of [
      { entityType: 'contact', key: 'region', label: 'Region', fieldType: 'select', options: ['EMEA', 'APAC', 'AMER'] },
      { entityType: 'contact', key: 'seats', label: 'Seats', fieldType: 'number' },
      { entityType: 'deal', key: 'competitor', label: 'Competitor', fieldType: 'text' },
    ]) {
      const res = await api(t.app, org.accessToken, 'POST', '/custom-fields', field);
      expect(res.statusCode).toBe(201);
    }
  });
  afterAll(async () => t.close());

  it('accepts valid custom values and returns them on the record', async () => {
    const res = await api(t.app, org.accessToken, 'POST', '/contacts', {
      firstName: 'Custom', custom: { region: 'EMEA', seats: 40 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().custom).toEqual({ region: 'EMEA', seats: 40 });
  });

  it('rejects unknown keys, wrong types, and invalid select options', async () => {
    expect((await api(t.app, org.accessToken, 'POST', '/contacts', {
      firstName: 'X', custom: { nope: 1 },
    })).statusCode).toBe(422);
    expect((await api(t.app, org.accessToken, 'POST', '/contacts', {
      firstName: 'X', custom: { seats: 'many' },
    })).statusCode).toBe(422);
    expect((await api(t.app, org.accessToken, 'POST', '/contacts', {
      firstName: 'X', custom: { region: 'MOON' },
    })).statusCode).toBe(422);
  });

  it('merges custom values on PATCH instead of replacing', async () => {
    const created = await api(t.app, org.accessToken, 'POST', '/contacts', {
      firstName: 'Merge', custom: { region: 'APAC', seats: 5 },
    });
    const patched = await api(t.app, org.accessToken, 'PATCH', `/contacts/${created.json().id}`, {
      custom: { seats: 6 },
    });
    expect(patched.json().custom).toEqual({ region: 'APAC', seats: 6 });
  });

  it('enforces duplicate keys and select options at definition time', async () => {
    expect((await api(t.app, org.accessToken, 'POST', '/custom-fields', {
      entityType: 'contact', key: 'region', label: 'Again', fieldType: 'text',
    })).statusCode).toBe(409);
    expect((await api(t.app, org.accessToken, 'POST', '/custom-fields', {
      entityType: 'contact', key: 'empty_select', label: 'E', fieldType: 'select', options: [],
    })).statusCode).toBe(409);
    expect((await api(t.app, org.accessToken, 'POST', '/custom-fields', {
      entityType: 'contact', key: 'Bad Key!', label: 'B', fieldType: 'text',
    })).statusCode).toBe(422);
  });

  it('custom field definitions are org-scoped', async () => {
    const other = await registerOrg(t.app);
    const res = await api(t.app, other.accessToken, 'POST', '/contacts', {
      firstName: 'Other', custom: { region: 'EMEA' },
    });
    expect(res.statusCode).toBe(422); // no such field in this org
    const defs = await api(t.app, other.accessToken, 'GET', '/custom-fields');
    expect(defs.json().data).toHaveLength(0);
  });

  it('works on deals too', async () => {
    const pipelines = await api(t.app, org.accessToken, 'GET', '/pipelines');
    const deal = await api(t.app, org.accessToken, 'POST', '/deals', {
      title: 'With custom', pipelineId: pipelines.json().data[0].id,
      custom: { competitor: 'BigCorp' },
    });
    expect(deal.statusCode).toBe(201);
    expect(deal.json().custom.competitor).toBe('BigCorp');
  });
});
