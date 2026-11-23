import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '@/i18n';

/** Last line of defence: never leave the operator staring at a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI crashed', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-screen place-items-center bg-bg px-6 text-center">
        <div className="max-w-sm">
          <p className="font-mono notranslate text-sm text-danger">{t('Unexpected error')}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t('Something went wrong')}</h1>
          <p className="mt-2 text-sm text-subtle">
            {t('No data was lost — every visitor is counted on the server. Reload the page to continue.')}
          </p>
          <button onClick={() => window.location.reload()}
            className="mt-6 h-10 rounded-xl bg-brand px-5 text-sm font-medium text-white hover:bg-brand/90">
            {t('Reload')}
          </button>
        </div>
      </div>
    );
  }
}
