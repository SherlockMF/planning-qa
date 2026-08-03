import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 轻量原生 select 封装（MVP 阶段足够，避免引入额外依赖）。
 */
export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            "flex h-10 w-full appearance-none rounded-lg border border-input bg-card px-4 py-2 pr-10 text-sm shadow-card transition-smooth hover:border-primary/50 hover:shadow-card-hover focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:shadow-card-hover disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
            className
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60 transition-transform" />
      </div>
    );
  }
);
Select.displayName = "Select";

export { Select };
