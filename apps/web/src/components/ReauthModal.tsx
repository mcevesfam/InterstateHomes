'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Eye, EyeOff, Lock, X } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useRole } from '@/lib/role-context';

export interface ReauthModalProps {
  open: boolean;
  onClose: () => void;
  onVerified: () => void | Promise<void>;
  title?: string;
  description?: string;
}

export function ReauthModal({
  open,
  onClose,
  onVerified,
  title = 'Confirm Your Password',
  description = 'For security, re-enter your password before signing a purchase order or approving a live job cost budget.',
}: ReauthModalProps) {
  const { role, subCompanyId, user } = useRole();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setPassword('');
      setShowPassword(false);
      setError(null);
      return;
    }

    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, submitting, onClose]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!password) {
      setError('Enter your current password to continue.');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch<{ ok: boolean }>('/api/auth/reauth', {
        method: 'POST',
        role,
        subCompanyId,
        body: JSON.stringify({ password }),
      });

      setPassword('');
      onClose();
      await onVerified();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Password verification failed. Please check your password and try again.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-print-hide="true"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-[1px]"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reauth-modal-title"
        className="w-full max-w-md bg-white border border-[#E3E3DE] rounded-xl shadow-2xl overflow-hidden"
      >
        <div className="bg-[#111111] text-white px-5 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-md bg-[#FCAE1A] text-[#111111] flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4" />
            </span>
            <h2
              id="reauth-modal-title"
              className="font-display text-sm font-bold text-white truncate"
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close password confirmation"
            className="min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 inline-flex items-center justify-center p-1.5 rounded text-[#C9CED8] hover:text-white hover:bg-[#262624] cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4" noValidate>
          <p className="text-xs text-[#3B3B38] leading-relaxed">{description}</p>

          {user?.email ? (
            <div className="text-xs bg-[#F4F4F1] border border-[#E3E3DE] rounded-md px-3 py-2 text-[#3B3B38]">
              Signing in as <span className="font-semibold text-[#111111]">{user.email}</span>
            </div>
          ) : null}

          {error ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2.5 text-xs text-[#991B1B]"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          ) : null}

          <div>
            <label
              htmlFor="reauth-password"
              className="block text-xs font-display font-semibold uppercase tracking-[0.08em] text-[#3B3B38] mb-1.5"
            >
              Current Password
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                id="reauth-password"
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
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="min-h-[44px] px-4 py-2 rounded-lg border border-[#D4D4CE] bg-white hover:bg-[#F4F4F1] text-xs font-display font-semibold text-[#111111] transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !password}
              className="min-h-[44px] px-4 py-2 rounded-lg bg-[#111111] hover:bg-[#262624] text-white text-xs font-display font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              {submitting ? 'Verifying…' : 'Verify & Continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
