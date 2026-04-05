'use client';

import { useState, useEffect } from 'react';

export default function Home() {
  const [amount, setAmount] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [address, setAddress] = useState('');
  const [paymentSessionId, setPaymentSessionId] = useState('');
  const [isPaymentComplete, setIsPaymentComplete] = useState(false);
  const [isConfirmingTransaction, setIsConfirmingTransaction] = useState(false);
  const [isSweepSubmitted, setIsSweepSubmitted] = useState(false);
  const [isClient, setIsClient] = useState(false);

  // Ensure this only runs on client
  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!qrCode || !address || !amount || !paymentSessionId || isPaymentComplete) {
      return;
    }

    const intervalId = setInterval(() => {
      void checkPayment({ silent: true });
    }, 5000);

    return () => clearInterval(intervalId);
  }, [qrCode, address, amount, paymentSessionId, isPaymentComplete]);

  const checkPayment = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!address || !amount || !paymentSessionId) return;

    try {
      if (!silent) {
        setPaymentStatus('Checking...');
      }

      const response = await fetch('/api/check-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          address,
          amount,
          sessionId: paymentSessionId
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to check payment');
      }

      const {
        paymentStatus: status,
        paymentDetails,
        expectedAmountHtn,
        observedConfirmedCount,
        observedPendingCount,
        sessionInitialized
      } = await response.json();

      const confirmationText =
        typeof paymentDetails?.confirmations === 'number'
          ? ` (${paymentDetails.confirmations} confirmations)`
          : '';

      const transactionLabel =
        typeof paymentDetails?.transactionHash === 'string' && paymentDetails.transactionHash.length > 0
          ? `TX ${paymentDetails.transactionHash.substring(0, 8)}...`
          : 'Transaction';

      const amountLabel =
        typeof paymentDetails?.amountHtn === 'string' && paymentDetails.amountHtn.length > 0
          ? paymentDetails.amountHtn
          : expectedAmountHtn;

      if (sessionInitialized) {
        setIsPaymentComplete(false);
        setPaymentStatus(`Payment session initialized. Waiting for ${expectedAmountHtn} HTN.`);
        return;
      }

      if (status === 'completed' && paymentDetails) {
        setIsPaymentComplete(true);
        setIsSweepSubmitted(Boolean(paymentDetails.sweepTransactionHash));
        setPaymentStatus(
          `Payment received. ${transactionLabel} for ${amountLabel} HTN${confirmationText}.`,
        );
        return;
      }

      if (status === 'pending_confirmation' && paymentDetails) {
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
      console.error('Error checking payment:', error);
      setPaymentStatus('Error checking payment: ' + (error as Error).message);
    }
  };

  const cancelPayment = () => {
    setQrCode('');
    setAddress('');
    setPaymentSessionId('');
    setPaymentStatus('');
    setIsPaymentComplete(false);
    setIsConfirmingTransaction(false);
    setIsSweepSubmitted(false);
  };

  const confirmTransaction = async () => {
    if (!address || !amount || !paymentSessionId) return;

    try {
      setIsConfirmingTransaction(true);
      setPaymentStatus('Submitting merchant transaction...');

      const response = await fetch('/api/check-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          address,
          amount,
          sessionId: paymentSessionId,
          action: 'confirm-transaction'
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to confirm transaction');
      }

      cancelPayment();
    } catch (error) {
      console.error('Error confirming transaction:', error);
      setPaymentStatus('Error confirming transaction: ' + (error as Error).message);
    } finally {
      setIsConfirmingTransaction(false);
    }
  };

  const generateQR = async () => {
    if (!amount) return;

    try {
      const newSessionId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      setIsPaymentComplete(false);
      setIsConfirmingTransaction(false);
      setIsSweepSubmitted(false);
      setQrCode('');
      setPaymentStatus('Preparing payment request...');

      // Get merchant address from server-side API
      const response = await fetch('/api/merchant/address');
      if (!response.ok) {
        throw new Error('Failed to get merchant address');
      }
      const { address: merchantAddress } = await response.json();
      setAddress(merchantAddress);
      setPaymentSessionId(newSessionId);

      // Dynamically import the SDK to avoid SSR issues
      const { HoosatQR } = await import('hoosat-sdk-web');

      // Generate payment QR using built-in QR generator
      const qrDataUrl = await HoosatQR.generatePaymentQR({
        address: merchantAddress,
        amount: parseFloat(amount),
        label: 'Merchant Payment'
      });
      setQrCode(qrDataUrl);

      const sessionResponse = await fetch('/api/check-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          address: merchantAddress,
          amount,
          sessionId: newSessionId
        }),
      });

      if (!sessionResponse.ok) {
        throw new Error('Failed to initialize payment session');
      }

      const { expectedAmountHtn } = await sessionResponse.json();
      setPaymentStatus(`Payment session initialized. Waiting for ${expectedAmountHtn} HTN.`);
    } catch (error) {
      console.error('Error generating QR code:', error);
      setPaymentStatus('Error generating payment request: ' + (error as Error).message);
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
            <label className="block text-sm font-medium mb-2">Payment Amount (HTN)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded mb-4"
              placeholder="Enter amount"
            />
            <button
              onClick={generateQR}
              className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600 mb-4"
            >
              Generate Payment QR Code
            </button>
          </>
        )}
        {qrCode && (
          <div className="mt-4 text-center">
            <p className="mb-4 text-2xl font-semibold text-gray-800">Scan to pay {amount} HTN</p>
            <img src={qrCode} alt="Payment QR Code" className="mx-auto" />
            <p className="mt-2 text-sm">{paymentStatus}</p>
            {isPaymentComplete && !isSweepSubmitted ? (
              <button
                onClick={confirmTransaction}
                disabled={isConfirmingTransaction}
                className="mt-4 w-full bg-green-600 text-white p-2 rounded hover:bg-green-700"
              >
                {isConfirmingTransaction ? 'Confirming transaction...' : 'Confirm transaction'}
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
