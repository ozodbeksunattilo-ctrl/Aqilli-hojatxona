import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const Card = ({ className, ...rest }: HTMLAttributes<HTMLDivElement>) => <div className={cn('card', className)} {...rest} />;

export function CardHeader({ title, subtitle, action, icon, className }: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-5 pt-5 sm:px-6', className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icon && <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border bg-elevated text-muted">{icon}</div>}
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold tracking-tight">{title}</h3>
          {subtitle && <p className="mt-0.5 truncate text-[13px] text-subtle">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export const CardBody = ({ className, ...rest }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('px-5 pb-5 pt-4 sm:px-6', className)} {...rest} />
);
