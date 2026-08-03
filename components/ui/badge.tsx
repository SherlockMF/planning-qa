import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold leading-4 transition-smooth focus:outline-none shadow-card",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-border/60 bg-secondary text-secondary-foreground",
        destructive:
          "border-destructive-border bg-destructive-surface text-destructive",
        outline: "border-border/60 bg-card text-foreground",
        success:
          "border-success-border bg-success-surface text-success-foreground",
        warning:
          "border-warning-border bg-warning-surface text-warning-foreground",
        info: "border-info-border bg-info-surface text-info-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
