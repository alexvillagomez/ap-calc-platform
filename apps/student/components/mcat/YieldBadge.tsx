type YieldLevel = "high" | "medium" | "low";

interface YieldBadgeProps {
  level: YieldLevel | null | undefined;
}

export function YieldBadge({ level }: YieldBadgeProps) {
  if (!level) return null;

  const styles: Record<YieldLevel, string> = {
    high: "bg-amber-50 text-amber-700 border border-amber-200",
    medium: "bg-gray-100 text-gray-600 border border-gray-200",
    low: "bg-gray-50 text-gray-400 border border-gray-100",
  };

  const labels: Record<YieldLevel, string> = {
    high: "High yield",
    medium: "Med yield",
    low: "Low yield",
  };

  return (
    <span
      title={level}
      className={`inline-flex items-center text-xs px-1.5 py-0.5 rounded-full shrink-0 ${styles[level]}`}
    >
      {labels[level]}
    </span>
  );
}
