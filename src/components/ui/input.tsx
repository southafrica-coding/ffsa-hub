import * as React from "react";
import { cn } from "@/lib/utils/cn";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input data-slot="input"
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-rule-strong bg-bg px-3 text-body text-ink file:border-0 file:bg-transparent file:text-ui file:font-medium placeholder:text-[color:var(--text-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
