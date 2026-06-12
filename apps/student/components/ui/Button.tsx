/**
 * Lodera Button — primary / secondary / ghost variants, sm / md / lg sizes.
 * Loading state shows an animated spinner and disables interaction.
 * Tailwind-only, no new dependencies.
 */
import { forwardRef, ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize    = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-500 text-white hover:bg-brand-600 focus-visible:ring-brand-400 " +
    "shadow-brand-sm active:scale-[0.98]",
  secondary:
    "bg-white text-neutral-800 border border-neutral-200 hover:bg-neutral-50 " +
    "focus-visible:ring-brand-400 shadow-brand-xs active:scale-[0.98]",
  ghost:
    "bg-transparent text-brand-600 hover:bg-brand-50 focus-visible:ring-brand-400 " +
    "active:scale-[0.98]",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm:  "h-7  px-3   text-xs  rounded-lg  gap-1.5",
  md:  "h-9  px-4   text-sm  rounded-xl  gap-2",
  lg:  "h-11 px-5   text-sm  rounded-xl  gap-2   font-semibold",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      className,
      children,
      ...props
    },
    ref
  ) {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        aria-busy={loading}
        className={cn(
          "inline-flex items-center justify-center font-medium",
          "transition-all duration-150 select-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
          "disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none",
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        {...props}
      >
        {loading && (
          <span
            className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0"
            aria-hidden="true"
          />
        )}
        {children}
      </button>
    );
  }
);

export default Button;
