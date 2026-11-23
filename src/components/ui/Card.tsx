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
    <div className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 pt-5 sm:flex-nowrap sm:px-6', className)}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {icon && <div className="icon-tile tone-brand h-10 w-10 rounded-xl [&_svg]:h-[19px] [&_svg]:w-[19px]">{icon}</div>}
        <div className="min-w-0">
          <h3 className="text-[15px] leading-snug sm:truncate font-semibold tracking-tight">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[13px] sm:truncate text-subtle">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="max-w-full shrink-0">{action}</div>}
    </div>
  );
}

export const CardBody = ({ className, ...rest }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('px-5 pb-5 pt-4 sm:px-6', className)} {...rest} />
);
