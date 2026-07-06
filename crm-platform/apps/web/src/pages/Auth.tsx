import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { Button, Card, ErrorText, Field, Input } from '../components/ui';

function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--series-1)] text-lg font-bold text-white">
            N
          </span>
          <span className="text-xl font-semibold">NimbusCRM</span>
        </div>
        <Card className="p-6">
          <h1 className="mb-4 text-lg font-semibold">{title}</h1>
          {children}
        </Card>
      </div>
    </div>
  );
}

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Sign in">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="Password">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" disabled={busy} className="w-full justify-center">
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-[var(--ink-muted)]">
        New here?{' '}
        <Link to="/register" className="text-[var(--series-1)] hover:underline">
          Create your organization
        </Link>
      </p>
    </AuthShell>
  );
}

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ orgName: '', name: '', email: '', password: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(form.orgName, form.name, form.email, form.password);
      navigate('/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <AuthShell title="Create your organization">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Organization name">
          <Input value={form.orgName} onChange={set('orgName')} required autoFocus placeholder="Acme Inc." />
        </Field>
        <Field label="Your name">
          <Input value={form.name} onChange={set('name')} required />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={set('email')} required />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            value={form.password}
            onChange={set('password')}
            required
            minLength={8}
            placeholder="At least 8 characters"
          />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" disabled={busy} className="w-full justify-center">
          {busy ? 'Creating…' : 'Create organization'}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-[var(--ink-muted)]">
        Already have an account?{' '}
        <Link to="/login" className="text-[var(--series-1)] hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
