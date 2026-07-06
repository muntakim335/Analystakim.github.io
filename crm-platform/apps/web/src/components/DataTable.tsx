import { type ReactNode } from 'react';
import { Button, Spinner, EmptyState } from './ui';
import type { Paginated } from '../api/types';

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render: (row: T) => ReactNode;
}

interface Props<T> {
  columns: Column<T>[];
  result: Paginated<T> | undefined;
  loading: boolean;
  sort: string;
  order: 'asc' | 'desc';
  onSort(key: string): void;
  page: number;
  onPage(page: number): void;
  onRowClick?(row: T): void;
  empty: { title: string; hint?: string; action?: ReactNode };
}

/** Server-driven table: sorting, pagination and row actions share one shell. */
export function DataTable<T extends { id: string }>(props: Props<T>) {
  const { columns, result, loading, sort, order, onSort, page, onPage, onRowClick, empty } = props;
  if (loading && !result) return <Spinner />;
  if (result && result.total === 0 && page === 1) return <EmptyState {...empty} />;
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.limit)) : 1;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--grid)] bg-[var(--surface-1)]">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--grid)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
              {columns.map((c) => (
                <th key={c.key} className="px-4 py-2.5 font-medium">
                  {c.sortable ? (
                    <button
                      className="inline-flex items-center gap-1 hover:text-[var(--ink-1)]"
                      onClick={() => onSort(c.key)}
                    >
                      {c.header}
                      {sort === c.key && <span aria-hidden>{order === 'asc' ? '↑' : '↓'}</span>}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result?.data.map((row) => (
              <tr
                key={row.id}
                className={`border-b border-[var(--grid)] last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-black/[.03] dark:hover:bg-white/[.04]' : ''}`}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((c) => (
                  <td key={c.key} className="px-4 py-2.5">
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-[var(--grid)] px-4 py-2 text-sm text-[var(--ink-muted)]">
        <span>
          {result?.total ?? 0} result{(result?.total ?? 0) === 1 ? '' : 's'}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            ← Prev
          </Button>
          <span className="tabular-nums">
            {page} / {totalPages}
          </span>
          <Button variant="ghost" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
            Next →
          </Button>
        </div>
      </div>
    </div>
  );
}
