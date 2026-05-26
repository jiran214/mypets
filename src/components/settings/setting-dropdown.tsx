import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function SettingDropdown({
  value,
  disabled,
  children,
  menuClassName,
}: {
  value: string;
  disabled: boolean;
  children: ReactNode;
  menuClassName?: string;
}): ReactNode {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="outline"
          className="h-8 w-full justify-between px-2.5 font-normal"
        >
          <span className="min-w-0 truncate text-left">{value}</span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={4}
        className={cn('min-w-[var(--radix-dropdown-menu-trigger-width)]', menuClassName)}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
