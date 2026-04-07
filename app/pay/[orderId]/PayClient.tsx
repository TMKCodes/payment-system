"use client";

import { useEffect, useRef, useState } from "react";

type ShopifyOrderPayment = {
  shop: string;
  orderId: number;
  orderName: string;
  displayFinancialStatus: string;
  currencyCode: string;
  amountFiat: string;
  amountHtn: string;
  address: string;
  sessionId: string;
  payment: {
    paymentStatus: "waiting_for_payment" | "pending_confirmation" | "completed";
    expectedAmountHtn: string;
    paymentDetails: null | {
      transactionHash: string;
      amountHtn: string;
      confirmations?: number;
      sweepTransactionHash?: string;
    };
    sessionInitialized: boolean;
  };
};

export default function PayClient(props: { orderId: string; shop: string }) {
  const [data, setData] = useState<ShopifyOrderPayment | null>(null);
  const [qrCode, setQrCode] = useState<string>("");
  const [status, setStatus] = useState<string>("Preparing payment...");
  const [error, setError] = useState<string>("");
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);
  const [markPaidResult, setMarkPaidResult] = useState<string>("");

  const hasAutoMarkedPaid = useRef(false);

  const orderId = Number.parseInt(props.orderId, 10);

  useEffect(() => {
    if (!props.shop) {
      setError("Missing shop query param");
      setStatus("Provide ?shop=your-store.myshopify.com");
      return;
    }

    if (!Number.isFinite(orderId) || orderId <= 0) {
      setError("Invalid orderId");
      setStatus("");
      return;
    }

    const load = async () => {
      try {
        setError("");
        setStatus("Loading order from Shopify...");

        const response = await fetch(
          `/api/shopify/order-payment?shop=${encodeURIComponent(props.shop)}&orderId=${orderId}`,
          { method: "GET" },
        );

        const text = await response.text();
        const json = JSON.parse(text) as ShopifyOrderPayment | { error: string };

        if (!response.ok) {
          throw new Error((json as { error: string }).error ?? `Failed to load order (${response.status})`);
        }

        const orderPayment = json as ShopifyOrderPayment;
        setData(orderPayment);
        setStatus(`Waiting for payment of ${orderPayment.amountHtn} HTN...`);

        const { HoosatQR } = await import("hoosat-sdk-web");
        const qr = await HoosatQR.generatePaymentQR({
          address: orderPayment.address,
          amount: Number.parseFloat(orderPayment.amountHtn),
          label: `Shopify ${orderPayment.orderName}`,
        });
        setQrCode(qr);
      } catch (e) {
        setError((e as Error).message ?? "Failed to load");
        setStatus("Failed to load order.");
      }
    };

    void load();
  }, [props.shop, orderId, props.orderId]);

  const checkPayment = async (silent: boolean) => {
    if (!data) return;

    try {
      if (!silent) setStatus("Checking payment...");

      const response = await fetch("/api/check-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: data.address,
          amount: data.amountHtn,
          sessionId: data.sessionId,
        }),
      });

      const json = (await response.json()) as {
        paymentStatus: "waiting_for_payment" | "pending_confirmation" | "completed";
        expectedAmountHtn: string;
        sessionInitialized: boolean;
        paymentDetails: null | {
          transactionHash: string;
          amountHtn: string;
          confirmations?: number;
          sweepTransactionHash?: string;
        };
        error?: string;
      };

      if (!response.ok) {
        throw new Error(json.error ?? "Failed to check payment");
      }

      const confirmations =
        typeof json.paymentDetails?.confirmations === "number"
          ? ` (${json.paymentDetails.confirmations} confirmations)`
          : "";
      const txLabel = json.paymentDetails?.transactionHash
        ? `TX ${json.paymentDetails.transactionHash.slice(0, 8)}...`
        : "Transaction";

      if (json.sessionInitialized) {
        setStatus(`Payment session initialized. Waiting for ${json.expectedAmountHtn} HTN.`);
        return;
      }

      if (json.paymentStatus === "completed") {
        setStatus(
          `Payment received. ${txLabel} for ${json.paymentDetails?.amountHtn ?? json.expectedAmountHtn} HTN${confirmations}.`,
        );
        if (!hasAutoMarkedPaid.current) {
          hasAutoMarkedPaid.current = true;
          void markPaid();
        }
        return;
      }

      if (json.paymentStatus === "pending_confirmation") {
        setStatus(`Payment seen. ${txLabel} awaiting confirmations${confirmations}.`);
        return;
      }

      setStatus(`Waiting for payment of ${json.expectedAmountHtn} HTN.`);
    } catch (e) {
      if (!silent) setStatus(`Error: ${(e as Error).message ?? "Failed"}`);
    }
  };

  useEffect(() => {
    if (!data) return;

    const interval = setInterval(() => {
      void checkPayment(true);
    }, 5000);

    return () => clearInterval(interval);
  }, [data]);

  const markPaid = async () => {
    if (!data) return;

    try {
      setIsMarkingPaid(true);
      setMarkPaidResult("");

      const response = await fetch("/api/shopify/mark-paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop: data.shop, orderId: data.orderId }),
      });

      const json = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok) {
        setMarkPaidResult(json.error ?? `Failed (${response.status})`);
        return;
      }

      setMarkPaidResult("Order marked as paid in Shopify.");
    } catch (e) {
      setMarkPaidResult((e as Error).message ?? "Failed");
    } finally {
      setIsMarkingPaid(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6 flex items-center justify-center">
      <div className="bg-white p-6 rounded shadow-md w-full max-w-lg">
        <h1 className="text-xl font-bold">HTN Crypto Payment</h1>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {data && (
          <div className="mt-3 text-sm text-gray-700">
            <p>
              Order: <span className="font-semibold">{data.orderName}</span>
            </p>
            <p>
              Total: {data.amountFiat} {data.currencyCode} (≈ {data.amountHtn} HTN)
            </p>
          </div>
        )}

        {qrCode ? (
          <div className="mt-5 text-center">
            <p className="mb-3 text-lg font-semibold">Scan to pay</p>
            <img src={qrCode} alt="HTN payment QR" className="mx-auto" />
            <p className="mt-3 text-sm">{status}</p>

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => void checkPayment(false)}
                className="flex-1 bg-blue-600 text-white p-2 rounded hover:bg-blue-700"
              >
                Check now
              </button>
              <button
                type="button"
                onClick={() => void markPaid()}
                disabled={isMarkingPaid}
                className="flex-1 bg-green-600 text-white p-2 rounded hover:bg-green-700 disabled:opacity-60"
              >
                {isMarkingPaid ? "Marking..." : "Mark order paid"}
              </button>
            </div>

            {markPaidResult && <p className="mt-3 text-sm text-gray-800">{markPaidResult}</p>}
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-600">{status}</p>
        )}
      </div>
    </div>
  );
}
