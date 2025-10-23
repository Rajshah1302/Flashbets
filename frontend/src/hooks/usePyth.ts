/* eslint-disable prefer-const */
"use client";

import { useEffect, useState } from "react";
import { HERMES_HTTP, canonId, pickPriceFromHermesObject } from "@/lib/market";

export default function usePythLatestREST(feedIdsCanonical: string[], intervalMs = 1000) {
  const [prices, setPrices] = useState<Record<string, number>>({}); // canonical keys

  useEffect(() => {
    if (!feedIdsCanonical.length) return;
    let timer: ReturnType<typeof setInterval> | undefined;

    const fetchOnce = async () => {
      try {
        const u = new URL("/v2/updates/price/latest", HERMES_HTTP);
        for (const id of feedIdsCanonical) u.searchParams.append("ids[]", "0x" + canonId(id));
        u.searchParams.set("parsed", "true");

        const res = await fetch(u.toString(), { cache: "no-store" });
        if (!res.ok) return;

        const data = await res.json();
        const parsed = Array.isArray(data?.parsed) ? data.parsed : data?.price_feeds || data?.feeds || [];
        setPrices((prev) => {
          const next = { ...prev };
          for (const entry of parsed) {
            const pr = pickPriceFromHermesObject(entry);
            if (pr?.id && typeof pr.price === "number") next[canonId(pr.id)] = pr.price;
          }
          return next;
        });
      } catch { /* swallow */ }
    };

    fetchOnce();
    timer = setInterval(fetchOnce, intervalMs);
    return () => { if (timer) clearInterval(timer); };
  }, [JSON.stringify(feedIdsCanonical), intervalMs]);

  return prices;
}
