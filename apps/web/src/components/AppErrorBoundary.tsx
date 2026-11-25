'use client';

import React from 'react';
import { AlertTriangle, RotateCcw, MessageSquarePlus } from 'lucide-react';
import { recordReactError } from '@/lib/telemetry';

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error.message || 'An unexpected rendering error occurred.',
    };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    recordReactError(error, info.componentStack);
  }

  handleReportCrash = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('interstate:open-feedback', {
          detail: {
            presetCategory: 'bug',
            presetMessage: `UI crash caught by ErrorBoundary: ${this.state.errorMessage}`,
          },
        })
      );
    }
  };

  override render() {
    if (this.state.hasError) {
      return (
        <div className="bg-white border border-[#FCA5A5] rounded-lg p-6 max-w-xl mx-auto my-10 space-y-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-md bg-[#FEE2E2] text-[#991B1B]">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-display font-bold text-[#111111]">
                Something went wrong rendering this view
              </h2>
              <p className="text-xs text-[#5F5F5A] mt-1">{this.state.errorMessage}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, errorMessage: '' })}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded text-xs font-semibold bg-[#111111] text-white hover:bg-[#262624] cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reload View
            </button>
            <button
              type="button"
              onClick={this.handleReportCrash}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded text-xs font-semibold bg-[#FCAE1A] text-[#111111] hover:bg-[#E59C12] cursor-pointer"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
              Report Crash with Logs
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
