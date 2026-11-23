import { KeyRound, MoreHorizontal, Pencil, Power, UserPlus, Users } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { backend, errorMessage } from '@/services';
import { useAsync } from '@/hooks/useAsync';
import { addDays, formatDate, formatNumber, todayStr } from '@/lib/format';
import { useT } from '@/i18n/I18nProvider';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Field, Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { EmptyState, ErrorNote, PageHeader } from '@/components/ui/misc';
import type { EmployeePerformance, Profile } from '@/types/domain';

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; user: Profile }
  | { kind: 'password'; user: Profile }
  | { kind: 'toggle'; user: Profile }
  | null;

function RowMenu({ onEdit, onPassword, onToggle, active, self }: { onEdit: () => void; onPassword: () => void; onToggle: () => void; active: boolean; self: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-elevated';
  return (
    <div ref={ref} className="relative inline-block">
      <Button variant="ghost" size="icon" aria-label={t('Actions')} onClick={() => setOpen((o) => !o)}><MoreHorizontal className="h-4 w-4" /></Button>
      {open && (
        <div className="card absolute right-0 z-20 mt-1 w-48 bg-surface p-1 shadow-xl" onClick={() => setOpen(false)}>
          <button className={item} onClick={onEdit}><Pencil className="h-4 w-4 text-subtle" /> {t('Edit name')}</button>
          <button className={item} onClick={onPassword}><KeyRound className="h-4 w-4 text-subtle" /> {t('Reset password')}</button>
          {!self && (
            <button className={cn(item, active ? 'text-danger' : 'text-ok')} onClick={onToggle}>
              <Power className="h-4 w-4" /> {active ? t('Deactivate') : t('Activate')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function Employees() {
  const { profile: me } = useAuth();
  const toast = useToast();
  const t = useT();
  const users = useAsync(() => backend.listEmployees(), [], { live: ['settings'] });
  const from = addDays(todayStr(), -29);
  const perf = useAsync(() => backend.getEmployeePerformance(from, todayStr()), [], { live: ['shifts'] });
  const active = useAsync(() => backend.getActiveShifts(), [], { live: ['shifts'] });

  const [dialog, setDialog] = useState<Dialog>(null);
  const [form, setForm] = useState({ username: '', full_name: '', password: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const open = (d: Dialog) => {
    setDialog(d);
    setFormError(null);
    setForm({ username: '', full_name: d && 'user' in d ? d.user.full_name : '', password: '' });
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!dialog) return;
    setSaving(true);
    setFormError(null);
    try {
      if (dialog.kind === 'create') {
        await backend.createEmployee(form);
        toast.success(t('Employee created'), t('{name} can now sign in as “{username}”.', { name: form.full_name, username: form.username.toLowerCase() }));
      } else if (dialog.kind === 'edit') {
        await backend.updateEmployee(dialog.user.id, { full_name: form.full_name });
        toast.success(t('Employee updated'));
      } else if (dialog.kind === 'password') {
        await backend.resetPassword(dialog.user.id, form.password);
        toast.success(t('Password reset'), t('Share the new password with {name} securely.', { name: dialog.user.full_name }));
      } else if (dialog.kind === 'toggle') {
        await backend.setEmployeeActive(dialog.user.id, !dialog.user.is_active);
        toast.success(t(dialog.user.is_active ? 'Account deactivated' : 'Account activated'));
      }
      setDialog(null);
      await users.reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const perfById = new Map<string, EmployeePerformance>((perf.data ?? []).map((p) => [p.employee_id, p]));
  const onShift = new Set(active.data?.map((s) => s.employee_id));
  const list = users.data ?? [];

  return (
    <div>
      <PageHeader title={t('Employees')} description={t('Accounts, access and 30-day performance.')}
        actions={<Button icon={<UserPlus className="h-4 w-4" />} onClick={() => open({ kind: 'create' })}>{t('Add employee')}</Button>} />
      {users.error && <ErrorNote message={users.error} className="mb-4" />}

      <Card className="overflow-hidden">
        {users.loading && !users.data ? (
          <div className="space-y-2 p-5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : !list.length ? (
          <EmptyState icon={<Users className="h-5 w-5" />} title={t('No accounts yet')} />
        ) : (
          <div className="scrollbar-thin overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('Name')}</th><th>{t('Role')}</th><th>{t('Status')}</th>
                  <th className="text-right">{t('Shifts (30d)')}</th><th className="text-right">{t('Visitors (30d)')}</th>
                  <th className="text-right">{t('Hours')}</th><th className="text-right">{t('Visitors / h')}</th><th>{t('Since')}</th><th />
                </tr>
              </thead>
              <tbody>
                {list.map((u) => {
                  const p = perfById.get(u.id);
                  return (
                    <tr key={u.id} className={cn(!u.is_active && 'opacity-60')}>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="grid h-9 w-9 place-items-center rounded-full bg-elevated text-sm font-semibold">{u.full_name.slice(0, 1)}</div>
                          <div>
                            <div className="font-medium">{u.full_name}</div>
                            <div className="text-xs text-subtle">@{u.username}</div>
                          </div>
                        </div>
                      </td>
                      <td><Badge tone={u.role === 'admin' ? 'brand' : 'neutral'}>{u.role === 'admin' ? t('Administrator') : t('Employee')}</Badge></td>
                      <td>
                        {!u.is_active ? <Badge tone="danger">{t('Deactivated')}</Badge>
                          : onShift.has(u.id) ? <Badge tone="ok" dot>{t('On shift')}</Badge>
                          : <Badge>{t('Active')}</Badge>}
                      </td>
                      <td className="text-right tabular notranslate">{u.role === 'employee' ? formatNumber(p?.shifts) : '—'}</td>
                      <td className="text-right font-semibold tabular notranslate">{u.role === 'employee' ? formatNumber(p?.total) : '—'}</td>
                      <td className="text-right tabular notranslate text-muted">{u.role === 'employee' ? (p?.hours ?? 0).toFixed(1) : '—'}</td>
                      <td className="text-right tabular notranslate text-muted">{u.role === 'employee' ? (p?.per_hour ?? 0).toFixed(1) : '—'}</td>
                      <td className="text-muted">{formatDate(u.created_at)}</td>
                      <td className="text-right">
                        <RowMenu active={u.is_active} self={u.id === me?.id}
                          onEdit={() => open({ kind: 'edit', user: u })}
                          onPassword={() => open({ kind: 'password', user: u })}
                          onToggle={() => open({ kind: 'toggle', user: u })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={dialog?.kind === 'create'} onClose={() => setDialog(null)} title={t('Add employee')} description={t('The employee signs in with this username and password.')}
        footer={<><Button variant="ghost" onClick={() => setDialog(null)}>{t('Cancel')}</Button><Button onClick={() => submit()} loading={saving}>{t('Create account')}</Button></>}>
        <form onSubmit={submit} className="space-y-4">
          <Field label={t('Full name')}><Input required autoFocus value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Asqar Karimov" /></Field>
          <Field label={t('Username')} hint={t('3–32 characters: a–z, 0–9, dot or underscore')}>
            <Input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} placeholder="asqar" />
          </Field>
          <Field label={t('Password')} hint={t('At least 8 characters')}><Input required type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          {formError && <ErrorNote message={formError} />}
          <button type="submit" hidden />
        </form>
      </Modal>

      <Modal open={dialog?.kind === 'edit'} onClose={() => setDialog(null)} title={t('Edit employee')}
        footer={<><Button variant="ghost" onClick={() => setDialog(null)}>{t('Cancel')}</Button><Button onClick={() => submit()} loading={saving}>{t('Save')}</Button></>}>
        <form onSubmit={submit} className="space-y-4">
          <Field label={t('Full name')}><Input required autoFocus value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
          {formError && <ErrorNote message={formError} />}
        </form>
      </Modal>

      <Modal open={dialog?.kind === 'password'} onClose={() => setDialog(null)} title={t('Reset password')}
        description={dialog && 'user' in dialog ? t('Set a new password for {name}.', { name: dialog.user.full_name }) : undefined}
        footer={<><Button variant="ghost" onClick={() => setDialog(null)}>{t('Cancel')}</Button><Button onClick={() => submit()} loading={saving}>{t('Reset password')}</Button></>}>
        <form onSubmit={submit} className="space-y-4">
          <Field label={t('New password')} hint={t('At least 8 characters')}><Input required autoFocus type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          {formError && <ErrorNote message={formError} />}
        </form>
      </Modal>

      <Modal open={dialog?.kind === 'toggle'} onClose={() => setDialog(null)}
        title={dialog?.kind === 'toggle' && dialog.user.is_active ? t('Deactivate account?') : t('Activate account?')}
        description={dialog?.kind === 'toggle'
          ? dialog.user.is_active
            ? t('{name} will be signed out and blocked from signing in. Their shift history is kept.', { name: dialog.user.full_name })
            : t('{name} will be able to sign in again.', { name: dialog.user.full_name })
          : undefined}
        footer={<>
          <Button variant="ghost" onClick={() => setDialog(null)}>{t('Cancel')}</Button>
          <Button variant={dialog?.kind === 'toggle' && dialog.user.is_active ? 'danger' : 'primary'} onClick={() => submit()} loading={saving}>{t('Confirm')}</Button>
        </>}>
        {formError && <ErrorNote message={formError} />}
      </Modal>
    </div>
  );
}
