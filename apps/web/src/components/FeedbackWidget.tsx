'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Loader2,
  MessageSquarePlus,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type {
  FeedbackCategory,
  FeedbackChatResponse,
  FeedbackItemReporterDTO,
  FeedbackSeverity,
} from '@interstate/shared';
import { apiFetch } from '@/lib/api';
import { useCurrentPageContext } from '@/lib/page-context';
import { useRole } from '@/lib/role-context';
import {
  getDiagnosticSnapshot,
  getRecentErrorsSummary,
  getTelemetryCounts,
  subscribeTelemetry,
} from '@/lib/telemetry';

interface ChatMsg {
  senderType: 'user' | 'assistant';
  body: string;
}

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  triage: { label: 'Triage', cls: 'bg-[#F4F4F1] text-[#3B3B38]' },
  plan_generating: { label: 'Planning', cls: 'bg-[#DBEAFE] text-[#1E40AF]' },
  plan_ready: { label: 'Plan Ready', cls: 'bg-[#FEF3C7] text-[#8A5A00]' },
  approved: { label: 'Approved', cls: 'bg-[#DBEAFE] text-[#1E40AF]' },
  in_progress: { label: 'In Progress', cls: 'bg-[#FFEDD5] text-[#9A3412]' },
  deployed: { label: 'Deployed', cls: 'bg-[#DCFCE7] text-[#166534]' },
  rejected: { label: 'Reviewed', cls: 'bg-[#F4F4F1] text-[#5F5F5A]' },
};

