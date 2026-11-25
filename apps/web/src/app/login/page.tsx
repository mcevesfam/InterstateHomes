'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, Eye, EyeOff, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { InterstateLogo } from '@/components/InterstateLogo';
import { useRole } from '@/lib/role-context';

type LoginStep = 'credentials' | 'mfa';

interface LoginResponse {
  mfaRequired?: boolean;
  error?: string;
  message?: string;
  user?: {
    id?: string;
    userId?: string;
    email?: string;
    fullName?: string;
    role?: string;
  };
}

export default function LoginPage() {
  const router = useRouter();
  const { authMode, authenticated, loading, refreshSession } = useRole();

  const [step, setStep] = useState<LoginStep>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mfaInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!loading && authMode === 'postgres' && authenticated) {
      router.replace('/');
    }
  }, [loading, authMode, authenticated, router]);

  useEffect(() => {
    if (step === 'mfa') {
      mfaInputRef.current?.focus();
    }
  }, [step]);

  async function handleCredentialsSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Please enter your email address and password.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail, password }),
      });

      const data = (await res.json().catch(() => ({}))) as LoginResponse;

      if (!res.ok) {
        if (res.status === 423 || data.error === 'AccountLocked') {
          setError(
            data.message ??
              'This account has been locked after too many failed sign-in attempts. Contact an administrator.'
          );
        } else {
          setError(data.message ?? 'Invalid email address or password.');
        }
        return;
      }

      if (data.mfaRequired) {
        setPendingEmail(data.user?.email ?? trimmedEmail);
        setMfaCode('');
        setStep('mfa');
        return;
      }

      await refreshSession();
      router.replace('/');
    } catch {
      setError('Unable to reach the authentication service. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMfaSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const normalizedCode = mfaCode.replace(/\D/g, '');
    if (normalizedCode.length !== 6) {
      setError('Enter the 6-digit verification code from your authenticator app.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: normalizedCode, token: normalizedCode }),
      });

      const data = (await res.json().catch(() => ({}))) as LoginResponse;

      if (!res.ok) {
        setError(data.message ?? 'Invalid or expired 6-digit verification code. Please try again.');
        return;
      }

      await refreshSession();
      router.replace('/');
    } catch {
      setError('Unable to verify MFA code right now. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleBackToCredentials() {
    setStep('credentials');
    setMfaCode('');
    setError(null);
  }

  return (
    <div className="min-h-[100dvh] grid lg:grid-cols-[440px_1fr] bg-[#F4F4F1] text-[#111111]">
      {/* Brand Panel */}
      <aside className="bg-[#111111] text-white px-5 py-6 sm:p-8 lg:p-10 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-[#2C2C2A] relative overflow-hidden">
        {/* Architectural amber top bar */}
        <div className="absolute inset-x-0 top-0 h-1 bg-[#FCAE1A]" />

        <div className="space-y-5 lg:space-y-8">
          <InterstateLogo variant="dark" />

          <div className="space-y-2.5 lg:space-y-3 pt-1 lg:pt-4">
            <h1 className="font-display text-xl sm:text-2xl lg:text-[26px] font-bold tracking-tight leading-snug text-white">
              Estimating, Subcontracts &amp; Live Job Cost Budgets
            </h1>
            <p className="text-sm text-[#C9CED8] leading-relaxed">
              Authorized access for Interstate Homes estimators, project managers, administrators,
              and verified trade partners across Southern Utah.
            </p>
          </div>
        </div>

        <div className="hidden lg:block mt-10 pt-6 border-t border-[#2C2C2A] space-y-3 text-xs text-[#9D9D97]">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-[#FCAE1A] shrink-0" />
            <span>Role-based access control &amp; immutable audit logging</span>
          </div>
          <div className="flex items-center gap-2.5">
            <Lock className="w-4 h-4 text-[#FCAE1A] shrink-0" />
            <span>HttpOnly encrypted sessions with TOTP multi-factor verification</span>
          </div>
          <div className="pt-2 text-[11px] text-[#75756F]">
            &copy; {new Date().getFullYear()} Interstate Homes &bull; St. George, Utah
          </div>
        </div>
      </aside>

      {/* Sign-In Form Canvas */}
      <main className="flex items-start lg:items-center justify-center px-4 py-6 sm:p-10 safe-bottom">
        <div className="w-full max-w-md space-y-5">
          {authMode === 'demo' && !loading ? (
            <div className="rounded-lg border border-[#FCAE1A]/40 bg-[#FFF9EB] px-4 py-2 text-xs text-[#5F4200] flex items-center justify-between gap-3">
              <span>Running in local Demo Mode.</span>
              <Link
                href="/"
                className="min-h-[44px] inline-flex items-center font-display font-semibold text-[#111111] underline underline-offset-2 hover:text-[#8A5A00] shrink-0"
              >
                Open Dashboard
              </Link>
            </div>
          ) : null}

          <div className="bg-white border border-[#E3E3DE] rounded-xl shadow-sm p-5 sm:p-8">
            {step === 'credentials' ? (
              <>
                <div className="mb-6">
                  <h2 className="font-display text-xl font-bold text-[#111111]">
                    Sign in to your account
                  </h2>
                  <p className="text-sm text-[#5F5F5A] mt-1">
                    Enter your Interstate Homes credentials to continue.
                  </p>
                </div>

                {error ? (
                  <div
                    role="alert"
                    className="mb-5 flex items-start gap-2.5 rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-3.5 py-3 text-xs text-[#991B1B]"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                ) : null}

                <form onSubmit={handleCredentialsSubmit} className="space-y-4" noValidate>
                  <div>
                    <label
                      htmlFor="login-email"
                      className="block text-xs font-display font-semibold uppercase tracking-[0.08em] text-[#3B3B38] mb-1.5"
                    >
                      Work Email
                    </label>
                    <input
                      id="login-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@interstatehomes.com"
                      disabled={submitting}
                      className="w-full min-h-[44px] rounded-lg border border-[#D4D4CE] bg-white px-3.5 py-2.5 text-sm text-[#111111] placeholder:text-[#767670] focus:outline-none focus:border-[#111111] focus:ring-2 focus:ring-[#FCAE1A]/40 disabled:opacity-60"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="login-password"
                      className="block text-xs font-display font-semibold uppercase tracking-[0.08em] text-[#3B3B38] mb-1.5"
                    >
                      Password
                    </label>
                    <div className="relative">
                      <input
                        id="login-password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        disabled={submitting}
                        className="w-full min-h-[44px] rounded-lg border border-[#D4D4CE] bg-white pl-3.5 pr-12 py-2.5 text-sm text-[#111111] placeholder:text-[#767670] focus:outline-none focus:border-[#111111] focus:ring-2 focus:ring-[#FCAE1A]/40 disabled:opacity-60"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute inset-y-0 right-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-[#5F5F5A] hover:text-[#111111] cursor-pointer"
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full min-h-[44px] mt-2 rounded-lg bg-[#111111] hover:bg-[#262624] text-white font-display text-sm font-semibold py-2.5 px-4 transition-colors focus:outline-none focus:ring-2 focus:ring-[#FCAE1A] focus:ring-offset-2 disabled:opacity-60 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <span className="inline-block w-2 h-2 rounded-full bg-[#FCAE1A]" />
                    <span>{submitting ? 'Signing in…' : 'Sign In'}</span>
                  </button>
                </form>
              </>
            ) : (
              <>
                <div className="mb-6">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-[#111111] text-[#FCAE1A] mb-3">
                    <KeyRound className="w-5 h-5" />
                  </div>
                  <h2 className="font-display text-xl font-bold text-[#111111]">
                    Two-factor verification
                  </h2>
                  <p className="text-sm text-[#5F5F5A] mt-1">
                    Enter the 6-digit code from your authenticator app for{' '}
                    <span className="font-semibold text-[#111111] break-all">{pendingEmail}</span>.
                  </p>
                </div>

                {error ? (
                  <div
                    role="alert"
                    className="mb-5 flex items-start gap-2.5 rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-3.5 py-3 text-xs text-[#991B1B]"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                ) : null}

                <form onSubmit={handleMfaSubmit} className="space-y-4" noValidate>
                  <div>
                    <label
                      htmlFor="mfa-code"
                      className="block text-xs font-display font-semibold uppercase tracking-[0.08em] text-[#3B3B38] mb-1.5"
                    >
                      6-Digit Authenticator Code
                    </label>
                    <input
                      ref={mfaInputRef}
                      id="mfa-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      pattern="\d{6}"
                      required
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      disabled={submitting}
                      className="w-full min-h-[48px] rounded-lg border border-[#D4D4CE] bg-white px-4 py-3 text-center font-mono text-xl sm:text-2xl tracking-[0.28em] sm:tracking-[0.4em] tabular-nums text-[#111111] placeholder:text-[#9D9D97] focus:outline-none focus:border-[#111111] focus:ring-2 focus:ring-[#FCAE1A]/40 disabled:opacity-60"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting || mfaCode.length !== 6}
                    className="w-full min-h-[44px] rounded-lg bg-[#FCAE1A] hover:bg-[#E59B0C] text-[#111111] font-display text-sm font-bold py-2.5 px-4 transition-colors focus:outline-none focus:ring-2 focus:ring-[#111111] focus:ring-offset-2 disabled:opacity-50 cursor-pointer"
                  >
                    {submitting ? 'Verifying…' : 'Verify & Continue'}
                  </button>

                  <button
                    type="button"
                    onClick={handleBackToCredentials}
                    disabled={submitting}
                    className="w-full min-h-[44px] flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-[#5F5F5A] hover:text-[#111111] transition-colors cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back to sign in</span>
                  </button>
                </form>
              </>
            )}
          </div>

          <p className="text-center text-xs text-[#5F5F5A]">
            Sessions automatically lock after inactivity per Interstate Homes security policy.
          </p>
          <p className="lg:hidden text-center text-[11px] text-[#75756F]">
            &copy; {new Date().getFullYear()} Interstate Homes &bull; St. George, Utah
          </p>
        </div>
      </main>
    </div>
  );
}
