"use client";

import { LoderaLogo, BarChartIcon } from "./icons";

interface TopBarProps {
  initials: string;
  onOpenProgress: () => void;
  onToggleProfile: () => void;
}

export function TopBar({ initials, onOpenProgress, onToggleProfile }: TopBarProps) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 22px",
        borderBottom: "1px solid #e5e5e5",
        background: "#fff",
      }}
    >
      <LoderaLogo />
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button
          type="button"
          onClick={onOpenProgress}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            height: 38,
            padding: "0 14px",
            border: "1px solid #e5e5e5",
            background: "#fff",
            color: "#4f46e5",
            fontSize: 13,
            fontWeight: 600,
            borderRadius: 11,
            cursor: "pointer",
            boxShadow: "0 1px 3px 0 rgba(59,130,246,.08)",
          }}
        >
          <BarChartIcon size={16} />
          My progress
        </button>
        <button
          type="button"
          onClick={onToggleProfile}
          title="Profile"
          style={{
            width: 38,
            height: 38,
            borderRadius: 9999,
            border: "1px solid rgba(0,0,0,.04)",
            background: "linear-gradient(135deg,#38bdf8,#6366f1)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 600,
            fontSize: 12.5,
            cursor: "pointer",
          }}
        >
          {initials}
        </button>
      </div>
    </header>
  );
}
