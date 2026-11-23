import { useAuth } from '@/auth/AuthProvider';
import { backend } from '@/services';
import { useAsync } from '@/hooks/useAsync';
import { useT } from '@/i18n/I18nProvider';
import { Card } from '@/components/ui/Card';
import { ErrorNote, PageHeader } from '@/components/ui/misc';
import { ShiftsTable } from '@/components/dashboard/ShiftsTable';

export function MyShifts() {
  const { profile } = useAuth();
  const t = useT();
  const { data, loading, error } = useAsync(
    () => backend.listShifts({ employeeId: profile!.id, limit: 300 }),
    [profile?.id],
    { live: ['shifts'] },
  );

  return (
    <div>
      <PageHeader title={t('My shifts')} description={t('Your complete shift history. Completed shifts are permanent and cannot be edited.')} />
      {error && <ErrorNote message={error} className="mb-4" />}
      <Card className="overflow-hidden">
        <ShiftsTable shifts={data} loading={loading} />
      </Card>
    </div>
  );
}