export function FeedbackWidget() {
  const { role, subCompanyId } = useRole();
  const pageContext = useCurrentPageContext();

  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'requests'>('chat');
  const [counts, setCounts] = useState(() => getTelemetryCounts());
  const [showSnapshotPreview, setShowSnapshotPreview] = useState(false);

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [inputText, setInputText] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const [showSubmitCard, setShowSubmitCard] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>('bug');
  const [severity, setSeverity] = useState<FeedbackSeverity>('medium');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedTicket, setSubmittedTicket] = useState<FeedbackItemReporterDTO | null>(null);

  const [screenshotPreviewUrl, setScreenshotPreviewUrl] = useState<string | null>(null);
  const [screenshotStorageKey, setScreenshotStorageKey] = useState<string | null>(null);
  const [capturingShot, setCapturingShot] = useState(false);

  const [myRequests, setMyRequests] = useState<FeedbackItemReporterDTO[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [updatesBadge, setUpdatesBadge] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCounts(getTelemetryCounts());
    return subscribeTelemetry(() => {
      setCounts(getTelemetryCounts());
    });
  }, []);

  const refreshSummary = async () => {
    try {
      const res = await apiFetch<{ myUpdatesCount: number }>('/api/feedback/summary', {
        role,
        subCompanyId,
      });
      setUpdatesBadge(res.myUpdatesCount ?? 0);
    } catch {
      // Background badge refresh should not block navigation
    }
  };

  const loadMyRequests = async () => {
    setLoadingRequests(true);
    setRequestsError(null);
    try {
      const res = await apiFetch<{ items: FeedbackItemReporterDTO[] }>('/api/feedback', {
        role,
        subCompanyId,
      });
      setMyRequests(res.items);
    } catch (err) {
      setRequestsError(
        err instanceof Error ? err.message : 'Unable to load your submitted requests.'
      );
    } finally {
      setLoadingRequests(false);
    }
  };

  useEffect(() => {
    void refreshSummary();
    const onUpdated = () => {
      void refreshSummary();
      if (open && activeTab === 'requests') {
        void loadMyRequests();
      }
    };
    window.addEventListener('interstate:feedback-updated', onUpdated);
    return () => window.removeEventListener('interstate:feedback-updated', onUpdated);
  }, [role, subCompanyId, open, activeTab]);

  useEffect(() => {
    const onOpenEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ presetCategory?: FeedbackCategory; presetMessage?: string }>).detail;
      setOpen(true);
      setActiveTab('chat');
      if (detail?.presetCategory) setCategory(detail.presetCategory);
      if (detail?.presetMessage) {
        setInputText(detail.presetMessage);
      }
    };
    window.addEventListener('interstate:open-feedback', onOpenEvent);
    return () => window.removeEventListener('interstate:open-feedback', onOpenEvent);
  }, []);

  useEffect(() => {
    if (open && activeTab === 'requests') {
      void loadMyRequests();
    }
  }, [open, activeTab, role, subCompanyId]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, showSubmitCard, submittedTicket]);

  // Close sheet on Escape and lock body scroll on mobile full-screen sheet
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const isMobileSheet = window.innerWidth < 640;
    const prevOverflow = document.body.style.overflow;
    if (isMobileSheet) {
      document.body.style.overflow = 'hidden';
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (isMobileSheet) {
        document.body.style.overflow = prevOverflow;
      }
    };
  }, [open]);

  const contextLabel = useMemo(() => {
    const sec = pageContext.section || pageContext.pathname;
    return pageContext.entityLabel ? `${sec} · ${pageContext.entityLabel}` : sec;
  }, [pageContext]);

  const uploadScreenshotDataUrl = async (dataUrl: string) => {
    const res = await apiFetch<{ storageKey: string }>('/api/feedback/screenshot', {
      method: 'POST',
      role,
      subCompanyId,
      body: JSON.stringify({ dataUrl, filename: `capture-${Date.now()}.png` }),
    });
    setScreenshotPreviewUrl(dataUrl);
    setScreenshotStorageKey(res.storageKey);
  };

  const handleCaptureScreenshot = async () => {
    setCapturingShot(true);
    setChatError(null);
    try {
      const { domToPng } = await import('modern-screenshot');
      const dataUrl = await domToPng(document.body, {
        scale: 1,
        filter: (node) => {
          if (node instanceof HTMLElement && node.dataset.feedbackWidget === 'true') {
            return false;
          }
          return true;
        },
        onCloneNode: (cloned) => {
          if (cloned instanceof HTMLElement) {
            const redacted = cloned.querySelectorAll('[data-feedback-redact="true"]');
            redacted.forEach((el) => {
              if (el instanceof HTMLElement) {
                el.style.filter = 'blur(8px)';
              }
            });
          }
        },
      });
      await uploadScreenshotDataUrl(dataUrl);
    } catch (err) {
      setChatError(
        err instanceof Error
          ? `Screenshot capture failed (${err.message}). You can attach an image file instead.`
          : 'Screenshot capture failed.'
      );
    } finally {
      setCapturingShot(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCapturingShot(true);
    setChatError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read image file'));
        reader.readAsDataURL(file);
      });
      await uploadScreenshotDataUrl(dataUrl);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed to upload screenshot');
    } finally {
      setCapturingShot(false);
      e.target.value = '';
    }
  };

  const handleSendChat = async (overrideText?: string) => {
    const text = (overrideText ?? inputText).trim();
    if (!text || sendingChat) return;

    setChatError(null);
    setSubmittedTicket(null);
    const nextMessages: ChatMsg[] = [...messages, { senderType: 'user', body: text }];
    setMessages(nextMessages);
    if (!overrideText) setInputText('');
    setSendingChat(true);

    try {
      const res = await apiFetch<FeedbackChatResponse>('/api/feedback/chat', {
        method: 'POST',
        role,
        subCompanyId,
        body: JSON.stringify({
          messages: nextMessages,
          pageContext,
          recentErrorsSummary: getRecentErrorsSummary() || undefined,
          screenshotStorageKey: screenshotStorageKey ?? undefined,
        }),
      });

      setMessages((prev) => [...prev, { senderType: 'assistant', body: res.reply }]);
      setCategory(res.suggestedCategory);
      setSeverity(res.suggestedSeverity);
      setTitle(res.suggestedTitle);
      setDescription(res.draftSummary || nextMessages.filter((m) => m.senderType === 'user').map((m) => m.body).join('\n\n'));
      if (res.readyToSubmit) {
        setShowSubmitCard(true);
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Unable to reach assistant');
    } finally {
      setSendingChat(false);
    }
  };

  const handleSubmitTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const finalTitle = title.trim() || `${pageContext.section || 'App'} feedback`;
    const finalDesc =
      description.trim() ||
      messages
        .filter((m) => m.senderType === 'user')
        .map((m) => m.body)
        .join('\n') ||
      finalTitle;

    if (finalTitle.length < 3 || finalDesc.length < 3) {
      setChatError('Please provide a short title and description before submitting.');
      return;
    }

    setSubmitting(true);
    setChatError(null);
    try {
      const snapshot = getDiagnosticSnapshot();
      const res = await apiFetch<{ item: FeedbackItemReporterDTO }>('/api/feedback', {
        method: 'POST',
        role,
        subCompanyId,
        body: JSON.stringify({
          category,
          severity,
          title: finalTitle,
          description: finalDesc,
          pageContext,
          diagnosticSnapshot: snapshot,
          screenshotStorageKey,
          transcript: messages,
        }),
      });

      setSubmittedTicket(res.item);
      setShowSubmitCard(false);
      setMessages([]);
      setTitle('');
      setDescription('');
      setScreenshotPreviewUrl(null);
      setScreenshotStorageKey(null);
      window.dispatchEvent(new Event('interstate:feedback-updated'));
      void loadMyRequests();
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  const resetChatDraft = () => {
    setMessages([]);
    setShowSubmitCard(false);
    setSubmittedTicket(null);
    setChatError(null);
    setTitle('');
    setDescription('');
    setScreenshotPreviewUrl(null);
    setScreenshotStorageKey(null);
  };

  const snapshotPreview = useMemo(() => {
    if (!showSnapshotPreview) return null;
    return getDiagnosticSnapshot();
  }, [showSnapshotPreview, counts]);

  return (
    <div data-feedback-widget="true" data-print-hide="true">
      {!open ? (
        <div className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-3 md:bottom-4 md:right-4 z-50">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open Feedback & Bug Assistant"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center gap-2 px-3 sm:px-3.5 py-2 rounded-full bg-[#111111] text-white border border-[#2C2C2A] shadow-lg hover:bg-[#262624] transition-colors cursor-pointer"
          >
            <span className="w-6 h-6 rounded-full bg-[#FCAE1A] text-[#111111] flex items-center justify-center shrink-0">
              <MessageSquarePlus className="w-3.5 h-3.5" />
            </span>
            <span className="hidden sm:inline text-xs font-display font-semibold tracking-wide">
              Feedback &amp; Bugs
            </span>
            {counts.errorCount + counts.failedRequestCount > 0 ? (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#7F1D1D] text-[#FECACA] tabular-nums">
                {counts.errorCount + counts.failedRequestCount}
              </span>
            ) : updatesBadge > 0 ? (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#FCAE1A] text-[#111111] tabular-nums">
                {updatesBadge}
              </span>
            ) : null}
          </button>
        </div>
      ) : (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Interstate Feedback Assistant"
          className="fixed inset-0 sm:inset-auto sm:bottom-4 sm:right-4 z-50 w-full sm:w-[410px] h-[100dvh] sm:h-[min(640px,calc(100dvh-2rem))] rounded-none sm:rounded-xl bg-white border-0 sm:border sm:border-[#E3E3DE] shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="bg-[#111111] text-white px-4 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-7 h-7 rounded-md bg-[#FCAE1A] text-[#111111] flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <div className="text-xs font-display font-bold truncate">
                  Interstate Feedback Assistant
                </div>
                <div className="text-[10px] text-[#9D9D97] truncate">
                  Auto-attaches page context &amp; diagnostic logs
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close Feedback Assistant"
              className="min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 inline-flex items-center justify-center p-1.5 rounded hover:bg-[#262624] text-[#C9CED8] hover:text-white cursor-pointer shrink-0"
            >
              <X className="w-5 h-5 sm:w-4 sm:h-4" />
            </button>
          </div>

          {/* Tabs */}
          <div className="grid grid-cols-2 border-b border-[#E3E3DE] bg-[#F4F4F1] text-xs font-display font-semibold shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('chat')}
              className={`min-h-[44px] sm:min-h-0 py-2.5 text-center transition-colors cursor-pointer ${
                activeTab === 'chat'
                  ? 'bg-white text-[#111111] border-b-2 border-[#FCAE1A]'
                  : 'text-[#5F5F5A] hover:text-[#111111]'
              }`}
            >
              Report / Request
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('requests')}
              className={`min-h-[44px] sm:min-h-0 py-2.5 text-center transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'requests'
                  ? 'bg-white text-[#111111] border-b-2 border-[#FCAE1A]'
                  : 'text-[#5F5F5A] hover:text-[#111111]'
              }`}
            >
              <span>My Requests</span>
              {myRequests.length > 0 ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#E3E3DE] text-[#111111] tabular-nums">
                  {myRequests.length}
                </span>
              ) : null}
            </button>
          </div>

          {activeTab === 'chat' ? (
            <>
              {/* Context Pill Bar */}
              <div className="px-3.5 py-2 bg-[#FAFAF8] border-b border-[#E3E3DE] space-y-1.5 shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#111111] bg-[#FEF3C7] border border-[#FDE68A] px-2 py-0.5 rounded truncate">
                    {contextLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowSnapshotPreview((v) => !v)}
                    className="min-h-[44px] sm:min-h-0 px-2 sm:px-0 text-[11px] sm:text-[10px] text-[#5F5F5A] hover:text-[#111111] inline-flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    <span>Inspect logs</span>
                    {showSnapshotPreview ? (
                      <ChevronUp className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                    )}
                  </button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-[#5F5F5A]">
                  <span>
                    {counts.errorCount + counts.failedRequestCount} errors · {counts.networkCount} API calls · {counts.breadcrumbCount} actions
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCaptureScreenshot}
                      disabled={capturingShot}
                      className="min-h-[44px] sm:min-h-0 px-2.5 sm:px-0 rounded border border-[#E3E3DE] sm:border-0 bg-white sm:bg-transparent inline-flex items-center gap-1.5 text-xs sm:text-[10px] font-semibold text-[#111111] hover:underline disabled:opacity-50 cursor-pointer"
                    >
                      {capturingShot ? (
                        <Loader2 className="w-3.5 h-3.5 sm:w-3 sm:h-3 animate-spin" />
                      ) : (
                        <Camera className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                      )}
                      <span>Capture screen</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={capturingShot}
                      className="min-h-[44px] sm:min-h-0 px-2.5 sm:px-0 rounded border border-[#E3E3DE] sm:border-0 bg-white sm:bg-transparent inline-flex items-center gap-1.5 text-xs sm:text-[10px] font-semibold text-[#5F5F5A] hover:text-[#111111] cursor-pointer"
                    >
                      <ImagePlus className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                      <span>Upload</span>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                  </div>
                </div>

                {showSnapshotPreview && snapshotPreview ? (
                  <div className="mt-1 p-2 rounded bg-[#111111] text-[#E3E3DE] text-[10px] font-mono max-h-28 overflow-auto space-y-1">
                    <div>Path: {pageContext.pathname} ({role})</div>
                    <div>Recent Logs: {snapshotPreview.clientLogs.length} | Network: {snapshotPreview.networkEvents.length}</div>
                    {snapshotPreview.networkEvents.slice(-3).map((n, i) => (
                      <div key={i} className={n.ok ? 'text-[#9D9D97]' : 'text-[#FCA5A5]'}>
                        {n.method} {n.path} → {n.status} ({n.durationMs}ms)
                      </div>
                    ))}
                  </div>
                ) : null}

                {screenshotPreviewUrl ? (
                  <div className="flex items-center justify-between gap-2 bg-white border border-[#E3E3DE] rounded p-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <img
                        src={screenshotPreviewUrl}
                        alt="Captured screen preview"
                        className="w-10 h-7 object-cover rounded border border-[#E3E3DE]"
                      />
                      <span className="text-[10px] font-semibold text-[#166534] truncate">
                        Screenshot attached (redacted)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setScreenshotPreviewUrl(null);
                        setScreenshotStorageKey(null);
                      }}
                      className="p-1 text-[#5F5F5A] hover:text-[#991B1B] cursor-pointer"
                      aria-label="Remove screenshot"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : null}
              </div>

              {/* Chat Body */}
              <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-white">
                {submittedTicket ? (
                  <div className="bg-[#DCFCE7] border border-[#86EFAC] rounded-lg p-3.5 space-y-2">
                    <div className="flex items-center gap-2 text-[#166534] font-display font-bold text-xs">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>Submitted {submittedTicket.ticketKey} — Fix Plan Ready for Admin</span>
                    </div>
                    <p className="text-xs text-[#14532D]">
                      {submittedTicket.title}
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <Link
                        href={`/feedback?id=${submittedTicket.id}`}
                        onClick={() => setOpen(false)}
                        className="text-[11px] font-semibold px-2.5 py-1 rounded bg-[#111111] text-white hover:bg-[#262624]"
                      >
                        Track Status
                      </Link>
                      <button
                        type="button"
                        onClick={resetChatDraft}
                        className="text-[11px] font-semibold text-[#166534] hover:underline cursor-pointer"
                      >
                        New Report
                      </button>
                    </div>
                  </div>
                ) : null}

                {messages.length === 0 && !submittedTicket ? (
                  <div className="space-y-3">
                    <div className="bg-[#F4F4F1] rounded-lg p-3 text-xs text-[#3B3B38]">
                      Tell me what bug you hit or what feature would help on{' '}
                      <span className="font-semibold text-[#111111]">{contextLabel}</span>. I will
                      attach your diagnostic log snapshot and draft a fix plan for Admin approval.
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        'Report a bug on this page',
                        'Request a new feature',
                        'Something failed or looks wrong',
                      ].map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => void handleSendChat(chip)}
                          className="text-[11px] px-2.5 py-1.5 rounded-full border border-[#E3E3DE] bg-white hover:border-[#FCAE1A] hover:bg-[#FEF3C7]/40 text-[#111111] transition-colors cursor-pointer"
                        >
                          {chip}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${msg.senderType === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                        msg.senderType === 'user'
                          ? 'bg-[#111111] text-white'
                          : 'bg-[#F4F4F1] text-[#111111] border border-[#E3E3DE]'
                      }`}
                    >
                      {msg.body}
                    </div>
                  </div>
                ))}

                {sendingChat ? (
                  <div className="flex justify-start">
                    <div className="bg-[#F4F4F1] border border-[#E3E3DE] rounded-lg px-3 py-2 text-xs text-[#5F5F5A] inline-flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Analyzing context &amp; logs…</span>
                    </div>
                  </div>
                ) : null}

                {showSubmitCard && !submittedTicket ? (
                  <form
                    onSubmit={handleSubmitTicket}
                    className="border border-[#FCAE1A] bg-[#FFFBEB] rounded-lg p-3 space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-display font-bold uppercase tracking-wide text-[#8A5A00]">
                        Confirm &amp; Generate AI Fix Plan
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowSubmitCard(false)}
                        className="text-[10px] text-[#5F5F5A] hover:text-[#111111] cursor-pointer"
                      >
                        Keep chatting
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
                        className="border border-[#E3E3DE] bg-white rounded px-2 py-1.5 text-xs"
                      >
                        <option value="bug">Bug</option>
                        <option value="feature">Feature Request</option>
                        <option value="question">Question</option>
                      </select>
                      <select
                        value={severity}
                        onChange={(e) => setSeverity(e.target.value as FeedbackSeverity)}
                        className="border border-[#E3E3DE] bg-white rounded px-2 py-1.5 text-xs"
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </select>
                    </div>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Short summary title"
                      required
                      className="w-full border border-[#E3E3DE] bg-white rounded px-2.5 py-1.5 text-xs"
                    />
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={3}
                      placeholder="Details, steps, or desired outcome..."
                      required
                      className="w-full border border-[#E3E3DE] bg-white rounded px-2.5 py-1.5 text-xs"
                    />
                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full min-h-[44px] py-2.5 rounded bg-[#FCAE1A] hover:bg-[#E59C12] text-[#111111] font-display font-bold text-xs transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {submitting ? 'Generating Fix Plan…' : 'Submit & Generate Fix Plan'}
                    </button>
                  </form>
                ) : null}

                {chatError ? (
                  <div className="bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] rounded px-3 py-2 text-[11px]">
                    {chatError}
                  </div>
                ) : null}
              </div>

              {/* Composer */}
              <div className="p-3 border-t border-[#E3E3DE] bg-white space-y-2 shrink-0 safe-bottom sm:pb-3">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleSendChat();
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Describe the bug or feature..."
                    className="flex-1 min-h-[44px] sm:min-h-0 border border-[#E3E3DE] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-[#FCAE1A]"
                  />
                  <button
                    type="submit"
                    disabled={sendingChat || !inputText.trim()}
                    aria-label="Send feedback message"
                    className="min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 inline-flex items-center justify-center p-2 rounded-md bg-[#111111] text-white hover:bg-[#262624] disabled:opacity-40 cursor-pointer shrink-0"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
                {messages.length > 0 && !showSubmitCard && !submittedTicket ? (
                  <div className="flex justify-between items-center text-[10px] text-[#5F5F5A]">
                    <span>Ready whenever you are</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (!title) {
                          const firstUser = messages.find((m) => m.senderType === 'user')?.body ?? '';
                          setTitle(firstUser.slice(0, 72) || `${pageContext.section} feedback`);
                        }
                        if (!description) {
                          setDescription(
                            messages
                              .filter((m) => m.senderType === 'user')
                              .map((m) => m.body)
                              .join('\n')
                          );
                        }
                        setShowSubmitCard(true);
                      }}
                      className="font-semibold text-[#111111] hover:underline cursor-pointer"
                    >
                      Review &amp; Submit Now →
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5 bg-[#FAFAF8]">
              {requestsError ? (
                <div
                  role="alert"
                  className="bg-[#FEF2F2] border border-[#FCA5A5] text-[#991B1B] rounded-lg p-3 space-y-2 text-xs"
                >
                  <div>{requestsError}</div>
                  <button
                    type="button"
                    onClick={() => void loadMyRequests()}
                    className="min-h-[44px] sm:min-h-0 px-3 py-1.5 rounded bg-[#991B1B] hover:bg-[#7F1D1D] text-white font-display font-semibold text-xs cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              ) : null}
              {loadingRequests ? (
                <div className="text-xs text-[#5F5F5A] py-8 text-center">Loading your requests…</div>
              ) : !requestsError && myRequests.length === 0 ? (
                <div className="text-xs text-[#5F5F5A] py-8 text-center">
                  No feedback or bug reports submitted yet.
                </div>
              ) : (
                myRequests.map((item) => {
                  const badge = STATUS_BADGES[item.status] ?? STATUS_BADGES.triage!;
                  return (
                    <Link
                      key={item.id}
                      href={`/feedback?id=${item.id}`}
                      onClick={() => setOpen(false)}
                      className="block bg-white border border-[#E3E3DE] hover:border-[#FCAE1A] rounded-lg p-3 space-y-1.5 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] font-bold text-[#5F5F5A]">
                          {item.ticketKey} · {item.pagePath}
                        </span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-[#111111]">{item.title}</div>
                      {item.resolutionNote ? (
                        <div className="text-[11px] text-[#166534] bg-[#DCFCE7]/60 rounded px-2 py-1">
                          {item.resolutionNote}
                        </div>
                      ) : null}
                    </Link>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
