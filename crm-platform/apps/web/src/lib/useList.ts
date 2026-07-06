import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { get } from '../api/client';
import type { Paginated } from '../api/types';

/** Shared list-page state: search, sort, pagination → one server query. */
export function useList<T>(resource: string, extraParams: Record<string, string | undefined> = {}) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('created_at');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');

  const params = new URLSearchParams({ page: String(page), limit: '25', sort, order });
  if (q.trim()) params.set('q', q.trim());
  for (const [k, v] of Object.entries(extraParams)) if (v) params.set(k, v);
  const queryString = params.toString();

  const query = useQuery({
    queryKey: [resource, queryString],
    queryFn: () => get<Paginated<T>>(`/${resource}?${queryString}`),
    placeholderData: keepPreviousData,
  });

  const onSort = (key: string) => {
    if (sort === key) setOrder(order === 'asc' ? 'desc' : 'asc');
    else {
      setSort(key);
      setOrder('asc');
    }
    setPage(1);
  };
  const onSearch = (value: string) => {
    setQ(value);
    setPage(1);
  };

  return { query, page, setPage, q, onSearch, sort, order, onSort };
}
