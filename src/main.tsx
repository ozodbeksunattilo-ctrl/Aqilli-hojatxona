import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { installDomGuard } from './lib/domGuard';
import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';
import { ThemeProvider } from './hooks/useTheme';
import { ToastProvider } from './components/ui/Toast';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import './index.css';

installDomGuard();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
