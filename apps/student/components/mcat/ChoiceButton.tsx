import { cn } from "@/lib/cn";
import MathText from "@/components/mcat/MathText";

const LABELS = ["A", "B", "C", "D"];

type ChoiceState = "default" | "selected" | "correct" | "wrong" | "dimmed";

interface ChoiceButtonProps {
  index: number;
  text: string;
  state: ChoiceState;
  disabled?: boolean;
  onClick: () => void;
}

export function ChoiceButton({
  index,
  text,
  state,
  disabled = false,
  onClick,
}: ChoiceButtonProps) {
  const containerCls = cn(
    "w-full flex items-start gap-3 px-4 py-3 rounded-xl border text-left transition-colors duration-150",
    state === "correct" && "bg-success-50 border-success-500 cursor-default",
    state === "wrong"   && "bg-error-50 border-error-500 cursor-default",
    state === "selected" && "border-brand-500 bg-brand-50 text-brand-800",
    state === "dimmed"  && "border-neutral-200 text-neutral-400 cursor-default",
    state === "default" && !disabled && "bg-white border-neutral-200 hover:border-brand-400 hover:bg-brand-50 cursor-pointer",
    state === "default" && disabled  && "bg-white border-neutral-200 cursor-default"
  );

  const badgeCls = cn(
    "flex-shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold mt-0.5 transition-colors duration-150",
    state === "correct"  && "bg-success-500 border-success-500 text-white",
    state === "wrong"    && "bg-error-500 border-error-500 text-white",
    state === "selected" && "border-brand-500 text-brand-700",
    state === "dimmed"   && "border-neutral-200 text-neutral-300",
    state === "default"  && "border-neutral-300 text-neutral-500"
  );

  // Keep the A/B/C/D label always — the green/red badge fill conveys correctness,
  // so no inline check/cross glyph is needed.
  const badgeContent = LABELS[index];

  return (
    <button
      className={containerCls}
      disabled={disabled}
      onClick={onClick}
    >
      <span className={badgeCls}>{badgeContent}</span>
      <span className="flex-1 min-w-0 pt-0.5 text-sm leading-relaxed">
        <MathText>{text}</MathText>
      </span>
    </button>
  );
}
