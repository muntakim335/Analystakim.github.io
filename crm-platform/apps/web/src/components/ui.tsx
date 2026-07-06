import { useEffect, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const styles = {
    primary:
      'bg-[var(--series-1)] text-white hover:opacity-90 disabled:opacity-50',
    ghost:
      'border border-[var(--grid)] bg-transparent hover:bg-black/5 dark:hover:bg-white/5',
    danger:
      'bg-[var(--status-critical)] text-white hover:opacity-90',
  }[variant];
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--series-1)] disabled:cursor-not-allowed ${styles} ${className}`}
      {...props}
    />
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-md border border-[var(--grid)] bg-[var(--surface-1)] px-3 py-1.5 text-sm text-[var(--ink-1)] placeholder-[var(--ink-muted)] focus:border-[var(--series-1)] focus:outline-none ${props.className ?? ''}`}
    />
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-md border border-[var(--grid)] bg-[var(--surface-1)] px-3 py-1.5 text-sm text-[var(--ink-1)] placeholder-[var(--ink-muted)] focus:border-[var(--series-1)] focus:outline-none ${props.className ?? ''}`}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-md border border-[var(--grid)] bg-[var(--surface-1)] px-3 py-1.5 text-sm text-[var(--ink-1)] focus:border-[var(--series-1)] focus:outline-none ${props.className ?? ''}`}
    />
  );
}

export function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-[var(--ink-2)]">
        {label}
        {required && <span className="text-[var(--status-critical)]"> *</span>}
      </span>
      {children}
    </label>
  );
}

const badgeColors: Record<string, string> = {
  new: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  contacted: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  qualified: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  unqualified: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200',
  converted: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
  open: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  won: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  lost: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  done: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  high: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  low: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200',
  admin: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
  manager: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  member: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200',
};

export function Badge({ value }: { value: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${badgeColors[value] ?? 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200'}`}
    >
      {value}
    </span>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[8vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[80vh] overflow-y-auto rounded-xl border border-[var(--grid)] bg-[var(--surface-1)] p-5 shadow-xl`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center p-8" role="status" aria-label="Loading">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--grid)] border-t-[var(--series-1)]" />
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--grid)] p-10 text-center">
      <p className="font-medium">{title}</p>
      {hint && <p className="max-w-sm text-sm text-[var(--ink-muted)]">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Something went wrong';
  return <p className="mt-2 text-sm text-[var(--status-critical)]" role="alert">{message}</p>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-[var(--grid)] bg-[var(--surface-1)] ${className}`}>
      {children}
    </div>
  );
}
