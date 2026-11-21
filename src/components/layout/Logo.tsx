import { cn } from '@/lib/cn';

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn('grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand to-[#4f3fd8] shadow-glow', className)}>
      <svg viewBox="0 0 24 24" className="h-[55%] w-[55%]" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="2.2" />
        <path d="M12 9.8V3.5M13.9 13.1l5.5 3.2M10.1 13.1l-5.5 3.2" />
      </svg>
    </div>
  );
}

export function Wordmark({ sub }: { sub?: string }) {
  return (
    <div className="flex items-center gap-3">
      <Logo />
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight">Smart Restroom</div>
        {sub && <div className="text-[11px] text-subtle">{sub}</div>}
      </div>
    </div>
  );
}
