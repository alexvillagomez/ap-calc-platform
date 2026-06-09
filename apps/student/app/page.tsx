"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Onboarding from "@/components/Onboarding";

const ACCOUNT_KEY = "ap_calc_account_id";
const DIAG_DONE_KEY = "ap_calc_diagnostic_done";

export default function Home() {
  const router = useRouter();
  // null = not yet checked, true = logged in, false = guest
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const accountId = localStorage.getItem(ACCOUNT_KEY);
    if (accountId) {
      const done = localStorage.getItem(DIAG_DONE_KEY) === "1";
      router.replace(done ? "/demo-practice" : "/demo");
    } else {
      setIsLoggedIn(false);
    }
  }, [router]);

  // While we check localStorage show nothing (avoids flash)
  if (isLoggedIn === null) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-white" />
    );
  }

  return <Onboarding />;
}
