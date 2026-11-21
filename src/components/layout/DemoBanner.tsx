import { FlaskConical, RotateCcw } from 'lucide-react';
import { backend } from '@/services';
import { DemoBackend } from '@/services/demo/demoBackend';
import { useSettings } from '@/hooks/useSettings';
import { useAuth } from '@/auth/AuthProvider';

/** Always-visible label so simulated data can never be mistaken for production data. */
export function DemoBanner() {
  const { data: settings } = useSettings();
  const { profile } = useAuth();

  if (backend instanceof DemoBackend) {
    const demo = backend;
    return (
      <div className="no-print flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warn/20 bg-warn/[0.07] px-4 py-2 text-[13px] text-warn sm:px-6 lg:px-8">
        <FlaskConical className="h-4 w-4 shrink-0" />
        <span className="font-medium">Local demo</span>
        <span className="text-warn/80">No backend connected — data is simulated and stored only in this browser.</span>
        {profile?.role === 'admin' && (
          <button onClick={() => demo.reset()} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-medium hover:bg-warn/10">
            <RotateCcw className="h-3.5 w-3.5" /> Reset demo data
          </button>
        )}
      </div>
    );
  }

  if (settings?.system_mode === 'demo') {
    return (
      <div className="no-print flex items-center gap-3 border-b border-warn/20 bg-warn/[0.07] px-4 py-2 text-[13px] text-warn sm:px-6 lg:px-8">
        <FlaskConical className="h-4 w-4 shrink-0" />
        <span><span className="font-medium">Demo mode</span> — simulated turnstile events are accepted and tagged “simulated”. Switch to production in Settings once hardware is connected.</span>
      </div>
    );
  }
  return null;
}
