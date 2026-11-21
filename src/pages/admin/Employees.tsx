import { KeyRound, MoreHorizontal, Pencil, Power, UserPlus, Users } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { backend, errorMessage } from '@/services';
import { useAsync } from '@/hooks/useAsync';
import { addDays, formatDate, formatNumber, todayStr } from '@/lib/format';
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
      <Button variant="ghost" size="icon" aria-label="Actions" onClick={() => setOpen((o) => !o)}><MoreHorizontal className="h-4 w-4" /></Button>
      {open && (
        <div className="card absolute right-0 z-20 mt-1 w-48 bg-surface p-1 shadow-xl" onClick={() => setOpen(false)}>
          <button className={item} onClick={onEdit}><Pencil className="h-4 w-4 text-subtle" /> Edit name</button>
          <button className={item} onClick={onPassword}><KeyRound className="h-4 w-4 text-subtle" /> Reset password</button>
          {!self && (
            <button className={cn(item, active ? 'text-danger' : 'text-ok')} onClick={onToggle}>
              <Power className="h-4 w-4" /> {active ? 'Deactivate' : 'Activate'}
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
        toast.success('Employee created', `${form.full_name} can now sign in as “${form.username.toLowerCase()}”.`);
      } else if (dialog.kind === 'edit') {
        await backend.updateEmployee(dialog.user.id, { full_name: form.full_name });
        toast.success('Employee updated');
      } else if (dialog.kind === 'password') {
        await backend.resetPassword(dialog.user.id, form.password);
        toast.success('Password reset', `Share the new password with ${dialog.user.full_name} securely.`);
      } else if (dialog.kind === 'toggle') {
        await backend.setEmployeeActive(dialog.user.id, !dialog.user.is_active);
        toast.success(dialog.user.is_active ? 'Account deactivated' : 'Account activated');
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
      <PageHeader title="Employees" description="Accounts, access and 30-day performance."
        actions={<Button icon={<UserPlus className="h-4 w-4" />} onClick={() => open({ kind: 'create' })}>Add employee</Button>} />
      {users.error && <ErrorNote message={users.error} className="mb-4" />}

      <Card className="overflow-hidden">
        {users.loading && !users.data ? (
          <div className="space-y-2 p-5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : !list.length ? (
          <EmptyState icon={<Users className="h-5 w-5" />} title="No accounts yet" />
        ) : (
          <div className="scrollbar-thin overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Name</th><th>Role</th><th>Status</th>
                  <th className="text-right">Shifts (30d)</th><th className="text-right">Visitors (30d)</th>
                  <th className="text-right">Hours</th><th className="text-right">Visitors / h</th><th>Since</th><th />
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
                      <td><Badge tone={u.role === 'admin' ? 'brand' : 'neutral'}>{u.role === 'admin' ? 'Administrator' : 'Employee'}</Badge></td>
                      <td>
                        {!u.is_active ? <Badge tone="danger">Deactivated</Badge>
                          : onShift.has(u.id) ? <Badge tone="ok" dot>On shift</Badge>
                          : <Badge>Active</Badge>}
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

      <Modal open={dialog?.kind === 'create'} onClose={() => setDialog(null)} title="Add employee" description="The employee signs in with this username and password."
        footer={<><Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button><Button onClick={() => submit()} loading={saving}>Create account</Button></>}>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Full name"><Input required autoFocus value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Asqar Karimov" /></Field>
          <Field label="Username" hint="3–32 characters: a–z, 0–9, dot or underscore">
            <Input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} placeholder="asqar" />
          </Field>
          <Field label="Password" hint="At least 8 characters"><Input required type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          {formError && <ErrorNote message={formError} />}
          <button type="submit" hidden />
        </form>
      </Modal>

      <Modal open={dialog?.kind === 'edit'} onClose={() => setDialog(null)} title="Edit employee"
        footer={<><Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button><Button onClick={() => submit()} loading={saving}>Save</Button></>}>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Full name"><Input required autoFocus value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
          {formError && <ErrorNote message={formError} />}
        </form>
      </Modal>

      <Modal open={dialog?.kind === 'password'} onClose={() => setDialog(null)} title="Reset password"
        description={dialog && 'user' in dialog ? `Set a new password for ${dialog.user.full_name}.` : undefined}
        footer={<><Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button><Button onClick={() => submit()} loading={saving}>Reset password</Button></>}>
        <form onSubmit={submit} className="space-y-4">
          <Field label="New password" hint="At least 8 characters"><Input required autoFocus type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          {formError && <ErrorNote message={formError} />}
        </form>
      </Modal>

      <Modal open={dialog?.kind === 'toggle'} onClose={() => setDialog(null)}
        title={dialog?.kind === 'toggle' && dialog.user.is_active ? 'Deactivate account?' : 'Activate account?'}
        description={dialog?.kind === 'toggle'
          ? dialog.user.is_active
            ? `${dialog.user.full_name} will be signed out and blocked from signing in. Their shift history is kept.`
            : `${dialog.user.full_name} will be able to sign in again.`
          : undefined}
        footer={<>
          <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
          <Button variant={dialog?.kind === 'toggle' && dialog.user.is_active ? 'danger' : 'primary'} onClick={() => submit()} loading={saving}>Confirm</Button>
        </>}>
        {formError && <ErrorNote message={formError} />}
      </Modal>
    </div>
  );
}
