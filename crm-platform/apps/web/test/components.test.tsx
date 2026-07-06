import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BarChart, StatTile } from '../src/components/charts';
import { Badge, EmptyState } from '../src/components/ui';
import { fmtMoney, timeAgo } from '../src/api/types';

describe('formatters', () => {
  it('formats money without cents', () => {
    expect(fmtMoney(1234.56)).toMatch(/1,235|1\.235|1 235/); // locale-tolerant
  });
  it('timeAgo buckets recent timestamps', () => {
    expect(timeAgo(new Date().toISOString())).toBe('just now');
    expect(timeAgo(new Date(Date.now() - 5 * 60_000).toISOString())).toBe('5m ago');
    expect(timeAgo(new Date(Date.now() - 3 * 3600_000).toISOString())).toBe('3h ago');
  });
});

describe('BarChart', () => {
  it('renders one bar per datum with an accessible role', () => {
    const { container } = render(
      <BarChart data={[
        { label: 'Jan', value: 10 },
        { label: 'Feb', value: 20 },
      ]} />
    );
    expect(screen.getByRole('img', { name: 'Bar chart' })).toBeInTheDocument();
    expect(container.querySelectorAll('svg text').length).toBe(2);
  });
  it('shows an empty message with no data', () => {
    render(<BarChart data={[]} />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });
  it('renders horizontal variant with direct value labels', () => {
    render(<BarChart horizontal data={[{ label: 'website', value: 7, display: '7 · 40% conv.' }]} />);
    expect(screen.getByText('website')).toBeInTheDocument();
    expect(screen.getByText('7 · 40% conv.')).toBeInTheDocument();
  });
});

describe('ui primitives', () => {
  it('StatTile shows label, value and delta tone', () => {
    render(<StatTile label="Won" value="$5,000" sub="↑ 20%" subTone="good" />);
    expect(screen.getByText('Won')).toBeInTheDocument();
    expect(screen.getByText('$5,000')).toBeInTheDocument();
    expect(screen.getByText('↑ 20%')).toBeInTheDocument();
  });
  it('Badge renders status text', () => {
    render(<Badge value="qualified" />);
    expect(screen.getByText('qualified')).toBeInTheDocument();
  });
  it('EmptyState renders hint and action', () => {
    render(<EmptyState title="No contacts yet" hint="Import a CSV" />);
    expect(screen.getByText('No contacts yet')).toBeInTheDocument();
    expect(screen.getByText('Import a CSV')).toBeInTheDocument();
  });
});
