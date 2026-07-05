/**
 * Machine-readable API description served at /api/openapi.json.
 * Deliberately compact: enumerates every route with summaries and the shared
 * conventions; full request/response field tables live in docs/02-architecture/api-spec.md.
 */
const bearer = [{ bearerAuth: [] as string[] }];

function op(summary: string, opts: { public?: boolean; tag?: string } = {}) {
  return {
    summary,
    tags: [opts.tag ?? 'CRM'],
    ...(opts.public ? {} : { security: bearer }),
    responses: { '200': { description: 'Success' } },
  };
}

export const openapiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'NimbusCRM API',
    version: '1.0.0',
    description:
      'REST API for NimbusCRM. Auth: Bearer access token from /auth/login. ' +
      'Lists paginate with ?page&limit (max 100) and return {data, page, limit, total}. ' +
      'Errors return {error: {code, message, details?}}.',
  },
  servers: [{ url: '/api/v1' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
  },
  paths: {
    '/auth/register': { post: op('Create organization + admin user', { public: true, tag: 'Auth' }) },
    '/auth/login': { post: op('Login with email/password', { public: true, tag: 'Auth' }) },
    '/auth/refresh': { post: op('Rotate refresh token', { public: true, tag: 'Auth' }) },
    '/auth/logout': { post: op('Revoke refresh token', { tag: 'Auth' }) },
    '/auth/me': { get: op('Current user + org', { tag: 'Auth' }), patch: op('Update own profile/password', { tag: 'Auth' }) },
    '/users': { get: op('List team members', { tag: 'Users' }), post: op('Create user (admin)', { tag: 'Users' }) },
    '/users/{id}': { patch: op('Update user (admin)', { tag: 'Users' }), delete: op('Deactivate user (admin)', { tag: 'Users' }) },
    '/contacts': { get: op('List contacts'), post: op('Create contact') },
    '/contacts/{id}': { get: op('Get contact'), patch: op('Update contact'), delete: op('Delete contact') },
    '/contacts/import': { post: op('Import contacts from CSV (multipart)') },
    '/contacts/export': { get: op('Export contacts as CSV') },
    '/companies': { get: op('List companies'), post: op('Create company') },
    '/companies/{id}': { get: op('Get company'), patch: op('Update company'), delete: op('Delete company') },
    '/companies/export': { get: op('Export companies as CSV') },
    '/leads': { get: op('List leads'), post: op('Create lead') },
    '/leads/{id}': { get: op('Get lead'), patch: op('Update lead'), delete: op('Delete lead') },
    '/leads/{id}/convert': { post: op('Convert lead → contact (+company, +deal), atomic') },
    '/pipelines': { get: op('List pipelines with stages'), post: op('Create pipeline (admin/manager)') },
    '/pipelines/{id}': { patch: op('Update pipeline'), delete: op('Delete pipeline (409 if it has deals)') },
    '/pipelines/{id}/stages': { post: op('Add stage') },
    '/stages/{id}': { patch: op('Update stage'), delete: op('Delete stage (409 if it has deals)') },
    '/deals': { get: op('List deals'), post: op('Create deal') },
    '/deals/board': { get: op('Kanban board for a pipeline (?pipeline_id=)') },
    '/deals/{id}': { get: op('Get deal'), patch: op('Update deal'), delete: op('Delete deal') },
    '/deals/{id}/move': { post: op('Move deal to another stage {stageId}') },
    '/deals/{id}/close': { post: op('Close deal {status: won|lost, reason?}') },
    '/deals/export': { get: op('Export deals as CSV') },
    '/tasks': { get: op('List tasks (?assignee_id&status&due=overdue|today|week)'), post: op('Create task') },
    '/tasks/{id}': { get: op('Get task'), patch: op('Update task'), delete: op('Delete task') },
    '/tasks/{id}/complete': { post: op('Complete task') },
    '/notes': { get: op('List notes for a record (?related_type&related_id)'), post: op('Create note') },
    '/notes/{id}': { patch: op('Edit note'), delete: op('Delete note') },
    '/files': { get: op('List files for a record'), post: op('Upload file (multipart)') },
    '/files/{id}/download': { get: op('Download file') },
    '/files/{id}': { delete: op('Delete file') },
    '/activities': { get: op('Timeline for a record or org-wide feed') },
    '/audit-logs': { get: op('Audit log (admin)') },
    '/custom-fields': { get: op('List custom field definitions'), post: op('Create custom field (admin)') },
    '/custom-fields/{id}': { patch: op('Update custom field (admin)'), delete: op('Delete custom field (admin)') },
    '/workflows': { get: op('List workflows'), post: op('Create workflow (admin/manager)') },
    '/workflows/{id}': { patch: op('Update workflow'), delete: op('Delete workflow') },
    '/workflows/{id}/runs': { get: op('Workflow execution log') },
    '/notifications': { get: op('My notifications (?unread=1)') },
    '/notifications/read': { post: op('Mark notifications read {ids?}') },
    '/search': { get: op('Global search (?q=)') },
    '/reports/overview': { get: op('Dashboard KPIs', { tag: 'Reports' }) },
    '/reports/pipeline': { get: op('Funnel by stage', { tag: 'Reports' }) },
    '/reports/revenue': { get: op('Won revenue by month', { tag: 'Reports' }) },
    '/reports/lead-sources': { get: op('Lead sources + conversion', { tag: 'Reports' }) },
    '/reports/leaderboard': { get: op('Per-owner performance', { tag: 'Reports' }) },
  },
} as const;
