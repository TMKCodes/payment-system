import { NextRequest, NextResponse } from "next/server";
import { HoosatCrypto } from "hoosat-sdk";

import { shopifyGraphql, normalizeShopDomain } from "@/lib/shopify/admin";
import { getShopAccessToken } from "@/lib/shopify/shopStore";
import { divideDecimalStrings } from "@/lib/decimal";
import { checkPaymentStatus } from "@/lib/htn/paymentTracker";

export const runtime = "nodejs";

type OrderQueryResult = {
  order: null | {
    id: string;
    name: string;
    displayFinancialStatus: string;
    totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  };
};

async function fetchLiveRates(origin: string): Promise<{ usdPerHtn: number; eurPerHtn: number }> {
  const response = await fetch(new URL("/api/price", origin).toString(), { method: "GET" });
  if (!response.ok) {
    throw new Error(`Failed to load live rates (${response.status})`);
  }
  const json = (await response.json()) as { usdPerHtn: number; eurPerHtn: number };
  if (typeof json.usdPerHtn !== "number" || !Number.isFinite(json.usdPerHtn) || json.usdPerHtn <= 0) {
    throw new Error("Invalid usdPerHtn");
  }
  if (typeof json.eurPerHtn !== "number" || !Number.isFinite(json.eurPerHtn) || json.eurPerHtn <= 0) {
    throw new Error("Invalid eurPerHtn");
  }
  return json;
}

export async function GET(request: NextRequest) {
  try {
    const shop = normalizeShopDomain(request.nextUrl.searchParams.get("shop") ?? "");
    const orderIdRaw = request.nextUrl.searchParams.get("orderId") ?? "";
    const orderId = Number.parseInt(orderIdRaw, 10);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return NextResponse.json({ error: "Invalid orderId" }, { status: 400 });
    }

    const accessToken = await getShopAccessToken(shop);
    if (!accessToken) {
      return NextResponse.json(
        {
          error:
            "No Shopify access token for this shop. Either install via /api/shopify/install?shop=... or set SHOPIFY_SHOP_DOMAIN + SHOPIFY_ADMIN_ACCESS_TOKEN.",
        },
        { status: 401 },
      );
    }

    const data = await shopifyGraphql<OrderQueryResult>({
      shop,
      accessToken,
      query: `query ($id: ID!) {
        order(id: $id) {
          id
          name
          displayFinancialStatus
          totalPriceSet { shopMoney { amount currencyCode } }
        }
      }`,
      variables: { id: `gid://shopify/Order/${orderId}` },
    });

    if (!data.order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const amountFiat = data.order.totalPriceSet.shopMoney.amount;
    const currencyCode = data.order.totalPriceSet.shopMoney.currencyCode;

    const { usdPerHtn, eurPerHtn } = await fetchLiveRates(request.nextUrl.origin);

    let amountHtn: string;
    if (currencyCode === "USD") {
      amountHtn = divideDecimalStrings(amountFiat, String(usdPerHtn), 8);
    } else if (currencyCode === "EUR") {
      amountHtn = divideDecimalStrings(amountFiat, String(eurPerHtn), 8);
    } else {
      return NextResponse.json(
        {
          error: `Unsupported store currency ${currencyCode}. Configure your store currency to USD or EUR for this demo.`,
        },
        { status: 400 },
      );
    }

    const merchantPrivateKey = process.env.MERCHANT_PRIVATE_KEY;
    if (!merchantPrivateKey) {
      return NextResponse.json({ error: "MERCHANT_PRIVATE_KEY is not configured" }, { status: 500 });
    }

    const merchantWallet = HoosatCrypto.importKeyPair(merchantPrivateKey, "mainnet");
    const address = merchantWallet.address;

    const sessionId = `shopify-${shop}-${orderId}`;

    const paymentInit = await checkPaymentStatus({ address, amount: amountHtn, sessionId });

    return NextResponse.json({
      shop,
      orderId,
      orderGid: data.order.id,
      orderName: data.order.name,
      displayFinancialStatus: data.order.displayFinancialStatus,
      currencyCode,
      amountFiat,
      usdPerHtn,
      eurPerHtn,
      amountHtn,
      address,
      sessionId,
      payment: paymentInit,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message ?? "Failed to build payment request" }, { status: 500 });
  }
}
