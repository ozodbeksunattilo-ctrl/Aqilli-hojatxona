import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

const control =
  'h-10 w-full rounded-xl border bg-surface px-3.5 text-sm text-fg placeholder:text-subtle transition-colors focus:border-brand/60 focus:outline-none focus:ring-4 focus:ring-brand/10 disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { leading?: ReactNode }>(
  ({ className, leading, ...rest }, ref) =>
    leading ? (
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle">{leading}</span>
        <input ref={ref} className={cn(control, 'pl-10', className)} {...rest} />
      </div>
    ) : (
      <input ref={ref} className={cn(control, className)} {...rest} />
    ),
);
Input.displayName = 'Input';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...rest }, ref) => (
  <div className={cn('relative', className)}>
    <select ref={ref} className={cn(control, 'cursor-pointer appearance-none pr-9')} {...rest}>
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
  </div>
));
Select.displayName = 'Select';

export function Field({ label, hint, error, children, className }: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-muted">{label}</span>
      {children}
      {error ? <span className="mt-1.5 block text-xs text-danger">{error}</span> : hint && <span className="mt-1.5 block text-xs text-subtle">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-6 py-3 text-left disabled:opacity-50">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-[13px] text-subtle">{description}</span>}
      </span>
      <span className={cn('relative inline-flex h-6 w-11 shrink-0 rounded-full border transition-colors', checked ? 'border-brand bg-brand' : 'bg-elevated')}>
        <span className={cn('absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
}) {
  return (
    <div className={cn('inline-flex rounded-xl border bg-elevated p-1', className)}>
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={cn('rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
            value === o.value ? 'bg-surface text-fg shadow-sm' : 'text-subtle hover:text-fg')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
