interface LoadingPanelProps {
  message: string;
  sub?: string;
}

export function LoadingPanel({ message, sub }: LoadingPanelProps) {
  return (
    <div className="flex flex-col items-center justify-center py-32 gap-4">
      <div className="relative w-12 h-12">
        <div className="w-12 h-12 rounded-full border-4 border-brand-100" />
        <div className="absolute inset-0 w-12 h-12 rounded-full border-4 border-brand-500 border-t-transparent animate-spin" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-neutral-700">{message}</p>
        {sub && <p className="text-xs text-neutral-400 mt-1">{sub}</p>}
      </div>
    </div>
  );
}
