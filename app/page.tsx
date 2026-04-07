"use client";

import { useState, useEffect } from "react";

type PriceInputMode = "HTN" | "USD" | "EUR";

function parseDecimalToBigInt(value: string): { digits: bigint; scale: number } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(",", ".");
  if (!/^(?:\d+)(?:\.\d+)?$/.test(normalized)) return null;

  const [whole, fractional = ""] = normalized.split(".");
  const scale = fractional.length;
  const digitsStr = `${whole}${fractional}`.replace(/^0+(?=\d)/, "");
  const safeDigitsStr = digitsStr.length === 0 ? "0" : digitsStr;
  return { digits: BigInt(safeDigitsStr), scale };
}

function formatScaledBigInt(value: bigint, scale: number): string {
  if (scale <= 0) return value.toString();

  const negative = value < 0n;
  const abs = negative ? -value : value;
  const raw = abs.toString();
  const padded = raw.padStart(scale + 1, "0");
  const whole = padded.slice(0, -scale);
  const fractional = padded.slice(-scale).replace(/0+$/, "");
  const result = fractional.length > 0 ? `${whole}.${fractional}` : whole;
  return negative ? `-${result}` : result;
}

function divideDecimalStrings(numerator: string, denominator: string, outScale: number): string | null {
  const numeratorParsed = parseDecimalToBigInt(numerator);
  const denominatorParsed = parseDecimalToBigInt(denominator);
  if (!numeratorParsed || !denominatorParsed) return null;
  if (denominatorParsed.digits === 0n) return null;

  // (N / 10^nScale) / (D / 10^dScale) = (N * 10^dScale) / (D * 10^nScale)
  // then scale output by outScale decimal places:
  // resultScaled = (N * 10^(dScale + outScale)) / (D * 10^nScale)
  const numeratorScaleFactor = BigInt(denominatorParsed.scale + outScale);
  const denominatorScaleFactor = BigInt(numeratorParsed.scale);

  const scaledNumerator = numeratorParsed.digits * 10n ** numeratorScaleFactor;
  const scaledDenominator = denominatorParsed.digits * 10n ** denominatorScaleFactor;

  const rounded = (scaledNumerator + scaledDenominator / 2n) / scaledDenominator;
  return formatScaledBigInt(rounded, outScale);
}

