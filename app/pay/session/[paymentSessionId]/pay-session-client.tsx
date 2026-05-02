"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type PaymentDetails = {
  transactionHash?: string;
  amountHtn?: string;
  confirmations?: number;
  sweepTransactionHash?: string;
};

type CheckPaymentResponse = {
  paymentStatus: "completed" | "pending_confirmation" | "waiting_for_payment" | "gateway_in_use" | "expired";
  paymentDetails: PaymentDetails | null;
  expectedAmountHtn: string;
  sessionInitialized: boolean;
};

type BusyResponse = {
  error?: string;
  canTakeOver?: boolean;
};

function isProbablySafeReturnUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export default function PaySessionClient(props: {
  paymentSessionId: string;
  amountHtn?: string;
  orderId?: string;
  orderKey?: string;
  returnUrl?: string;
  callbackUrl?: string;
  label?: string;
}) {
  const { paymentSessionId, amountHtn: amountHtnRaw, orderId, orderKey, returnUrl, callbackUrl, label } = props;

  const amountHtn = (amountHtnRaw ?? "").trim();
  const paymentLabel = (label ?? "HTN payment").trim() || "HTN payment";

  const [merchantAddress, setMerchantAddress] = useState<string>("");
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>("");
  const [statusText, setStatusText] = useState<string>("Preparing payment request...");
  const [errorText, setErrorText] = useState<string>("");
  const [isComplete, setIsComplete] = useState<boolean>(false);
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetails | null>(null);
  const [expectedAmountHtn, setExpectedAmountHtn] = useState<string>(amountHtn);
  const [isNotifying, setIsNotifying] = useState<boolean>(false);
  const [hasExpired, setHasExpired] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [isCancelling, setIsCancelling] = useState<boolean>(false);
  const [shouldAutoWatch, setShouldAutoWatch] = useState<boolean>(true);
  const [canTakeOverSession, setCanTakeOverSession] = useState<boolean>(false);
  const notifyOnceRef = useRef<boolean>(false);
  const autoRedirectOnceRef = useRef<boolean>(false);

  const canRedirect = useMemo(() => isProbablySafeReturnUrl(returnUrl), [returnUrl]);

  const buildReturnUrl = (nextStatus: string) => {
    if (!returnUrl) return null;
    try {
      const parsed = new URL(returnUrl);
      parsed.searchParams.set("htn_session", paymentSessionId);
      parsed.searchParams.set("htn_status", nextStatus);
      if (orderId) parsed.searchParams.set("order_id", orderId);
      return parsed.toString();
    } catch {
      return null;
    }
  };

  const redirectToReturnUrl = (nextStatus: string) => {
    const url = buildReturnUrl(nextStatus);
    if (!url) return;
    window.location.assign(url);
  };

  const cancelPayment = async () => {
    setShouldAutoWatch(false);
    setIsCancelling(true);
    setErrorText("");
    setStatusText("Cancelling payment session...");

    try {
      if (merchantAddress && amountHtn) {
        await fetch("/api/check-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address: merchantAddress,
            amount: amountHtn,
            sessionId: paymentSessionId,
            action: "cancel-session",
          }),
        });
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsCancelling(false);
    }

    if (canRedirect) {
      redirectToReturnUrl("cancelled");
      return;
    }

    setHasExpired(true);
    setStatusText("Payment session cancelled. You can close this window.");
  };

  const initialize = async (options?: { forceTakeover?: boolean }) => {
    if (!amountHtn || Number.isNaN(Number(amountHtn)) || Number(amountHtn) <= 0) {
      setErrorText("Missing or invalid amount.");
      setStatusText("Cannot start payment session.");
      return;
    }

    try {
      setIsChecking(true);
      setErrorText("");
      setCanTakeOverSession(false);
      setStatusText("Fetching merchant address...");

      const merchantResponse = await fetch("/api/merchant/address", { method: "GET" });
      if (!merchantResponse.ok) {
        throw new Error(`Failed to load merchant address (${merchantResponse.status})`);
      }

      const merchantData = (await merchantResponse.json()) as { address?: string };
      if (!merchantData.address || typeof merchantData.address !== "string") {
        throw new Error("Merchant address missing from response");
      }

      setMerchantAddress(merchantData.address);
      setStatusText("Generating QR code...");

      const { HoosatQR } = await import("hoosat-sdk-web");

      const qrDataUrl = await HoosatQR.generatePaymentQR({
        address: merchantData.address,
        amount: Number(amountHtn),
        label: paymentLabel,
      });
      setQrCodeDataUrl(qrDataUrl);

      setStatusText("Initializing payment session...");

      const initResponse = await fetch("/api/check-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: merchantData.address,
          amount: amountHtn,
          sessionId: paymentSessionId,
          forceTakeover: options?.forceTakeover === true,
        }),
      });

      if (initResponse.status === 410) {
        const expiredData = (await initResponse.json().catch(() => ({}))) as { error?: string };
        setHasExpired(true);
        setErrorText("");
        setStatusText(expiredData.error ?? "Payment session expired. Please restart checkout.");
        return;
      }

      if (initResponse.status === 409) {
        const busyData = (await initResponse.json().catch(() => ({}))) as BusyResponse;
        setCanTakeOverSession(Boolean(busyData.canTakeOver));
        setErrorText("");
        setStatusText(
          busyData.error ?? "Gateway busy. You can wait a moment or take over the checkout from the stuck session.",
        );
        return;
      }

      if (!initResponse.ok) {
        throw new Error(`Failed to initialize payment session (${initResponse.status})`);
      }

      const initData = (await initResponse.json()) as Partial<CheckPaymentResponse>;

      if (typeof initData.expectedAmountHtn === "string") {
        setExpectedAmountHtn(initData.expectedAmountHtn);
      }

      setStatusText(`Waiting for payment of ${initData.expectedAmountHtn ?? amountHtn} HTN...`);
    } catch (error) {
      console.error(error);
      setErrorText((error as Error).message ?? "Failed to initialize");
      setStatusText("Error preparing payment.");
    } finally {
      setIsChecking(false);
    }
  };

  const poll = async (silent = true) => {
    if (!merchantAddress || !amountHtn || hasExpired) return;

    try {
      setIsChecking(true);
      setErrorText("");
      if (!silent) setStatusText("Checking payment...");

      const response = await fetch("/api/check-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: merchantAddress,
          amount: amountHtn,
          sessionId: paymentSessionId,
        }),
      });

      if (response.status === 410) {
        const expiredData = (await response.json().catch(() => ({}))) as { error?: string };
        setHasExpired(true);
        setIsComplete(false);
        setErrorText("");
        setStatusText(expiredData.error ?? "Payment session expired. Please restart checkout.");
        return;
      }

      if (response.status === 409) {
        const busyData = (await response.json().catch(() => ({}))) as BusyResponse;
        setIsComplete(false);
        setErrorText("");
        setCanTakeOverSession(Boolean(busyData.canTakeOver));
        setStatusText(busyData.error ?? "Gateway busy. Please try again shortly.");
        return;
      }

      if (!response.ok) {
        setIsComplete(false);
        setErrorText(`Gateway check failed (${response.status}).`);
        setStatusText("Payment check failed. Try again manually.");
        return;
      }

      const data = (await response.json()) as CheckPaymentResponse;
      setCanTakeOverSession(false);
      setExpectedAmountHtn(data.expectedAmountHtn);
      setPaymentDetails(data.paymentDetails);

      if (data.sessionInitialized) {
        setIsComplete(false);
        setStatusText(`Payment session initialized. Waiting for ${data.expectedAmountHtn} HTN.`);
        return;
      }

      if (data.paymentStatus === "completed") {
        setIsComplete(true);
        const tx = data.paymentDetails?.transactionHash;
        const confirmations = data.paymentDetails?.confirmations;
        const confText = typeof confirmations === "number" ? ` (${confirmations} confirmations)` : "";
        setStatusText(`Payment received${tx ? ` (TX ${tx.substring(0, 8)}...)` : ""}${confText}.`);
        return;
      }

      if (data.paymentStatus === "pending_confirmation") {
        setIsComplete(false);
        const tx = data.paymentDetails?.transactionHash;
        const confirmations = data.paymentDetails?.confirmations;
        const confText = typeof confirmations === "number" ? ` (${confirmations} confirmations)` : "";
        setStatusText(`Payment seen${tx ? ` (TX ${tx.substring(0, 8)}...)` : ""}. Awaiting confirmation${confText}.`);
        return;
      }

      setIsComplete(false);
      setStatusText(`Waiting for payment of ${data.expectedAmountHtn} HTN...`);
    } catch (error) {
      console.error(error);
      setErrorText((error as Error).message ?? "Failed to poll payment");
      if (!silent) setStatusText("Error checking payment.");
    } finally {
      setIsChecking(false);
    }
  };

  const notifyWooCommerce = async () => {
    if (notifyOnceRef.current) return;
    if (!callbackUrl || !orderId || !orderKey) return;

    notifyOnceRef.current = true;
    setIsNotifying(true);

    try {
      const response = await fetch("/api/woocommerce/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callbackUrl,
          orderId,
          orderKey,
          paymentSessionId,
          amountHtn,
          address: merchantAddress,
          paymentDetails,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`WooCommerce notify failed (${response.status}): ${text}`);
      }

      setStatusText("Payment confirmed. Returning to store...");
    } catch (error) {
      console.error(error);
      // Don't block redirect: the return handler can still verify the payment.
      setErrorText("");
    } finally {
      setIsNotifying(false);
    }
  };

  const handleCompletedPayment = async () => {
    if (!returnUrl) {
      setStatusText("Payment confirmed. You can close this window.");
      return;
    }

    await notifyWooCommerce();

    if (canRedirect && !autoRedirectOnceRef.current) {
      autoRedirectOnceRef.current = true;
      setStatusText("Payment confirmed. Returning to ORI Protocol...");
      window.setTimeout(() => {
        redirectToReturnUrl("paid");
      }, 1200);
      return;
    }

    if (canRedirect) {
      setStatusText("Payment confirmed. Returning to ORI Protocol.");
    } else {
      setStatusText("Payment confirmed. You can close this window.");
    }
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void initialize();
    }, 0);

    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentSessionId]);

  useEffect(() => {
    if (!shouldAutoWatch || !merchantAddress || !amountHtn || hasExpired || isComplete) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void poll(true);
    }, 7500);

    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoWatch, merchantAddress, amountHtn, hasExpired, isComplete, paymentSessionId]);

  useEffect(() => {
    if (!isComplete) return;

    const timeoutId = window.setTimeout(() => {
      void handleCompletedPayment();
    }, 0);

    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComplete]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
      <h1 className="text-2xl font-bold mb-4">HTN payment gateway</h1>
      <div className="bg-white p-6 rounded shadow-md w-full max-w-md">
        <div className="text-sm text-gray-700 space-y-2">
          <div>
            <span className="font-medium">Amount:</span> {expectedAmountHtn || amountHtn} HTN
          </div>
          {merchantAddress ? (
            <div className="break-all">
              <span className="font-medium">To:</span> {merchantAddress}
            </div>
          ) : null}
          <div>
            <span className="font-medium">Status:</span> {statusText}
          </div>
          {paymentDetails?.transactionHash ? (
            <div className="break-all">
              <span className="font-medium">Transaction:</span> {paymentDetails.transactionHash}
            </div>
          ) : null}
          {paymentDetails?.sweepTransactionHash ? (
            <div className="break-all">
              <span className="font-medium">Sweep TX:</span> {paymentDetails.sweepTransactionHash}
            </div>
          ) : null}
          {isNotifying ? <div>Notifying WooCommerce...</div> : null}
          {errorText ? <div className="text-red-600">{errorText}</div> : null}
        </div>

        {qrCodeDataUrl ? (
          <div className="mt-5 flex flex-col items-center gap-3">
            <img src={qrCodeDataUrl} alt="HTN payment QR code" className="w-64 h-64" />
            <div className="text-xs text-gray-500">Scan with your Hoosat wallet</div>
          </div>
        ) : (
          <div className="mt-5 text-center text-gray-500">Generating QR...</div>
        )}

        {!isComplete && !hasExpired ? (
          <div className="mt-6">
            <button
              type="button"
              onClick={() => void cancelPayment()}
              className="w-full text-sm px-3 py-2 rounded border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-60"
              disabled={isCancelling}
            >
              {isCancelling ? "Cancelling..." : "Cancel payment"}
            </button>
          </div>
        ) : null}

        {canTakeOverSession && !isComplete ? (
          <button
            type="button"
            onClick={() => void initialize({ forceTakeover: true })}
            className="mt-3 w-full rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"
            disabled={isChecking}
          >
            {isChecking ? "Taking over..." : "Take over stuck checkout"}
          </button>
        ) : null}

        {!canRedirect && returnUrl ? (
          <div className="mt-3 text-xs text-red-600">Invalid return URL provided.</div>
        ) : null}
        {!isComplete ? (
          <div className="mt-3 text-xs text-gray-500">
            While this checkout page is open, the gateway keeps watching for the payment and returns to ORI Protocol automatically after confirmation.
          </div>
        ) : null}
      </div>
    </div>
  );
}
