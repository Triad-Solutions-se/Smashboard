"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const ENDPOINT = "https://portal.triadsolutions.se/api/analytics/track";

function getSessionId(): string {
  let sid = sessionStorage.getItem("triad_sid");
  if (!sid) {
    sid = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).slice(0, 16);
    sessionStorage.setItem("triad_sid", sid);
  }
  return sid;
}

export default function AnalyticsBeacon() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    const search = searchParams?.toString();
    const payload = JSON.stringify({
      app_slug: "Smashboard",
      path: pathname + (search ? `?${search}` : ""),
      referrer: document.referrer || null,
      session_id: getSessionId(),
    });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "application/json" }));
      } else {
        fetch(ENDPOINT, {
          method: "POST",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: payload,
        }).catch(() => {});
      }
    } catch {}
  }, [pathname, searchParams]);

  return null;
}
