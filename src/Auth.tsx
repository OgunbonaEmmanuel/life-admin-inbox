import { useState, type FormEvent } from 'react';
import { ArrowRight, Mail, ShieldCheck } from 'lucide-react';
import { auth } from './api';
import { Logo, PaperIllustration } from './components';
import type { AppConfig } from '../shared/types';
export default function Auth({ config, onDemo }: { config: AppConfig; onDemo: () => void }) {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset' | 'password'>(
    location.pathname === '/auth/reset' ? 'password' : 'login',
  );
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const client = auth();
      if (!client)
        throw new Error(
          'Account sign-in needs Supabase configuration. The local demo is separate from real authentication.',
        );
      if (mode === 'signup') {
        const { error } = await client.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${location.origin}/auth/callback` },
        });
        if (error) throw error;
        setMessage('Check your email to verify your account before signing in.');
      } else if (mode === 'reset') {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: `${location.origin}/auth/reset`,
        });
        if (error) throw error;
        setMessage('If an account exists, a password reset link is on its way.');
      } else if (mode === 'password') {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        location.assign('/');
      } else {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function google() {
    setMessage('');
    const client = auth();
    if (!client) {
      setMessage('Google sign-in needs Supabase and Google OAuth configuration.');
      return;
    }
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
    if (error) setMessage(error.message);
  }
  return (
    <div className="auth-page">
      <aside className="auth-story">
        <Logo />
        <div>
          <span className="eyebrow">MAKE ROOM FOR THE EVERYDAY</span>
          <h1>
            A little less admin.
            <br />
            <em>A little more life.</em>
          </h1>
          <p>Put the paperwork here. Take a clear plan with you.</p>
          <PaperIllustration />
        </div>
        <span className="privacy-line">
          <ShieldCheck size={17} /> Your documents. Your private space.
        </span>
      </aside>
      <main className="auth-form">
        <span className="eyebrow">LIFE ADMIN INBOX</span>
        <h2>
          {mode === 'signup'
            ? 'Make yourself at home'
            : mode === 'reset'
              ? 'Let’s get you back in'
              : mode === 'password'
                ? 'Choose a new password'
                : 'Welcome back'}
        </h2>
        <p>One calm place for everything you need to do.</p>
        <form onSubmit={submit}>
          {mode !== 'password' && (
            <label>
              Email address
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
          )}
          {mode !== 'reset' && (
            <label>
              Password
              <input
                type="password"
                required
                minLength={10}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          <button className="button primary" disabled={busy || !config.authConfigured}>
            {busy
              ? 'Just a moment…'
              : mode === 'signup'
                ? 'Create account'
                : mode === 'reset'
                  ? 'Send reset link'
                  : mode === 'password'
                    ? 'Save password'
                    : 'Sign in'}
            <ArrowRight size={17} />
          </button>
        </form>
        {!['reset', 'password'].includes(mode) && (
          <>
            <div className="or">or</div>
            <button className="button google" onClick={google} disabled={!config.authConfigured}>
              <span className="google-g">G</span> Continue with Google
            </button>
          </>
        )}
        {message && (
          <p role="status" className="inline-notice">
            {message}
          </p>
        )}
        {!config.authConfigured && (
          <p className="inline-notice">
            Account authentication is not configured. Email and Google sign-in require the owner’s
            Supabase setup.
          </p>
        )}
        <div className="auth-links">
          <button
            onClick={() => {
              setMode(mode === 'signup' ? 'login' : 'signup');
              setMessage('');
            }}
          >
            {mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'}
          </button>
          <button
            onClick={() => {
              setMode('reset');
              setMessage('');
            }}
          >
            Forgot password?
          </button>
        </div>
        {config.development && (
          <button className="button secondary" onClick={onDemo}>
            Explore local demo <ArrowRight size={16} />
          </button>
        )}
        <p className="fine-print">
          <Mail size={14} /> Real accounts require email verification.
        </p>
      </main>
    </div>
  );
}
