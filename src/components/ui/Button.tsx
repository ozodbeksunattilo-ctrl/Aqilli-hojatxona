import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand/90 shadow-[0_1px_0_0_rgb(255_255_255/0.15)_inset,0_8px_24px_-8px_rgb(var(--brand)/0.6)]',
  secondary: 'bg-elevated text-fg border hover:bg-line/60',
  ghost: 'text-muted hover:text-fg hover:bg-elevated',
  danger: 'bg-danger/10 text-danger border border-danger/25 hover:bg-danger/15',
  success: 'bg-ok text-white hover:bg-ok/90 shadow-[0_8px_24px_-8px_rgb(var(--ok)/0.6)]',
};
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-[15px] gap-2.5 rounded-xl',
  icon: 'h-9 w-9 rounded-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center font-medium transition-all duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4" /> : icon}
      {children != null && children !== false && <span className="contents">{children}</span>}
    </button>
  ),
);
Button.displayName = 'Button';
