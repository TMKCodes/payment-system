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
    totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  };
};

type OrderMarkPaidResult = {
  orderMarkAsPaid: {
    order: null | { id: string; displayFinancialStatus: string };
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
};

type TagsAddResult = {
  tagsAdd: {
    node: null | { id: string };
    userErrors: Array<{ field: string[] | null; message: string }>;
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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { shop?: string; orderId?: number | string };
    const shop = normalizeShopDomain(body.shop ?? "");
    const orderId = Number.parseInt(String(body.orderId ?? ""), 10);

    if (!Number.isFinite(orderId) || orderId <= 0) {
      return NextResponse.json({ error: "Invalid orderId" }, { status: 400 });
    }

    const accessToken = await getShopAccessToken(shop);
    if (!accessToken) {
      return NextResponse.json({ error: "Missing Shopify access token" }, { status: 401 });
    }

    const orderData = await shopifyGraphql<OrderQueryResult>({
      shop,
      accessToken,
      query: `query ($id: ID!) {
        order(id: $id) {
          id
          name
          totalPriceSet { shopMoney { amount currencyCode } }
        }
      }`,
      variables: { id: `gid://shopify/Order/${orderId}` },
    });

    if (!orderData.order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const amountFiat = orderData.order.totalPriceSet.shopMoney.amount;
    const currencyCode = orderData.order.totalPriceSet.shopMoney.currencyCode;

    const { usdPerHtn, eurPerHtn } = await fetchLiveRates(request.nextUrl.origin);

    let amountHtn: string;
    if (currencyCode === "USD") {
      amountHtn = divideDecimalStrings(amountFiat, String(usdPerHtn), 8);
    } else if (currencyCode === "EUR") {
      amountHtn = divideDecimalStrings(amountFiat, String(eurPerHtn), 8);
    } else {
      return NextResponse.json({ error: `Unsupported store currency ${currencyCode}` }, { status: 400 });
    }

    const merchantPrivateKey = process.env.MERCHANT_PRIVATE_KEY;
    if (!merchantPrivateKey) {
      return NextResponse.json({ error: "MERCHANT_PRIVATE_KEY is not configured" }, { status: 500 });
    }

    const merchantWallet = HoosatCrypto.importKeyPair(merchantPrivateKey, "mainnet");
    const address = merchantWallet.address;

    const sessionId = `shopify-${shop}-${orderId}`;

    // Re-check on-chain state before touching the order.
    const status = await checkPaymentStatus({ address, amount: amountHtn, sessionId, action: "confirm-transaction" });

    if (status.paymentStatus !== "completed") {
      return NextResponse.json({ error: "Payment not completed yet", payment: status }, { status: 409 });
    }

    const markPaid = await shopifyGraphql<{ orderMarkAsPaid: OrderMarkPaidResult["orderMarkAsPaid"] }>({
      shop,
      accessToken,
      query: `mutation ($input: OrderMarkAsPaidInput!) {
        orderMarkAsPaid(input: $input) {
          order { id displayFinancialStatus }
          userErrors { field message }
        }
      }`,
      variables: { input: { id: orderData.order.id } },
    });

    if (markPaid.orderMarkAsPaid.userErrors.length > 0) {
      return NextResponse.json(
        { error: "Failed to mark order paid", userErrors: markPaid.orderMarkAsPaid.userErrors },
        { status: 502 },
      );
    }

    // Best-effort tagging for visibility.
    try {
      const tags = await shopifyGraphql<{ tagsAdd: TagsAddResult["tagsAdd"] }>({
        shop,
        accessToken,
        query: `mutation ($id: ID!, $tags: [String!]!) {
          tagsAdd(id: $id, tags: $tags) {
            node { id }
            userErrors { field message }
          }
        }`,
        variables: { id: orderData.order.id, tags: ["HTN_PAID"] },
      });

      if (tags.tagsAdd.userErrors.length > 0) {
        // ignore
      }
    } catch {
      // ignore
    }

    return NextResponse.json({
      ok: true,
      shop,
      orderId,
      orderName: orderData.order.name,
      payment: status,
      shopify: markPaid.orderMarkAsPaid.order,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message ?? "Failed to mark order paid" }, { status: 500 });
  }
}
