import { FlaskConical, Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { backend, errorMessage } from '@/services';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';

/**
 * DEMO MODE ONLY. Generates simulated passages through the backend so the full
 * pipeline (counting, realtime, shift attribution) can be shown without
 * hardware. Events are stored with source = "simulated"; the server rejects
 * them in production mode.
 */
export function SimulatorPanel() {
  const toast = useToast();
  const [auto, setAuto] = useState(false);
  const [sent, setSent] = useState(0);
  const failures = useRef(0);

  const fire = async (deviceId: string) => {
    try {
      await backend.simulatePassage(deviceId);
      setSent((n) => n + 1);
      failures.current = 0;
    } catch (e) {
      failures.current++;
      if (failures.current === 1) toast.error('Simulation failed', errorMessage(e));
      if (failures.current > 2) setAuto(false);
    }
  };

  useEffect(() => {
    if (!auto) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      void fire(Math.random() < 0.58 ? 'MEN-001' : 'WOMEN-001');
      timer = setTimeout(tick, 900 + Math.random() * 2600);
    };
    timer = setTimeout(tick, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  return (
    <Card className="border-dashed border-warn/30">
      <CardHeader title="Turnstile simulator" subtitle="Demo mode · no hardware required" icon={<FlaskConical className="h-4 w-4 text-warn" />}
        action={<Badge tone="warn">simulated</Badge>} />
      <CardBody className="space-y-3">
        <p className="text-[13px] text-subtle">
          Each click sends one <span className="font-mono notranslate">passage_confirmed</span> event through the same server-side counting logic used by real turnstiles.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => fire('MEN-001')} className="border-male/30 text-male hover:bg-male/10">+1 Men</Button>
          <Button variant="secondary" onClick={() => fire('WOMEN-001')} className="border-female/30 text-female hover:bg-female/10">+1 Women</Button>
        </div>
        <Button variant={auto ? 'danger' : 'secondary'} className="w-full" onClick={() => setAuto((a) => !a)}
          icon={auto ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}>
          {auto ? 'Stop live traffic' : 'Start live traffic'}
        </Button>
        {sent > 0 && <p className="text-center text-xs text-subtle">{sent} simulated passage{sent === 1 ? '' : 's'} sent this session</p>}
      </CardBody>
    </Card>
  );
}
