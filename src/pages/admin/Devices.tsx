import { Check, Copy, KeyRound, ScrollText, Wrench } from 'lucide-react';
import { useState } from 'react';
import { backend, errorMessage } from '@/services';
import { useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useSettings } from '@/hooks/useSettings';
import { formatDateTime, relativeTime } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge, type Tone } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { EmptyState, ErrorNote, PageHeader } from '@/components/ui/misc';
import { DeviceCard } from '@/components/dashboard/DeviceCard';
import type { Device } from '@/types/domain';

const resultTone = (r: string): Tone =>
  r.startsWith('counted') ? 'ok' : r === 'duplicate' ? 'neutral' : r === 'logged' ? 'brand' : 'danger';

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button variant="secondary" size="sm" icon={done ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}>
      {done ? 'Copied' : 'Copy'}
    </Button>
  );
}

export default function Devices() {
  const toast = useToast();
  const now = useNow(5000);
  const { data: settings } = useSettings();
  const devices = useAsync(() => backend.listDevices(), [], { live: ['devices', 'events'], pollMs: 10_000 });
  const [filter, setFilter] = useState('');
  const logs = useAsync(() => backend.listDeviceLogs({ deviceId: filter || undefined, limit: 100 }), [filter], { live: ['events', 'devices'], pollMs: 15_000 });

  const [rotate, setRotate] = useState<Device | null>(null);
  const [token, setToken] = useState<{ device: Device; token: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const doRotate = async () => {
    if (!rotate) return;
    setBusy(true);
    try {
      const t = await backend.rotateDeviceToken(rotate.id);
      setToken({ device: rotate, token: t });
      setRotate(null);
      await devices.reload();
    } catch (e) {
      toast.error('Could not rotate token', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (d: Device, status: Device['status']) => {
    try {
      await backend.updateDevice(d.id, { status });
      toast.success('Device updated', `${d.id} is now ${status}.`);
      await devices.reload();
    } catch (e) {
      toast.error('Update failed', errorMessage(e));
    }
  };

  const endpoint = backend.hardwareEndpoint();
  const curl = `curl -X POST '${endpoint}' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Device-Token: <DEVICE_TOKEN>' \\
  -d '{"device_id":"MEN-001","event_id":"MEN-001-0001","event_type":"passage_confirmed","timestamp":"${new Date().toISOString()}"}'`;

  return (
    <div className="space-y-6">
      <PageHeader title="Devices" description="Turnstile controllers, credentials and the raw hardware event log." />
      {devices.error && <ErrorNote message={devices.error} />}

      <div className="grid gap-4 lg:grid-cols-2">
        {devices.data?.map((d) => (
          <DeviceCard key={d.id} device={d} offlineAfter={settings?.device_offline_after_seconds ?? 90} now={now}>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={d.status} onChange={(e) => setStatus(d, e.target.value as Device['status'])} className="w-40" aria-label="Device status">
                <option value="active">Active</option>
                <option value="maintenance">Maintenance</option>
                <option value="disabled">Disabled</option>
              </Select>
              <Button variant="secondary" size="sm" icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => setRotate(d)}>
                {d.token_rotated_at ? 'Rotate token' : 'Provision token'}
              </Button>
              <span className="ml-auto text-[11px] text-subtle">
                {d.token_rotated_at ? `Token set ${relativeTime(d.token_rotated_at)}` : 'No token yet — device cannot connect'}
              </span>
            </div>
          </DeviceCard>
        ))}
      </div>

      <Card>
        <CardHeader title="Hardware integration" subtitle="Controller → backend contract" icon={<Wrench className="h-4 w-4" />} />
        <CardBody className="space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-[160px_1fr] sm:items-center">
            <span className="text-subtle">Endpoint</span>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border bg-elevated px-3 py-2 font-mono notranslate text-xs">POST {endpoint}</code>
              <CopyButton text={endpoint} />
            </div>
            <span className="text-subtle">Authentication</span>
            <span className="text-muted">Header <code className="font-mono notranslate text-xs">X-Device-Token</code> — one token per device, stored hashed on the server.</span>
            <span className="text-subtle">Counted events</span>
            <span className="text-muted">Only <code className="font-mono notranslate text-xs">passage_confirmed</code>. Button presses, timeouts and faults are logged but never counted.</span>
            <span className="text-subtle">Delivery</span>
            <span className="text-muted">Idempotent on <code className="font-mono notranslate text-xs">(device_id, event_id)</code> — controllers queue offline and retry safely. Batches via <code className="font-mono notranslate text-xs">{'{"events": [...]}'}</code>.</span>
          </div>
          <div className="relative">
            <pre className="scrollbar-thin overflow-x-auto rounded-xl border bg-elevated/60 p-4 font-mono notranslate text-[12px] leading-relaxed text-muted">{curl}</pre>
            <div className="absolute right-3 top-3"><CopyButton text={curl} /></div>
          </div>
          <p className="text-xs text-subtle">Wiring, firmware and on-site verification checklist: <span className="font-mono notranslate">docs/HARDWARE.md</span> and <span className="font-mono notranslate">hardware/esp32-turnstile</span>.</p>
        </CardBody>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Hardware event log" subtitle="Every authenticated message except heartbeats" icon={<ScrollText className="h-4 w-4" />}
          action={
            <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-40" aria-label="Filter by device">
              <option value="">All devices</option>
              {devices.data?.map((d) => <option key={d.id} value={d.id}>{d.id}</option>)}
            </Select>
          } />
        <div className="mt-4">
          {!logs.data?.length ? (
            <EmptyState icon={<ScrollText className="h-5 w-5" />} title="No hardware events yet" description="Events from the turnstile controllers will be listed here." />
          ) : (
            <div className="scrollbar-thin max-h-[520px] overflow-auto">
              <table className="table-base">
                <thead className="sticky top-0 bg-surface"><tr><th>Received</th><th>Device</th><th>Event</th><th>Event ID</th><th>Result</th><th>Source</th></tr></thead>
                <tbody>
                  {logs.data.map((l) => (
                    <tr key={l.id}>
                      <td className="tabular notranslate text-muted">{formatDateTime(l.created_at)}</td>
                      <td className="font-mono notranslate text-xs">{l.device_id}</td>
                      <td className="font-mono notranslate text-xs">{l.event_type}</td>
                      <td className="max-w-[220px] truncate font-mono notranslate text-xs text-subtle">{l.event_id ?? '—'}</td>
                      <td><Badge tone={resultTone(l.result)}>{l.result.replace(/_/g, ' ')}</Badge></td>
                      <td>{l.source === 'simulated' ? <Badge tone="warn">simulated</Badge> : <Badge>hardware</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      <Modal open={Boolean(rotate)} onClose={() => setRotate(null)} title={`New token for ${rotate?.id}?`}
        description="The current token stops working immediately. The controller must be updated with the new token."
        footer={<><Button variant="ghost" onClick={() => setRotate(null)}>Cancel</Button><Button onClick={doRotate} loading={busy}>Generate token</Button></>} />

      <Modal open={Boolean(token)} onClose={() => setToken(null)} title="Device token" className="max-w-lg"
        description="Copy it now — for security it is stored only as a hash and will never be shown again."
        footer={<Button onClick={() => setToken(null)}>I have saved it</Button>}>
        {token && (
          <div className="space-y-3">
            <div className="text-xs text-subtle">{token.device.device_name} · <span className="font-mono notranslate">{token.device.id}</span></div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg border bg-elevated px-3 py-2.5 font-mono notranslate text-xs">{token.token}</code>
              <CopyButton text={token.token} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