export default function Home() {
  const [amount, setAmount] = useState("");
  const [priceInputMode, setPriceInputMode] = useState<PriceInputMode>("HTN");
  const [liveRateUpdatedAt, setLiveRateUpdatedAt] = useState<string | null>(null);
  const [liveRateError, setLiveRateError] = useState<string>("");
  const [isFetchingLiveRate, setIsFetchingLiveRate] = useState(false);

  const [usdPerHtnRate, setUsdPerHtnRate] = useState(
    process.env.NEXT_PUBLIC_USD_PER_HTN ??
      (process.env.NEXT_PUBLIC_USD_TO_HTN_RATE
        ? (divideDecimalStrings("1", process.env.NEXT_PUBLIC_USD_TO_HTN_RATE, 8) ?? "")
        : ""),
  );
  const [eurPerHtnRate, setEurPerHtnRate] = useState(
    process.env.NEXT_PUBLIC_EUR_PER_HTN ??
      (process.env.NEXT_PUBLIC_EUR_TO_HTN_RATE
        ? (divideDecimalStrings("1", process.env.NEXT_PUBLIC_EUR_TO_HTN_RATE, 8) ?? "")
        : ""),
  );
  const [qrCode, setQrCode] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [address, setAddress] = useState("");
  const [paymentSessionId, setPaymentSessionId] = useState("");
  const [isPaymentComplete, setIsPaymentComplete] = useState(false);
  const [isConfirmingTransaction, setIsConfirmingTransaction] = useState(false);
  const [isSweepSubmitted, setIsSweepSubmitted] = useState(false);
  const [isClient, setIsClient] = useState(false);

  const isFiatMode = priceInputMode === "USD" || priceInputMode === "EUR";
  const fiatLabel = priceInputMode === "USD" ? "USD" : priceInputMode === "EUR" ? "EUR" : "HTN";
  const selectedFiatRate = priceInputMode === "USD" ? usdPerHtnRate : priceInputMode === "EUR" ? eurPerHtnRate : "";

  const amountHtn = priceInputMode === "HTN" ? amount : (divideDecimalStrings(amount, selectedFiatRate, 8) ?? "");

  const fetchLiveRates = async () => {
    try {
      setIsFetchingLiveRate(true);
      setLiveRateError("");

      const response = await fetch("/api/price", { method: "GET" });
      if (!response.ok) {
        throw new Error(`Failed to fetch live rates (${response.status})`);
      }

      const data = (await response.json()) as {
        usdPerHtn: number;
        eurPerHtn: number;
        updatedAt?: string;
      };

      if (typeof data.usdPerHtn !== "number" || !Number.isFinite(data.usdPerHtn) || data.usdPerHtn <= 0) {
        throw new Error("Invalid USD/HTN rate");
      }

      if (typeof data.eurPerHtn !== "number" || !Number.isFinite(data.eurPerHtn) || data.eurPerHtn <= 0) {
        throw new Error("Invalid EUR/HTN rate");
      }

      setUsdPerHtnRate(String(data.usdPerHtn));
      setEurPerHtnRate(String(data.eurPerHtn));
      setLiveRateUpdatedAt(typeof data.updatedAt === "string" ? data.updatedAt : null);
    } catch (error) {
      console.error("Error fetching live rates:", error);
      setLiveRateError((error as Error).message ?? "Failed to fetch live rates");
    } finally {
      setIsFetchingLiveRate(false);
    }
  };

  // Ensure this only runs on client
  useEffect(() => {
    setIsClient(true);
    void fetchLiveRates();
  }, []);

  useEffect(() => {
    if (!qrCode || !address || !amountHtn || !paymentSessionId || isPaymentComplete) {
      return;
    }

    const intervalId = setInterval(() => {
      void checkPayment({ silent: true });
    }, 5000);

    return () => clearInterval(intervalId);
  }, [qrCode, address, amountHtn, paymentSessionId, isPaymentComplete]);

  const checkPayment = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!address || !amountHtn || !paymentSessionId) return;

    try {
      if (!silent) {
        setPaymentStatus("Checking...");
      }

      const response = await fetch("/api/check-payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address,
          amount: amountHtn,
          sessionId: paymentSessionId,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to check payment");
      }

      const {
        paymentStatus: status,
        paymentDetails,
        expectedAmountHtn,
        observedConfirmedCount,
        observedPendingCount,
        sessionInitialized,
      } = await response.json();

      const confirmationText =
        typeof paymentDetails?.confirmations === "number" ? ` (${paymentDetails.confirmations} confirmations)` : "";

      const transactionLabel =
        typeof paymentDetails?.transactionHash === "string" && paymentDetails.transactionHash.length > 0
          ? `TX ${paymentDetails.transactionHash.substring(0, 8)}...`
          : "Transaction";

      const amountLabel =
        typeof paymentDetails?.amountHtn === "string" && paymentDetails.amountHtn.length > 0
          ? paymentDetails.amountHtn
          : expectedAmountHtn;

      if (sessionInitialized) {
        setIsPaymentComplete(false);
        setPaymentStatus(`Payment session initialized. Waiting for ${expectedAmountHtn} HTN.`);
        return;
      }

      if (status === "completed" && paymentDetails) {
        setIsPaymentComplete(true);
        setIsSweepSubmitted(Boolean(paymentDetails.sweepTransactionHash));
        setPaymentStatus(`Payment received. ${transactionLabel} for ${amountLabel} HTN${confirmationText}.`);
        return;
      }

      if (status === "pending_confirmation" && paymentDetails) {
        setIsPaymentComplete(false);
        setPaymentStatus(
          `Payment seen. ${transactionLabel} for ${amountLabel} HTN is awaiting confirmation${confirmationText}.`,
        );
        return;
      }

      setIsPaymentComplete(false);
      setIsSweepSubmitted(false);
      setPaymentStatus(`Waiting for payment of ${expectedAmountHtn} HTN.`);
    } catch (error) {
      console.error("Error checking payment:", error);
      setPaymentStatus("Error checking payment: " + (error as Error).message);
    }
  };

  const cancelPayment = () => {
    setQrCode("");
    setAddress("");
    setPaymentSessionId("");
    setPaymentStatus("");
    setIsPaymentComplete(false);
    setIsConfirmingTransaction(false);
    setIsSweepSubmitted(false);
  };

  const confirmTransaction = async () => {
    if (!address || !amountHtn || !paymentSessionId) return;

    try {
      setIsConfirmingTransaction(true);
      setPaymentStatus("Submitting merchant transaction...");

      const response = await fetch("/api/check-payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address,
          amount: amountHtn,
          sessionId: paymentSessionId,
          action: "confirm-transaction",
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to confirm transaction");
      }

      cancelPayment();
    } catch (error) {
      console.error("Error confirming transaction:", error);
      setPaymentStatus("Error confirming transaction: " + (error as Error).message);
    } finally {
      setIsConfirmingTransaction(false);
    }
  };

  const generateQR = async () => {
    if (!amountHtn) return;

    try {
      const newSessionId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      setIsPaymentComplete(false);
      setIsConfirmingTransaction(false);
      setIsSweepSubmitted(false);
      setQrCode("");
      setPaymentStatus("Preparing payment request...");

      // Get merchant address from server-side API
      const response = await fetch("/api/merchant/address");
      if (!response.ok) {
        throw new Error("Failed to get merchant address");
      }
      const { address: merchantAddress } = await response.json();
      setAddress(merchantAddress);
      setPaymentSessionId(newSessionId);

      // Dynamically import the SDK to avoid SSR issues
      const { HoosatQR } = await import("hoosat-sdk-web");

      // Generate payment QR using built-in QR generator
      const qrDataUrl = await HoosatQR.generatePaymentQR({
        address: merchantAddress,
        amount: parseFloat(amountHtn),
        label: "Merchant Payment",
      });
      setQrCode(qrDataUrl);

      const sessionResponse = await fetch("/api/check-payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address: merchantAddress,
          amount: amountHtn,
          sessionId: newSessionId,
        }),
      });

      if (!sessionResponse.ok) {
        throw new Error("Failed to initialize payment session");
      }

      const { expectedAmountHtn } = await sessionResponse.json();
      setPaymentStatus(`Payment session initialized. Waiting for ${expectedAmountHtn} HTN.`);
    } catch (error) {
      console.error("Error generating QR code:", error);
      setPaymentStatus("Error generating payment request: " + (error as Error).message);
    }
  };

  if (!isClient) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
        <h1 className="text-2xl font-bold mb-4">HTN payment gateway</h1>
        <div className="bg-white p-6 rounded shadow-md w-full max-w-md">
          <p className="text-center">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
      <h1 className="text-2xl font-bold mb-4">HTN payment gateway</h1>
      <div className="bg-white p-6 rounded shadow-md w-full max-w-md">
        {!qrCode && (
          <>
            <div className="flex items-end justify-between gap-3 mb-2">
              <label className="block text-sm font-medium">Payment Amount ({fiatLabel})</label>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-600">Price in</label>
                <select
                  value={priceInputMode}
                  onChange={(e) => setPriceInputMode(e.target.value as PriceInputMode)}
                  className="p-2 border border-gray-300 rounded text-sm bg-white"
                >
                  <option value="HTN">HTN</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
            </div>

            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded"
              placeholder={priceInputMode === "HTN" ? "Enter amount in HTN" : `Enter amount in ${fiatLabel}`}
              inputMode="decimal"
            />

            {isFiatMode && (
              <div className="mt-3 mb-4">
                <label className="block text-xs text-gray-600 mb-1">Conversion rate ({fiatLabel} per HTN)</label>
                <div className="flex items-center justify-end gap-3 mb-2">
                  <button
                    type="button"
                    onClick={fetchLiveRates}
                    disabled={isFetchingLiveRate}
                    className="text-sm px-3 py-2 rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-60"
                  >
                    {isFetchingLiveRate ? "Refreshing..." : "Refresh live rate"}
                  </button>
                </div>
                <input
                  type="number"
                  value={selectedFiatRate}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    if (priceInputMode === "USD") setUsdPerHtnRate(nextValue);
                    if (priceInputMode === "EUR") setEurPerHtnRate(nextValue);
                  }}
                  className="w-full p-2 border border-gray-300 rounded"
                  placeholder="e.g. 0.12"
                  inputMode="decimal"
                />

                {liveRateUpdatedAt && (
                  <p className="mt-2 text-xs text-gray-500">Updated: {new Date(liveRateUpdatedAt).toLocaleString()}</p>
                )}

                {liveRateError && <p className="mt-2 text-xs text-red-600">Live rate error: {liveRateError}</p>}
                <p className="mt-2 text-sm text-gray-700">
                  HTN amount to request: <span className="font-semibold">{amountHtn ? `${amountHtn} HTN` : "—"}</span>
                </p>
              </div>
            )}

            {priceInputMode === "HTN" && <div className="mb-4" />}
            <button
              onClick={generateQR}
              disabled={!amountHtn}
              className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600 mb-4"
            >
              Generate Payment QR Code
            </button>
          </>
        )}
        {qrCode && (
          <div className="mt-4 text-center">
            <p className="mb-4 text-2xl font-semibold text-gray-800">Scan to pay {amountHtn} HTN</p>
            {isFiatMode && (
              <p className="-mt-2 mb-4 text-sm text-gray-600">
                Priced at {amount} {fiatLabel}
              </p>
            )}
            <img src={qrCode} alt="Payment QR Code" className="mx-auto" />
            <p className="mt-2 text-sm">{paymentStatus}</p>
            {isPaymentComplete && !isSweepSubmitted ? (
              <button
                onClick={confirmTransaction}
                disabled={isConfirmingTransaction}
                className="mt-4 w-full bg-green-600 text-white p-2 rounded hover:bg-green-700"
              >
                {isConfirmingTransaction ? "Confirming transaction..." : "Confirm transaction"}
              </button>
            ) : !isPaymentComplete ? (
              <button
                onClick={cancelPayment}
                className="mt-4 w-full bg-gray-200 text-gray-900 p-2 rounded hover:bg-gray-300"
              >
                Cancel Payment
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
