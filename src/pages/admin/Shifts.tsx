import { Download, FilterX } from 'lucide-react';
import { useState } from 'react';
import { backend, errorMessage } from '@/services';
import { useAsync } from '@/hooks/useAsync';
import { addDays, formatNumber, todayStr } from '@/lib/format';
import { downloadCsv, toCsv } from '@/utils/csv';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ErrorNote, PageHeader } from '@/components/ui/misc';
import { ShiftsTable } from '@/components/dashboard/ShiftsTable';
import type { Shift, ShiftStatus } from '@/types/domain';

export const SHIFT_CSV = [
  { header: 'Employee', value: (s: Shift) => s.employee_name },
  { header: 'Start', value: (s: Shift) => s.start_time },
  { header: 'End', value: (s: Shift) => s.end_time },
  { header: 'Duration (min)', value: (s: Shift) => (s.duration_seconds == null ? '' : Math.round(s.duration_seconds / 60)) },
  { header: 'Men', value: (s: Shift) => s.male_count },
  { header: 'Women', value: (s: Shift) => s.female_count },
  { header: 'Total', value: (s: Shift) => s.total_count },
  { header: 'Late synced (men)', value: (s: Shift) => s.late_male_count },
  { header: 'Late synced (women)', value: (s: Shift) => s.late_female_count },
  { header: 'Status', value: (s: Shift) => s.status },
  { header: 'Closed by', value: (s: Shift) => s.end_reason ?? '' },
];

export default function Shifts() {
  const toast = useToast();
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
  const totals = rows.reduce((a, s) => ({ m: a.m + s.male_count, f: a.f + s.female_count }), { m: 0, f: 0 });

  const endShift = async (s: Shift) => {
    try {
      await backend.endShift(s.id);
      toast.success('Shift closed', `${s.employee_name}'s shift was ended by admin.`);
    } catch (e) {
      toast.error('Could not close shift', errorMessage(e));
    }
  };

  return (
    <div>
      <PageHeader title="Shifts" description="Every shift ever worked. Records are permanent — completed shifts can never be edited or deleted."
        actions={
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} disabled={!rows.length}
            onClick={() => downloadCsv(`shifts_${from || 'all'}_${to || 'now'}.csv`, toCsv(rows, SHIFT_CSV))}>
            Export CSV
          </Button>
        } />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr_auto] lg:items-end">
          <Field label="Employee">
            <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">All employees</option>
              {employees.data?.filter((e) => e.role === 'employee').map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </Select>
          </Field>
          <Field label="From"><Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as '' | ShiftStatus)}>
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
            </Select>
          </Field>
          <Button variant="ghost" icon={<FilterX className="h-4 w-4" />} onClick={() => { setEmployeeId(''); setFrom(''); setTo(''); setStatus(''); }}>
            Clear
          </Button>
        </div>
      </Card>

      {shifts.error && <ErrorNote message={shifts.error} className="mb-4" />}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b px-5 py-3 text-[13px] text-subtle">
          <span><b className="font-semibold text-fg">{rows.length}</b> shifts</span>
          <span>Men <b className="font-semibold text-male">{formatNumber(totals.m)}</b></span>
          <span>Women <b className="font-semibold text-female">{formatNumber(totals.f)}</b></span>
          <span>Total <b className="font-semibold text-fg">{formatNumber(totals.m + totals.f)}</b></span>
        </div>
        <ShiftsTable shifts={shifts.data} loading={shifts.loading} showEmployee
          actions={(s) => s.status === 'active' && <Button size="sm" variant="danger" onClick={() => endShift(s)}>Force end</Button>} />
      </Card>
    </div>
  );
}
