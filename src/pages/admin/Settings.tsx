import { Bell, Building2, Monitor, Moon, Palette, RadioTower, Send, Sun, Users } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { backend, errorMessage } from '@/services';
import { useAsync } from '@/hooks/useAsync';
import { useSettings } from '@/hooks/useSettings';
import { useTheme, type ThemePref } from '@/hooks/useTheme';
import { useT } from '@/i18n/I18nProvider';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Field, Input, Select, Toggle } from '@/components/ui/Field';
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
  const t = useT();
  const settings = useSettings();
  const { pref, setPref } = useTheme();
  const [draft, setDraft] = useState<SettingsT | null>(null);
  const [ids, setIds] = useState('');
  const [saving, setSaving] = useState(false);
  const telegram = useAsync(() => backend.telegramStatus().catch(() => null), []);

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
      toast.success(t('{label} saved', { label }));
    } catch (e) {
      toast.error(t('Could not save settings'), errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const parsedIds = ids.split(/[\s,]+/).filter(Boolean);
  const idsValid = parsedIds.every((x) => /^\d{4,15}$/.test(x));

  const testTelegram = async () => {
    try {
      await backend.telegramTest();
      toast.success(t('Test message sent'), t('Check your Telegram.'));
    } catch (e) {
      toast.error(t('Telegram test failed'), errorMessage(e));
    }
  };

  const themeOptions: { value: ThemePref; label: string; icon: ReactNode }[] = [
    { value: 'dark', label: t('Dark'), icon: <Moon className="h-4 w-4" /> },
    { value: 'light', label: t('Light'), icon: <Sun className="h-4 w-4" /> },
    { value: 'system', label: t('System'), icon: <Monitor className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t('Settings')} description={t('Business profile, operating rules, integrations and appearance.')} />
      {settings.error && <ErrorNote message={settings.error} />}

      <div className="grid gap-6 xl:grid-cols-2">
        <Section icon={<Building2 className="h-4 w-4" />} title={t('Business')} subtitle={t('Shown in reports and Telegram messages')}
          footer={<Button loading={saving} onClick={() => save({ business_name: draft.business_name, business_location: draft.business_location, timezone: draft.timezone }, t('Business settings'))}>{t('Save')}</Button>}>
          <div className="space-y-4">
            <Field label={t('Business name')}><Input value={draft.business_name} onChange={(e) => set('business_name', e.target.value)} /></Field>
            <Field label={t('Location')}><Input value={draft.business_location} onChange={(e) => set('business_location', e.target.value)} placeholder={t('Street, city')} /></Field>
            <Field label={t('Time zone')} hint={t('Defines what “today” means for statistics and reports')}>
              <Select value={draft.timezone} onChange={(e) => set('timezone', e.target.value)}>
                {[...new Set([draft.timezone, ...TIMEZONES])].map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </Select>
            </Field>
          </div>
        </Section>

        <Section icon={<Users className="h-4 w-4" />} title={t('Employees & shifts')} subtitle={t('Shift rules enforced by the server')}
          footer={<Button loading={saving} onClick={() => save({ single_shared_shift: draft.single_shared_shift }, t('Shift rules'))}>{t('Save')}</Button>}>
          <Toggle checked={draft.single_shared_shift} onChange={(v) => set('single_shared_shift', v)}
            label={t('One shared shift at the location')}
            description={t('Only one employee can be on shift at a time. Another employee can start only after the current shift ends.')} />
          <p className="mt-2 text-xs text-subtle">{t('Employees can never be on two shifts at once, and completed shifts are permanently locked.')}</p>
        </Section>

        <Section icon={<RadioTower className="h-4 w-4" />} title={t('Devices')} subtitle={t('Connection monitoring')}
          footer={<Button loading={saving} onClick={() => save({ device_offline_after_seconds: draft.device_offline_after_seconds }, t('Device settings'))}>{t('Save')}</Button>}>
          <Field label={t('Mark a turnstile offline after (seconds without contact)')} hint={t('Controllers send a heartbeat every 30 seconds. Recommended: 90.')}>
            <Input type="number" min={15} max={3600} value={draft.device_offline_after_seconds}
              onChange={(e) => set('device_offline_after_seconds', Number(e.target.value))} />
          </Field>
        </Section>

        <Section icon={<Send className="h-4 w-4" />} title={t('Telegram')} subtitle={t('Notifications and admin bot commands')}
          footer={<>
            <Button variant="secondary" onClick={testTelegram}>{t('Send test')}</Button>
            <Button loading={saving} disabled={!idsValid} onClick={() => save({
              telegram_enabled: draft.telegram_enabled,
              telegram_admin_ids: parsedIds.map(Number),
            }, t('Telegram settings'))}>{t('Save')}</Button>
          </>}>
          <div className="mb-3 flex items-center gap-2 text-[13px]">
            <span className="text-subtle">{t('Bot token:')}</span>
            {telegram.data?.bot_configured ? <Badge tone="ok" dot>{t('Configured on server')}</Badge> : <Badge tone="warn" dot>{t('Not configured')}</Badge>}
          </div>
          <Toggle checked={draft.telegram_enabled} onChange={(v) => set('telegram_enabled', v)} label={t('Enable Telegram notifications')} />
          <Field label={t('Authorised Telegram user IDs')} className="mt-3"
            error={idsValid ? null : t('IDs must be numbers, separated by commas')}
            hint={t('Only these users receive notifications and can use /today, /report, /employees, /active, /shifts. Send /start to the bot to see your ID.')}>
            <Input value={ids} onChange={(e) => setIds(e.target.value)} placeholder="123456789, 987654321" />
          </Field>
          <p className="mt-3 text-xs text-subtle">{t('The bot token is stored only as a server secret (Supabase Edge Function) and is never sent to the browser.')}</p>
        </Section>

        <Section icon={<Bell className="h-4 w-4" />} title={t('Notifications')} subtitle={t('What gets sent to Telegram')}
          footer={<Button loading={saving} onClick={() => save({
            notify_shift_start: draft.notify_shift_start, notify_shift_end: draft.notify_shift_end,
            notify_daily_report: draft.notify_daily_report, daily_report_hour: draft.daily_report_hour,
          }, t('Notification settings'))}>{t('Save')}</Button>}>
          <div className="divide-y">
            <Toggle checked={draft.notify_shift_start} onChange={(v) => set('notify_shift_start', v)} label={t('Shift started')} description={t('Employee name and start time')} />
            <Toggle checked={draft.notify_shift_end} onChange={(v) => set('notify_shift_end', v)} label={t('Shift ended')} description={t('Counts by gender, total and duration')} />
            <Toggle checked={draft.notify_daily_report} onChange={(v) => set('notify_daily_report', v)} label={t('Daily report')} description={t('Totals and per-employee statistics')} />
          </div>
          <Field label={t('Send daily report at')} className="mt-3">
            <Select value={draft.daily_report_hour} onChange={(e) => set('daily_report_hour', Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
            </Select>
          </Field>
        </Section>

        <Section icon={<Palette className="h-4 w-4" />} title={t('Appearance')} subtitle={t('Saved on this device')}>
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
      </div>
    </div>
  );
}
