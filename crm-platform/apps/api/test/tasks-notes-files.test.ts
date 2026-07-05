import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, registerOrg, api, auth, type TestApp } from './helpers.js';

describe('tasks, notes, files, notifications, search', () => {
  let t: TestApp;
  let org: Awaited<ReturnType<typeof registerOrg>>;
  let memberToken: string;
  let memberId: string;
  let contactId: string;

  beforeAll(async () => {
    t = await createTestApp();
    org = await registerOrg(t.app);
    const member = await api(t.app, org.accessToken, 'POST', '/users', {
      name: 'Rep', email: `rep-${Date.now()}@t.dev`, password: 'password123', role: 'member',
    });
    memberId = member.json().id;
    memberToken = (await t.app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { email: member.json().email, password: 'password123' },
    })).json().accessToken;
    contactId = (await api(t.app, org.accessToken, 'POST', '/contacts', {
      firstName: 'Task', lastName: 'Target', email: 'tt@t.dev',
    })).json().id;
  });
  afterAll(async () => t.close());

  it('assigning a task notifies the assignee; completing emits task.completed', async () => {
    const task = await api(t.app, org.accessToken, 'POST', '/tasks', {
      title: 'Call the target', assigneeId: memberId,
      relatedType: 'contact', relatedId: contactId,
      dueDate: new Date(Date.now() + 86400_000).toISOString(),
      priority: 'high',
    });
    expect(task.statusCode).toBe(201);

    const notif = await api(t.app, memberToken, 'GET', '/notifications?unread=1');
    expect(notif.json().unreadCount).toBeGreaterThanOrEqual(1);
    expect(notif.json().data[0].type).toBe('task_assigned');

    const done = await api(t.app, memberToken, 'POST', `/tasks/${task.json().id}/complete`);
    expect(done.json().status).toBe('done');
    expect(done.json().completedAt).toBeTruthy();
    expect((await api(t.app, memberToken, 'POST', `/tasks/${task.json().id}/complete`)).statusCode).toBe(409);

    // the contact timeline saw both task events
    const timeline = await api(
      t.app, org.accessToken, 'GET', `/activities?entity_type=contact&entity_id=${contactId}`
    );
    const types = timeline.json().data.map((a: any) => a.type);
    expect(types).toContain('task_created');
    expect(types).toContain('task_completed');
  });

  it('marking notifications read clears the badge', async () => {
    await api(t.app, memberToken, 'POST', '/notifications/read', {});
    const after = await api(t.app, memberToken, 'GET', '/notifications?unread=1');
    expect(after.json().unreadCount).toBe(0);
  });

  it('due=overdue filter finds overdue open tasks', async () => {
    await api(t.app, org.accessToken, 'POST', '/tasks', {
      title: 'Ancient task', dueDate: new Date(Date.now() - 3 * 86400_000).toISOString(),
    });
    const res = await api(t.app, org.accessToken, 'GET', '/tasks?due=overdue');
    expect(res.json().data.some((x: any) => x.title === 'Ancient task')).toBe(true);
  });

  it('notes: members can only edit/delete their own', async () => {
    const adminNote = await api(t.app, org.accessToken, 'POST', '/notes', {
      body: 'Admin note', relatedType: 'contact', relatedId: contactId,
    });
    const memberNote = await api(t.app, memberToken, 'POST', '/notes', {
      body: 'Member note', relatedType: 'contact', relatedId: contactId,
    });
    expect((await api(t.app, memberToken, 'PATCH', `/notes/${adminNote.json().id}`, {
      body: 'hijack',
    })).statusCode).toBe(403);
    expect((await api(t.app, memberToken, 'DELETE', `/notes/${adminNote.json().id}`)).statusCode).toBe(403);
    expect((await api(t.app, memberToken, 'PATCH', `/notes/${memberNote.json().id}`, {
      body: 'edited by author',
    })).statusCode).toBe(200);
    // admins can moderate anyone's notes
    expect((await api(t.app, org.accessToken, 'DELETE', `/notes/${memberNote.json().id}`)).statusCode).toBe(200);

    const list = await api(t.app, org.accessToken, 'GET', `/notes?related_type=contact&related_id=${contactId}`);
    expect(list.json().data).toHaveLength(1);
  });

  it('uploads, lists, downloads and deletes files; blocks disallowed types', async () => {
    const boundary = 'FILE-BOUNDARY';
    const mp = (filename: string, type: string, content: string) =>
      `--${boundary}\r\ncontent-disposition: form-data; name="relatedType"\r\n\r\ncontact\r\n` +
      `--${boundary}\r\ncontent-disposition: form-data; name="relatedId"\r\n\r\n${contactId}\r\n` +
      `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `content-type: ${type}\r\n\r\n${content}\r\n--${boundary}--\r\n`;

    const up = await t.app.inject({
      method: 'POST', url: '/api/v1/files',
      headers: { ...auth(org.accessToken), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: mp('proposal.pdf', 'application/pdf', 'PDFDATA'),
    });
    expect(up.statusCode).toBe(201);
    const fileId = up.json().id;

    const bad = await t.app.inject({
      method: 'POST', url: '/api/v1/files',
      headers: { ...auth(org.accessToken), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: mp('evil.exe', 'application/x-msdownload', 'MZ'),
    });
    expect(bad.statusCode).toBe(422);

    const list = await api(t.app, org.accessToken, 'GET', `/files?related_type=contact&related_id=${contactId}`);
    expect(list.json().data).toHaveLength(1);

    const dl = await t.app.inject({
      method: 'GET', url: `/api/v1/files/${fileId}/download`, headers: auth(org.accessToken),
    });
    expect(dl.statusCode).toBe(200);
    expect(dl.body).toBe('PDFDATA');

    // other org cannot see or download it
    const other = await registerOrg(t.app);
    expect((await t.app.inject({
      method: 'GET', url: `/api/v1/files/${fileId}/download`, headers: auth(other.accessToken),
    })).statusCode).toBe(404);

    expect((await api(t.app, org.accessToken, 'DELETE', `/files/${fileId}`)).statusCode).toBe(200);
  });

  it('global search returns grouped org-scoped results', async () => {
    await api(t.app, org.accessToken, 'POST', '/companies', { name: 'Searchable Corp' });
    await api(t.app, org.accessToken, 'POST', '/leads', { name: 'Searchable Lead' });
    const res = await api(t.app, org.accessToken, 'GET', '/search?q=Searchable');
    expect(res.json().companies).toHaveLength(1);
    expect(res.json().leads).toHaveLength(1);
    expect(res.json().contacts).toHaveLength(0);

    const other = await registerOrg(t.app);
    const foreign = await api(t.app, other.accessToken, 'GET', '/search?q=Searchable');
    expect(foreign.json().companies).toHaveLength(0);
  });
});
