import { Download, FilterX } from 'lucide-react';
import { useState } from 'react';
import { backend, errorMessage } from '@/services';
import { useAsync } from '@/hooks/useAsync';
import { addDays, todayStr } from '@/lib/format';
import { shiftSeconds, shiftVisitors } from '@/lib/shifts';
import { t } from '@/i18n';
import { useT } from '@/i18n/I18nProvider';
import { downloadCsv, toCsv } from '@/utils/csv';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ErrorNote, PageHeader } from '@/components/ui/misc';
import { ShiftsTable } from '@/components/dashboard/ShiftsTable';
import type { Shift, ShiftStatus } from '@/types/domain';

export const shiftCsv = () => [
  { header: t('Employee'), value: (s: Shift) => s.employee_name },
  { header: t('Start'), value: (s: Shift) => s.start_time },
  { header: t('End'), value: (s: Shift) => s.end_time ?? '' },
  { header: t('Duration (min)'), value: (s: Shift) => Math.round(shiftSeconds(s) / 60) },
  { header: t('Men'), value: (s: Shift) => s.male_count },
  { header: t('Women'), value: (s: Shift) => s.female_count },
  { header: t('Total'), value: (s: Shift) => shiftVisitors(s) },
  { header: t('Late') + ' ' + t('Men'), value: (s: Shift) => s.late_male_count },
  { header: t('Late') + ' ' + t('Women'), value: (s: Shift) => s.late_female_count },
  { header: t('Status'), value: (s: Shift) => t(s.status === 'active' ? 'Active' : 'Completed') },
  { header: t('Closed by'), value: (s: Shift) => s.end_reason ? t('Closed by admin') : '' },
];

export default function Shifts() {
  const toast = useToast();
  const t = useT();
  const [employeeId, setEmployeeId] = useState('');
  const [from, setFrom] = useState(addDays(todayStr(), -29));
  const [to, setTo] = useState(todayStr());
  const [status, setStatus] = useState<'' | ShiftStatus>('');

  const employees = useAsync(() => backend.listEmployees(), []);
  const shifts = useAsync(
    () => backend.listShifts({ employeeId: employeeId || undefined, from: from || undefined, to: to || undefined, status: status || undefined, limit: 1000 }),
    [employeeId, from, to, status],
    { live: ['shifts'] },
  );

  const rows = shifts.data ?? [];

  const endShift = async (s: Shift) => {
    try {
      await backend.endShift(s.id);
      toast.success(t('Shift closed'), `${s.employee_name}.`);
    } catch (e) {
      toast.error(t('Could not close shift'), errorMessage(e));
    }
  };

  return (
    <div>
      <PageHeader title={t('Shifts')} description={t('Every shift ever worked. Records are permanent — completed shifts can never be edited or deleted.')}
        actions={
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} disabled={!rows.length}
            onClick={() => downloadCsv(`shifts_${from || 'all'}_${to || 'now'}.csv`, toCsv(rows, shiftCsv()))}>
            {t('Export CSV')}
          </Button>
        } />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr_auto] lg:items-end">
          <Field label={t('Employee')}>
            <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">{t('All employees')}</option>
              {employees.data?.filter((e) => e.role === 'employee').map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </Select>
          </Field>
          <Field label={t('From')}><Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={t('To')}><Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label={t('Status')}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as '' | ShiftStatus)}>
              <option value="">{t('Any status')}</option>
              <option value="active">{t('Active')}</option>
              <option value="completed">{t('Completed')}</option>
            </Select>
          </Field>
          <Button variant="ghost" icon={<FilterX className="h-4 w-4" />} onClick={() => { setEmployeeId(''); setFrom(''); setTo(''); setStatus(''); }}>
            {t('Clear')}
          </Button>
        </div>
      </Card>

      {shifts.error && <ErrorNote message={shifts.error} className="mb-4" />}

      <Card className="overflow-hidden">
        <ShiftsTable shifts={shifts.data} loading={shifts.loading} showEmployee
          actions={(s) => s.status === 'active' && <Button size="sm" variant="danger" onClick={() => endShift(s)}>{t('Force end')}</Button>} />
      </Card>
    </div>
  );
}
