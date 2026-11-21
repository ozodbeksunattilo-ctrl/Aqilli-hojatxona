import { Bell, Building2, Cpu, Monitor, Moon, Palette, Send, ShieldAlert, Sun, Users } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { backend, errorMessage } from '@/services';
import { useAsync } from '@/hooks/useAsync';
import { useSettings } from '@/hooks/useSettings';
import { useTheme, type ThemePref } from '@/hooks/useTheme';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Field, Input, Select, Toggle } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { ErrorNote, PageHeader } from '@/components/ui/misc';
import type { Settings as SettingsT } from '@/types/domain';

const TIMEZONES = ['Asia/Tashkent', 'Asia/Samarkand', 'Asia/Almaty', 'Asia/Dubai', 'Europe/Moscow', 'Europe/Istanbul', 'Europe/London', 'UTC'];

function Section({ icon, title, subtitle, children, footer }: { icon: ReactNode; title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Card>
      <CardHeader icon={icon} title={title} subtitle={subtitle} />
      <CardBody>{children}</CardBody>
      {footer && <div className="flex justify-end gap-2 border-t px-6 py-4">{footer}</div>}
    </Card>
  );
}

export default function SettingsPage() {
  const toast = useToast();
  const settings = useSettings();
  const { pref, setPref } = useTheme();
  const [draft, setDraft] = useState<SettingsT | null>(null);
  const [ids, setIds] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmProd, setConfirmProd] = useState(false);
  const telegram = useAsync(() => backend.telegramStatus().catch(() => null), []);
  const activity = useAsync(() => backend.listActivity(15), [], { live: ['settings', 'shifts'] });

  useEffect(() => {
    if (settings.data && !draft) {
      setDraft(settings.data);
      setIds(settings.data.telegram_admin_ids.join(', '));
    }
  }, [settings.data, draft]);

  if (!draft) {
    return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-64" /><Skeleton className="h-64" /></div>;
  }

  const set = <K extends keyof SettingsT>(k: K, v: SettingsT[K]) => setDraft({ ...draft, [k]: v });

  const save = async (patch: Partial<SettingsT>, label: string) => {
    setSaving(true);
    try {
      const next = await backend.updateSettings(patch);
      setDraft(next);
      setIds(next.telegram_admin_ids.join(', '));
      toast.success(`${label} saved`);
    } catch (e) {
      toast.error('Could not save settings', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const parsedIds = ids.split(/[\s,]+/).filter(Boolean);
  const idsValid = parsedIds.every((x) => /^\d{4,15}$/.test(x));

  const testTelegram = async () => {
    try {
      await backend.telegramTest();
      toast.success('Test message sent', 'Check your Telegram.');
    } catch (e) {
      toast.error('Telegram test failed', errorMessage(e));
    }
  };

  const themeOptions: { value: ThemePref; label: string; icon: ReactNode }[] = [
    { value: 'dark', label: 'Dark', icon: <Moon className="h-4 w-4" /> },
    { value: 'light', label: 'Light', icon: <Sun className="h-4 w-4" /> },
    { value: 'system', label: 'System', icon: <Monitor className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Business profile, operating rules, integrations and appearance." />
      {settings.error && <ErrorNote message={settings.error} />}

      <div className="grid gap-6 xl:grid-cols-2">
        <Section icon={<Building2 className="h-4 w-4" />} title="Business" subtitle="Shown in reports and Telegram messages"
          footer={<Button loading={saving} onClick={() => save({ business_name: draft.business_name, business_location: draft.business_location, timezone: draft.timezone }, 'Business settings')}>Save</Button>}>
          <div className="space-y-4">
            <Field label="Business name"><Input value={draft.business_name} onChange={(e) => set('business_name', e.target.value)} /></Field>
            <Field label="Location"><Input value={draft.business_location} onChange={(e) => set('business_location', e.target.value)} placeholder="Street, city" /></Field>
            <Field label="Time zone" hint="Defines what “today” means for statistics and reports">
              <Select value={draft.timezone} onChange={(e) => set('timezone', e.target.value)}>
                {[...new Set([draft.timezone, ...TIMEZONES])].map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </Select>
            </Field>
          </div>
        </Section>

        <Section icon={<ShieldAlert className="h-4 w-4" />} title="System mode" subtitle="Separates simulated events from real hardware">
          <div className="grid gap-3 sm:grid-cols-2">
            {(['demo', 'production'] as const).map((m) => (
              <button key={m} type="button"
                onClick={() => (m === 'production' && draft.system_mode !== 'production' ? setConfirmProd(true) : m !== draft.system_mode && save({ system_mode: m }, 'System mode'))}
                className={cn('rounded-2xl border p-4 text-left transition-all', draft.system_mode === m ? 'border-brand bg-brand/[0.06] ring-4 ring-brand/10' : 'hover:bg-elevated')}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold capitalize">{m}</span>
                  {draft.system_mode === m && <Badge tone={m === 'production' ? 'ok' : 'warn'}>Current</Badge>}
                </div>
                <p className="mt-1.5 text-[13px] text-subtle">
                  {m === 'demo'
                    ? 'Simulator enabled. Simulated events are counted and tagged “simulated”.'
                    : 'Only authenticated hardware events are accepted. All simulated events are rejected.'}
                </p>
              </button>
            ))}
          </div>
        </Section>

        <Section icon={<Users className="h-4 w-4" />} title="Employees & shifts" subtitle="Shift rules enforced by the server"
          footer={<Button loading={saving} onClick={() => save({ single_shared_shift: draft.single_shared_shift }, 'Shift rules')}>Save</Button>}>
          <Toggle checked={draft.single_shared_shift} onChange={(v) => set('single_shared_shift', v)}
            label="One shared shift at the location"
            description="Only one employee can be on shift at a time. Another employee can start only after the current shift ends." />
          <p className="mt-2 text-xs text-subtle">Employees can never be on two shifts at once, and completed shifts are permanently locked.</p>
        </Section>

        <Section icon={<Cpu className="h-4 w-4" />} title="Devices" subtitle="Connection monitoring"
          footer={<Button loading={saving} onClick={() => save({ device_offline_after_seconds: draft.device_offline_after_seconds }, 'Device settings')}>Save</Button>}>
          <Field label="Mark a turnstile offline after (seconds without contact)" hint="Controllers send a heartbeat every 30 seconds. Recommended: 90.">
            <Input type="number" min={15} max={3600} value={draft.device_offline_after_seconds}
              onChange={(e) => set('device_offline_after_seconds', Number(e.target.value))} />
          </Field>
        </Section>

        <Section icon={<Send className="h-4 w-4" />} title="Telegram" subtitle="Notifications and admin bot commands"
          footer={<>
            <Button variant="secondary" onClick={testTelegram}>Send test</Button>
            <Button loading={saving} disabled={!idsValid} onClick={() => save({
              telegram_enabled: draft.telegram_enabled,
              telegram_admin_ids: parsedIds.map(Number),
            }, 'Telegram settings')}>Save</Button>
          </>}>
          <div className="mb-3 flex items-center gap-2 text-[13px]">
            <span className="text-subtle">Bot token:</span>
            {telegram.data?.bot_configured ? <Badge tone="ok" dot>Configured on server</Badge> : <Badge tone="warn" dot>Not configured</Badge>}
          </div>
          <Toggle checked={draft.telegram_enabled} onChange={(v) => set('telegram_enabled', v)} label="Enable Telegram notifications" />
          <Field label="Authorised Telegram user IDs" className="mt-3"
            error={idsValid ? null : 'IDs must be numbers, separated by commas'}
            hint="Only these users receive notifications and can use /today, /report, /employees, /active, /shifts. Send /start to the bot to see your ID.">
            <Input value={ids} onChange={(e) => setIds(e.target.value)} placeholder="123456789, 987654321" />
          </Field>
          <p className="mt-3 text-xs text-subtle">The bot token is stored only as a server secret (Supabase Edge Function) and is never sent to the browser.</p>
        </Section>

        <Section icon={<Bell className="h-4 w-4" />} title="Notifications" subtitle="What gets sent to Telegram"
          footer={<Button loading={saving} onClick={() => save({
            notify_shift_start: draft.notify_shift_start, notify_shift_end: draft.notify_shift_end,
            notify_daily_report: draft.notify_daily_report, daily_report_hour: draft.daily_report_hour,
          }, 'Notification settings')}>Save</Button>}>
          <div className="divide-y">
            <Toggle checked={draft.notify_shift_start} onChange={(v) => set('notify_shift_start', v)} label="Shift started" description="Employee name and start time" />
            <Toggle checked={draft.notify_shift_end} onChange={(v) => set('notify_shift_end', v)} label="Shift ended" description="Counts by gender, total and duration" />
            <Toggle checked={draft.notify_daily_report} onChange={(v) => set('notify_daily_report', v)} label="Daily report" description="Totals and per-employee statistics" />
          </div>
          <Field label="Send daily report at" className="mt-3">
            <Select value={draft.daily_report_hour} onChange={(e) => set('daily_report_hour', Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
            </Select>
          </Field>
        </Section>

        <Section icon={<Palette className="h-4 w-4" />} title="Appearance" subtitle="Saved on this device">
          <div className="grid grid-cols-3 gap-3">
            {themeOptions.map((o) => (
              <button key={o.value} type="button" onClick={() => setPref(o.value)}
                className={cn('flex flex-col items-center gap-2 rounded-2xl border p-4 text-sm font-medium transition-all',
                  pref === o.value ? 'border-brand bg-brand/[0.06] text-fg ring-4 ring-brand/10' : 'text-subtle hover:bg-elevated hover:text-fg')}>
                {o.icon}{o.label}
              </button>
            ))}
          </div>
        </Section>

        <Card>
          <CardHeader title="Recent activity" subtitle="Audit trail of account and configuration changes" />
          <CardBody>
            <ul className="space-y-2.5">
              {(activity.data ?? []).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate"><span className="font-medium">{a.user_name ?? 'System'}</span> <span className="font-mono notranslate text-xs text-subtle">{a.action}</span></span>
                  <span className="shrink-0 text-xs text-subtle">{formatDateTime(a.created_at)}</span>
                </li>
              ))}
              {activity.data?.length === 0 && <li className="text-sm text-subtle">No activity yet.</li>}
            </ul>
          </CardBody>
        </Card>
      </div>

      <Modal open={confirmProd} onClose={() => setConfirmProd(false)} title="Switch to production mode?"
        description="From now on only authenticated hardware events are counted, the simulator is disabled and any simulated event is rejected. Make sure both turnstile controllers are provisioned and online."
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmProd(false)}>Cancel</Button>
          <Button loading={saving} onClick={async () => { await save({ system_mode: 'production' }, 'System mode'); setConfirmProd(false); }}>Switch to production</Button>
        </>} />
    </div>
  );
}
