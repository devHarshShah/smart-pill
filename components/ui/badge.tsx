import * as React from 'react';

import { cn } from '@/lib/utils';

type BadgeProps = React.HTMLAttributes<HTMLDivElement> & {
  tone?: 'default' | 'success' | 'warn';
};

const tones = {
  default: 'bg-cyan-900/40 text-cyan-200 border border-cyan-800',
  success: 'bg-emerald-900/40 text-emerald-200 border border-emerald-800',
  warn: 'bg-amber-900/40 text-amber-200 border border-amber-800',
};

export function Badge({ className, tone = 'default', ...props }: BadgeProps) {
  return (
    <div
      className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', tones[tone], className)}
      {...props}
    />
  );
}
