import { NextResponse } from "next/server";

type HoosatPriceResponse = {
  price: number;
};

type FrankfurterResponse = {
  base: string;
  rates: Record<string, number>;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return (await response.json()) as T;
}

export async function GET() {
  try {
    const adjustmentPercentRaw = process.env.LIVE_RATE_ADJUST_PERCENT ?? "0";
    const adjustmentPercent = Number.parseFloat(adjustmentPercentRaw);
    const adjustmentMultiplier = Number.isFinite(adjustmentPercent) ? 1 + adjustmentPercent / 100 : NaN;

    if (!Number.isFinite(adjustmentMultiplier)) {
      throw new Error("Invalid LIVE_RATE_ADJUST_PERCENT; expected a number");
    }

    if (adjustmentMultiplier <= 0) {
      throw new Error("Invalid LIVE_RATE_ADJUST_PERCENT; results in non-positive multiplier");
    }

    const [hoosat, fx] = await Promise.all([
      fetchJson<HoosatPriceResponse>("https://api.network.hoosat.fi/info/price?stringOnly=false", {
        headers: { accept: "application/json" },
        // Cache at the framework level when supported.
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        next: { revalidate: 30 },
      }),
      fetchJson<FrankfurterResponse>("https://api.frankfurter.app/latest?from=USD&to=EUR", {
        headers: { accept: "application/json" },
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        next: { revalidate: 60 },
      }),
    ]);

    const usdPerHtn = hoosat?.price;
    if (typeof usdPerHtn !== "number" || !Number.isFinite(usdPerHtn) || usdPerHtn <= 0) {
      throw new Error("Invalid Hoosat price response");
    }

    const usdToEur = fx?.rates?.EUR;
    if (typeof usdToEur !== "number" || !Number.isFinite(usdToEur) || usdToEur <= 0) {
      throw new Error("Invalid FX rate response");
    }

    const adjustedUsdPerHtn = usdPerHtn * adjustmentMultiplier;
    const eurPerHtn = adjustedUsdPerHtn * usdToEur;

    return NextResponse.json(
      {
        usdPerHtn: adjustedUsdPerHtn,
        eurPerHtn,
        usdToEur,
        liveRateAdjustmentPercent: adjustmentPercent,
        updatedAt: new Date().toISOString(),
        sources: {
          hoosat: "https://api.network.hoosat.fi/info/price?stringOnly=false",
          fx: "https://api.frankfurter.app/latest?from=USD&to=EUR",
        },
      },
      {
        headers: {
          // Cache for CDNs/proxies, but allow quick refresh.
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: (error as Error).message ?? "Failed to fetch price",
      },
      {
        status: 502,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
