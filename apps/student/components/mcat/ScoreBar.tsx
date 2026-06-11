interface ScoreBarProps {
  pct: number; // 0–100
  className?: string;
}

export function ScoreBar({ pct, className = "" }: ScoreBarProps) {
  const color =
    pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-yellow-400" : "bg-red-400";
  return (
    <div className={`h-2 bg-gray-100 rounded-full overflow-hidden ${className}`}>
      <div
        className={`h-full ${color} rounded-full transition-all`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}
