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
  let containerCls =
    "w-full flex items-start gap-3 px-4 py-3 rounded-xl border text-left transition-colors ";
  let badgeCls =
    "flex-shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold mt-0.5 ";

  switch (state) {
    case "correct":
      containerCls += "bg-green-50 border-green-400 cursor-default";
      badgeCls += "bg-green-500 border-green-500 text-white";
      break;
    case "wrong":
      containerCls += "bg-red-50 border-red-400 cursor-default";
      badgeCls += "bg-red-500 border-red-500 text-white";
      break;
    case "selected":
      containerCls += "border-blue-500 bg-blue-50 text-blue-800";
      badgeCls += "border-blue-500 text-blue-700";
      break;
    case "dimmed":
      containerCls += "border-gray-200 text-gray-400 cursor-default";
      badgeCls += "border-gray-200 text-gray-300";
      break;
    default:
      containerCls += disabled
        ? "border-gray-200 cursor-default bg-white"
        : "bg-white border-gray-200 hover:border-blue-400 hover:bg-blue-50 cursor-pointer";
      badgeCls += "border-gray-300 text-gray-500";
  }

  const badgeContent =
    state === "correct" ? "✓" : state === "wrong" ? "✗" : LABELS[index];

  return (
    <button
      className={containerCls}
      disabled={disabled}
      onClick={onClick}
    >
      <span className={badgeCls}>{badgeContent}</span>
      <span className="flex-1 min-w-0 pt-0.5 text-sm leading-relaxed whitespace-pre-line">
        {text}
      </span>
    </button>
  );
}
