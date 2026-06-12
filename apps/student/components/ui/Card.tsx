/**
 * Lodera Card — clean white card with subtle brand shadow.
 * Accepts optional `hover` prop for an elevated hover state.
 */
import { forwardRef, HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Elevate on hover (useful for clickable cards) */
  hover?: boolean;
  /** Remove default padding */
  noPadding?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  function Card({ hover = false, noPadding = false, className, children, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          "bg-white rounded-xl border border-neutral-200 shadow-brand-xs overflow-hidden",
          !noPadding && "p-5",
          hover &&
            "transition-shadow duration-150 hover:shadow-brand-md hover:border-brand-200",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

export default Card;
