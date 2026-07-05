import { z } from 'zod';
import type { Queryable } from '../db/db.js';

export const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  q: z.string().trim().max(200).optional(),
});
export type ListParams = z.infer<typeof ListQuery>;

export interface ListSpec {
  table: string;
  /** SELECT clause (may join); must expose the table's columns. */
  select: string;
  /** Columns matched against ?q= with ILIKE. Must be trusted identifiers. */
  searchColumns: string[];
  /** Whitelist: query `sort` values → SQL column. */
  sortable: Record<string, string>;
  defaultSort: string;
  /** Extra equality filters: column → value (skipped when value is undefined). */
  filters?: Record<string, unknown>;
  /** Extra raw WHERE fragments with their params (e.g. custom conditions). */
  where?: { sql: string; params: unknown[] }[];
}

/** Builds and runs an org-scoped, paginated, filtered list query. */
export async function runList(
  q: Queryable,
  orgId: string,
  spec: ListSpec,
  params: ListParams
): Promise<{ data: any[]; page: number; limit: number; total: number }> {
  const conditions: string[] = [`t.org_id = $1`];
  const values: unknown[] = [orgId];

  for (const [column, value] of Object.entries(spec.filters ?? {})) {
    if (value === undefined || value === '') continue;
    values.push(value);
    conditions.push(`t.${column} = $${values.length}`);
  }
  for (const extra of spec.where ?? []) {
    let sql = extra.sql;
    for (const p of extra.params) {
      values.push(p);
      sql = sql.replace('?', `$${values.length}`);
    }
    conditions.push(sql);
  }
  if (params.q && spec.searchColumns.length > 0) {
    values.push(`%${params.q}%`);
    const idx = values.length;
    conditions.push(`(${spec.searchColumns.map((c) => `${c} ILIKE $${idx}`).join(' OR ')})`);
  }

  const whereSql = conditions.join(' AND ');
  const sortCol = spec.sortable[params.sort ?? ''] ?? spec.defaultSort;
  const orderSql = params.order === 'asc' ? 'ASC' : 'DESC';
  const offset = (params.page - 1) * params.limit;

  const [countRes, dataRes] = [
    await q.query(`SELECT count(*)::int AS n FROM ${spec.table} t WHERE ${whereSql}`, values),
    await q.query(
      `${spec.select} WHERE ${whereSql} ORDER BY ${sortCol} ${orderSql} NULLS LAST LIMIT ${params.limit} OFFSET ${offset}`,
      values
    ),
  ];

  return { data: dataRes.rows, page: params.page, limit: params.limit, total: countRes.rows[0].n };
}
