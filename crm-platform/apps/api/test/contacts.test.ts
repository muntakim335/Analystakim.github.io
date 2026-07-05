import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, registerOrg, api, auth, type TestApp } from './helpers.js';

describe('contacts CRUD, listing, CSV', () => {
  let t: TestApp;
  let org: Awaited<ReturnType<typeof registerOrg>>;

  beforeAll(async () => {
    t = await createTestApp();
    org = await registerOrg(t.app);
  });
  afterAll(async () => t.close());

  it('creates, reads, updates and deletes a contact', async () => {
    const created = await api(t.app, org.accessToken, 'POST', '/contacts', {
      firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phone: '+1 555 0100', title: 'CTO',
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect(created.json().ownerId).toBe(org.user.id);

    const updated = await api(t.app, org.accessToken, 'PATCH', `/contacts/${id}`, {
      title: 'CEO', phone: null,
    });
    expect(updated.json().title).toBe('CEO');
    expect(updated.json().phone).toBeNull();
    expect(updated.json().firstName).toBe('Jane');

    const del = await api(t.app, org.accessToken, 'DELETE', `/contacts/${id}`);
    expect(del.statusCode).toBe(200);
    expect((await api(t.app, org.accessToken, 'GET', `/contacts/${id}`)).statusCode).toBe(404);
  });

  it('links contacts to companies and rejects foreign company ids', async () => {
    const company = await api(t.app, org.accessToken, 'POST', '/companies', {
      name: 'Globex', industry: 'Manufacturing',
    });
    const contact = await api(t.app, org.accessToken, 'POST', '/contacts', {
      firstName: 'Hank', companyId: company.json().id,
    });
    expect(contact.json().companyName).toBe('Globex');

    const other = await registerOrg(t.app);
    const foreign = await api(t.app, other.accessToken, 'POST', '/contacts', {
      firstName: 'Evil', companyId: company.json().id,
    });
    expect(foreign.statusCode).toBe(422);
  });

  it('paginates, searches and sorts lists', async () => {
    for (let i = 0; i < 30; i++) {
      await api(t.app, org.accessToken, 'POST', '/contacts', {
        firstName: `Bulk${i}`, lastName: 'Person', email: `bulk${i}@x.com`,
      });
    }
    const page2 = await api(t.app, org.accessToken, 'GET', '/contacts?page=2&limit=10');
    expect(page2.json().data).toHaveLength(10);
    expect(page2.json().total).toBeGreaterThanOrEqual(30);

    const search = await api(t.app, org.accessToken, 'GET', '/contacts?q=bulk1');
    expect(search.json().data.every((c: any) => c.firstName.toLowerCase().includes('bulk1'))).toBe(true);

    const sorted = await api(t.app, org.accessToken, 'GET', '/contacts?sort=name&order=asc&limit=5');
    expect(sorted.statusCode).toBe(200);
  });

  it('rejects invalid payloads with 422 and details', async () => {
    const res = await api(t.app, org.accessToken, 'POST', '/contacts', {
      firstName: '', email: 'not-an-email',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION');
    expect(res.json().error.details.length).toBeGreaterThan(0);
  });

  it('imports contacts from CSV with dedupe and error reporting', async () => {
    const csv = [
      'First Name,Last Name,Email,Phone',
      'Ada,Lovelace,ada@csv.com,+44 1',
      'Alan,Turing,alan@csv.com,+44 2',
      'Ada,Duplicate,ada@csv.com,+44 3',
      ',NoFirst,missing@csv.com,+44 4',
    ].join('\n');
    const boundary = 'X-BOUNDARY';
    const body =
      `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="import.csv"\r\n` +
      `content-type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`;
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/contacts/import',
      headers: { ...auth(org.accessToken), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const result = res.json();
    expect(result.created).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.errors).toHaveLength(1);
  });

  it('exports contacts as CSV', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/contacts/export',
      headers: auth(org.accessToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('ada@csv.com');
  });
});
