import { NextResponse } from "next/server";

type HoosatPriceResponse = {
  price: number;
};

const SUPPORTED_CURRENCIES = [
  "AED",
  "AFN",
  "ALL",
  "AMD",
  "ANG",
  "AOA",
  "ARS",
  "AUD",
  "AWG",
  "AZN",
  "BAM",
  "BBD",
  "BDT",
  "BIF",
  "BMD",
  "BND",
  "BOB",
  "BRL",
  "BSD",
  "BWP",
  "BYN",
  "BZD",
  "CAD",
  "CDF",
  "CHF",
  "CLP",
  "CNY",
  "COP",
  "CRC",
  "CVE",
  "CZK",
  "DJF",
  "DKK",
  "DOP",
  "DZD",
  "EGP",
  "ETB",
  "EUR",
  "FJD",
  "FKP",
  "GBP",
  "GEL",
  "GIP",
  "GMD",
  "GNF",
  "GTQ",
  "GYD",
  "HKD",
  "HNL",
  "HTG",
  "HUF",
  "IDR",
  "ILS",
  "INR",
  "ISK",
  "JMD",
  "JPY",
  "KES",
  "KGS",
  "KHR",
  "KMF",
  "KRW",
  "KYD",
  "KZT",
  "LAK",
  "LBP",
  "LKR",
  "LRD",
  "LSL",
  "MAD",
  "MDL",
  "MGA",
  "MKD",
  "MMK",
  "MNT",
  "MOP",
  "MUR",
  "MVR",
  "MWK",
  "MXN",
  "MYR",
  "MZN",
  "NAD",
  "NGN",
  "NIO",
  "NOK",
  "NPR",
  "NZD",
  "PAB",
  "PEN",
  "PGK",
  "PHP",
  "PKR",
  "PLN",
  "PYG",
  "QAR",
  "RON",
  "RSD",
  "RUB",
  "RWF",
  "SAR",
  "SBD",
  "SCR",
  "SEK",
  "SGD",
  "SHP",
  "SLE",
  "SOS",
  "SRD",
  "STD",
  "SZL",
  "THB",
  "TJS",
  "TOP",
  "TRY",
  "TTD",
  "TWD",
  "TZS",
  "UAH",
  "UGX",
  "USD",
  "UYU",
  "UZS",
  "VND",
  "VUV",
  "WST",
  "XAF",
  "XCD",
  "XCG",
  "XOF",
  "XPF",
  "YER",
  "ZAR",
  "ZMW",
] as const;

type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
type FxRates = Record<SupportedCurrency, number>;

type FxApiResponse = {
  base_code: string;
  result?: string;
  rates: Record<string, number>;
};

const FX_RATE_ALIASES: Partial<Record<SupportedCurrency, string>> = {
  STD: "STN",
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return (await response.json()) as T;
}

function buildFxApiUrl(): string {
  return "https://open.er-api.com/v6/latest/USD";
}

function getFxRate(response: FxApiResponse, currency: SupportedCurrency): number | undefined {
  const directRate = response.rates[currency];
  if (typeof directRate === "number") {
    return directRate;
  }

  const alias = FX_RATE_ALIASES[currency];
  if (!alias) {
    return undefined;
  }

  const aliasedRate = response.rates[alias];
  return typeof aliasedRate === "number" ? aliasedRate : undefined;
}

function pickSupportedRates(response: FxApiResponse): FxRates {
  if (response.result !== "success") {
    throw new Error("FX API returned a non-success result");
  }

  if (response.base_code !== "USD") {
    throw new Error("FX API base mismatch");
  }

  const rates = {} as FxRates;

  for (const currency of SUPPORTED_CURRENCIES) {
    const rate = getFxRate(response, currency);
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Missing or invalid FX rate for USD/${currency}`);
    }

    rates[currency] = rate;
  }

  return rates;
}

function buildPricesPerHtn(usdPerHtn: number, usdRates: FxRates): FxRates {
  const prices = {} as FxRates;

  for (const currency of SUPPORTED_CURRENCIES) {
    prices[currency] = usdPerHtn * usdRates[currency];
  }

  return prices;
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

    const [hoosat, usdFxResponse] = await Promise.all([
      fetchJson<HoosatPriceResponse>("https://api.network.hoosat.fi/info/price?stringOnly=false", {
        headers: { accept: "application/json" },
        // Cache at the framework level when supported.
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        next: { revalidate: 30 },
      }),
      fetchJson<FxApiResponse>(buildFxApiUrl(), {
        headers: { accept: "application/json" },
        // Cache at the framework level when supported.
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        next: { revalidate: 60 },
      }),
    ]);

    const usdPerHtn = hoosat?.price;
    if (typeof usdPerHtn !== "number" || !Number.isFinite(usdPerHtn) || usdPerHtn <= 0) {
      throw new Error("Invalid Hoosat price response");
    }

    const usdRates = pickSupportedRates(usdFxResponse);

    const adjustedUsdPerHtn = usdPerHtn * adjustmentMultiplier;
    const pricesPerHtn = buildPricesPerHtn(adjustedUsdPerHtn, usdRates);

    return NextResponse.json(
      {
        pricesPerHtn,
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
