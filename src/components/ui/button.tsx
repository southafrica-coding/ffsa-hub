import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-ui font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border border-brand-black bg-brand-black text-bg hover:bg-brand-black/90",
        destructive: "border border-danger bg-transparent text-danger hover:bg-danger hover:text-bg",
        outline: "border border-rule-strong bg-bg text-ink hover:bg-bg-subtle",
        secondary: "bg-bg-subtle text-ink hover:bg-border",
        ghost: "text-[color:var(--text-secondary)] hover:bg-bg-subtle hover:text-ink",
        link: "text-link underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-3",
        sm: "h-8 px-2.5",
        lg: "h-11 px-4",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        data-slot="button"
        data-variant={variant ?? "default"}
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
