import { NextRequest, NextResponse } from "next/server";
import { HoosatClient, HoosatCrypto, HoosatTxBuilder, HoosatUtils, type UtxoForSigning } from "hoosat-sdk";
import {
  clearExpiredSession,
  findActiveSessionForAddressAndAmount,
  isSessionExpired,
  paymentSessions,
  pruneExpiredSessions,
} from "../../lib/gateway-state";

type PaymentSession = {
  address: string;
  amountSompi: string;
  knownConfirmedTxIds: Set<string>;
  knownPendingTxIds: Set<string>;
  trackedCandidatePayments: Map<string, ObservedPendingPayment>;
  completedPayment: ObservedConfirmedPayment | null;
  sweepTransactionHash: string | null;
  createdAt: number;
  updatedAt: number;
  initializing?: boolean;
};

type ObservedConfirmedPayment = {
  transactionHash: string;
  amountSompi: string;
  amountHtn: string;
  outputIndex: number;
  blockDaaScore: string;
  confirmations?: number;
  blockHash?: string;
  sweepTransactionHash?: string;
};

type ObservedPendingPayment = {
  transactionHash: string;
  amountSompi: string;
  amountHtn: string;
};

const typedPaymentSessions = paymentSessions as unknown as Map<string, PaymentSession>;

const sdkNodePort = Number.parseInt(process.env.HOOSAT_NODE_PORT ?? "42420", 10);
const sdkNodeTimeout = Number.parseInt(process.env.HOOSAT_NODE_TIMEOUT ?? "10000", 10);

const SDK_NODE_CONFIG = {
  host: process.env.HOOSAT_NODE_HOST ?? "mainnet-node-1.hoosat.fi",
  port: Number.isFinite(sdkNodePort) ? sdkNodePort : 42420,
  timeout: Number.isFinite(sdkNodeTimeout) ? sdkNodeTimeout : 60000,
};

const sweepInFlightByAddress = new Map<string, Promise<string>>();

function toSigningUtxo(utxo: {
  outpoint: { transactionId: string; index: number };
  utxoEntry: {
    amount: string;
    scriptPublicKey: { version: number; scriptPublicKey: string };
    blockDaaScore: string;
    isCoinbase: boolean;
  };
}): UtxoForSigning {
  return {
    outpoint: utxo.outpoint,
    utxoEntry: {
      amount: utxo.utxoEntry.amount,
      scriptPublicKey: {
        version: utxo.utxoEntry.scriptPublicKey.version,
        script: utxo.utxoEntry.scriptPublicKey.scriptPublicKey,
      },
      blockDaaScore: utxo.utxoEntry.blockDaaScore,
      isCoinbase: utxo.utxoEntry.isCoinbase,
    },
  };
}

// pruning is handled by shared gateway-state module

function buildConfirmedPayments(
  address: string,
  utxos: Array<{
    address: string;
    outpoint: { transactionId: string; index: number };
    utxoEntry: { amount: string; blockDaaScore: string };
  }>,
): ObservedConfirmedPayment[] {
  return utxos
    .filter((utxo) => utxo.address === address)
    .map((utxo) => ({
      transactionHash: utxo.outpoint.transactionId,
      amountSompi: utxo.utxoEntry.amount,
      amountHtn: HoosatUtils.sompiToAmount(utxo.utxoEntry.amount),
      outputIndex: utxo.outpoint.index,
      blockDaaScore: utxo.utxoEntry.blockDaaScore,
    }));
}

function buildPendingPayments(
  address: string,
  entries: Array<{
    address: string;
    receiving: Array<{
      transaction: {
        transactionId: string;
        outputs: Array<{
          amount: string;
          verboseData?: { scriptPublicKeyAddress: string };
        }>;
      };
    }>;
  }>,
): ObservedPendingPayment[] {
  return entries
    .filter((entry) => entry.address === address)
    .flatMap((entry) =>
      entry.receiving.map((receivingEntry) => {
        const matchingOutputs = receivingEntry.transaction.outputs.filter(
          (output) => output.verboseData?.scriptPublicKeyAddress === address,
        );

        const totalSompi = matchingOutputs.reduce((sum, output) => sum + BigInt(output.amount), BigInt(0));

        return {
          transactionHash: receivingEntry.transaction.transactionId,
          amountSompi: totalSompi.toString(),
          amountHtn: HoosatUtils.sompiToAmount(totalSompi),
        };
      }),
    )
    .filter((entry) => entry.amountSompi !== "0");
}

async function sweepMerchantFunds(
  client: HoosatClient,
  merchantPrivateKey: string,
  destinationAddress: string,
): Promise<string> {
  const merchantWallet = HoosatCrypto.importKeyPair(merchantPrivateKey, "mainnet");
  const utxosResult = await client.getUtxosByAddresses([merchantWallet.address]);

  if (!utxosResult.ok || !utxosResult.result) {
    throw new Error(utxosResult.error ?? "Failed to load merchant UTXOs for sweep");
  }

  const signingUtxos = utxosResult.result.utxos.map(toSigningUtxo);

  if (signingUtxos.length === 0) {
    throw new Error("No merchant funds available to sweep");
  }

  const totalInput = signingUtxos.reduce((sum, utxo) => sum + BigInt(utxo.utxoEntry.amount), BigInt(0));
  const fee = HoosatCrypto.calculateMinFee(signingUtxos.length, 1);
  const outputAmount = totalInput - BigInt(fee);

  if (outputAmount <= 0) {
    throw new Error("Merchant balance is insufficient to cover sweep fee");
  }

  const builder = new HoosatTxBuilder();

  for (const utxo of signingUtxos) {
    builder.addInput(utxo, merchantWallet.privateKey);
  }

  builder.addOutput(destinationAddress, outputAmount.toString()).setFee(fee);

  const signedTransaction = builder.sign(merchantWallet.privateKey);
  const submitResult = await client.submitTransaction(signedTransaction);

  if (!submitResult.ok || !submitResult.result) {
    throw new Error(submitResult.error ?? "Failed to submit merchant sweep transaction");
  }

  return submitResult.result.transactionId;
}

async function findNetworkConfirmedPayment(
  client: HoosatClient,
  address: string,
  payments: ObservedConfirmedPayment[],
): Promise<ObservedConfirmedPayment | null> {
  if (payments.length === 0) {
    return null;
  }

  const dagInfoResult = await client.getBlockDagInfo();

  if (!dagInfoResult.ok || !dagInfoResult.result) {
    throw new Error(dagInfoResult.error ?? "Failed to query block DAG info");
  }

  const currentVirtualDaaScore = BigInt(dagInfoResult.result.virtualDaaScore);

  for (const payment of payments.sort((left, right) =>
    Number(BigInt(right.blockDaaScore) - BigInt(left.blockDaaScore)),
  )) {
    const blockResult = await client.getBlockByTransactionId(payment.transactionHash, true);

    if (!blockResult.ok || !blockResult.result) {
      continue;
    }

    const matchingTransaction = blockResult.result.transactions.find(
      (transaction) => transaction.verboseData.transactionId === payment.transactionHash,
    );

    if (!matchingTransaction) {
      continue;
    }

    const matchingOutput = matchingTransaction.outputs[payment.outputIndex];

    if (!matchingOutput) {
      continue;
    }

    if (matchingOutput.verboseData.scriptPublicKeyAddress !== address) {
      continue;
    }

    if (matchingOutput.amount !== payment.amountSompi) {
      continue;
    }

    const confirmations = Number(currentVirtualDaaScore - BigInt(blockResult.result.header.daaScore));

    return {
      ...payment,
      confirmations,
      blockHash: blockResult.result.verboseData.hash,
    };
  }

  return null;
}

async function findConfirmedTrackedCandidatePayment(
  client: HoosatClient,
  address: string,
  expectedAmountSompi: string,
  payments: ObservedPendingPayment[],
): Promise<ObservedConfirmedPayment | null> {
  if (payments.length === 0) {
    return null;
  }

  const dagInfoResult = await client.getBlockDagInfo();

  if (!dagInfoResult.ok || !dagInfoResult.result) {
    throw new Error(dagInfoResult.error ?? "Failed to query block DAG info");
  }

  const currentVirtualDaaScore = BigInt(dagInfoResult.result.virtualDaaScore);

  for (const payment of payments) {
    const txStatusResult = await client.getTransactionStatus(payment.transactionHash, address, address);

    if (!txStatusResult.ok || !txStatusResult.result) {
      continue;
    }

    if (txStatusResult.result.status !== "CONFIRMED") {
      continue;
    }

    const confirmedAmount = txStatusResult.result.details.confirmedAmount;
    const confirmedAddress = txStatusResult.result.details.confirmedAddress;
    const blockDaaScore = txStatusResult.result.details.blockDaaScore;

    if (!confirmedAmount || !blockDaaScore) {
      continue;
    }

    if (confirmedAddress !== address) {
      continue;
    }

    if (BigInt(confirmedAmount) !== BigInt(expectedAmountSompi)) {
      continue;
    }

    const confirmations = Number(currentVirtualDaaScore - BigInt(blockDaaScore));

    return {
      transactionHash: payment.transactionHash,
      amountSompi: confirmedAmount,
      amountHtn: HoosatUtils.sompiToAmount(confirmedAmount),
      outputIndex: -1,
      blockDaaScore,
      confirmations,
    };
  }

  return null;
}

export async function POST(request: NextRequest) {
  const client = new HoosatClient(SDK_NODE_CONFIG);
  let reservedSessionId: string | null = null;

  try {
    const now = Date.now();
    pruneExpiredSessions(now);

    const { address, amount, sessionId, action } = await request.json();

    if (!address) {
      return NextResponse.json({ error: "Merchant address is required" }, { status: 400 });
    }

    if (!amount) {
      return NextResponse.json({ error: "Payment amount is required" }, { status: 400 });
    }

    if (!sessionId) {
      return NextResponse.json({ error: "Payment session is required" }, { status: 400 });
    }

    if (!HoosatUtils.isValidAddress(address)) {
      return NextResponse.json({ error: "Invalid merchant address" }, { status: 400 });
    }

    const expectedAmountSompi = HoosatUtils.amountToSompi(String(amount));

    if (isSessionExpired(sessionId, now)) {
      return NextResponse.json(
        {
          paymentStatus: "expired",
          sessionExpired: true,
          error: "Payment session expired due to timeout. Please start a new payment.",
        },
        { status: 410 },
      );
    }

    if (action === "cancel-session") {
      typedPaymentSessions.delete(sessionId);
      clearExpiredSession(sessionId);
      return NextResponse.json({ ok: true, cancelled: true });
    }

    const existingSessionRaw = typedPaymentSessions.get(sessionId);
    const existingSession = existingSessionRaw as PaymentSession | undefined;
    const existingSessionMatches =
      existingSession?.address === address && existingSession?.amountSompi === expectedAmountSompi;

    const needsInitialization = !existingSessionMatches || Boolean(existingSession?.initializing);

    if (needsInitialization) {
      const activeOther = findActiveSessionForAddressAndAmount(address, expectedAmountSompi, {
        ignoreSessionId: sessionId,
        now,
      });

      if (activeOther) {
        return NextResponse.json(
          {
            paymentStatus: "gateway_in_use",
            activeSessionId: activeOther.sessionId,
            retryAfterSeconds: 5,
            error: "Payment gateway is currently processing another payment session.",
          },
          { status: 409 },
        );
      }

      if (!existingSessionMatches) {
        // Reserve the gateway for this session early to avoid races between two concurrent init requests.
        const reservedSession: PaymentSession = {
          address,
          amountSompi: expectedAmountSompi,
          knownConfirmedTxIds: new Set<string>(),
          knownPendingTxIds: new Set<string>(),
          trackedCandidatePayments: new Map<string, ObservedPendingPayment>(),
          completedPayment: null,
          sweepTransactionHash: null,
          createdAt: now,
          updatedAt: now,
          initializing: true,
        };

        typedPaymentSessions.set(sessionId, reservedSession);
        reservedSessionId = sessionId;
      }
    }

    const [utxosResult, mempoolResult] = await Promise.all([
      client.getUtxosByAddresses([address]),
      client.getMempoolEntriesByAddresses([address]),
    ]);

    if (!utxosResult.ok || !utxosResult.result) {
      return NextResponse.json({ error: utxosResult.error ?? "Failed to query address UTXOs" }, { status: 502 });
    }

    if (!mempoolResult.ok || !mempoolResult.result) {
      return NextResponse.json({ error: mempoolResult.error ?? "Failed to query mempool entries" }, { status: 502 });
    }

    const observedConfirmedPayments = buildConfirmedPayments(address, utxosResult.result.utxos);
    const observedPendingPayments = buildPendingPayments(address, mempoolResult.result.entries);

    const session = typedPaymentSessions.get(sessionId) ?? {
      address,
      amountSompi: expectedAmountSompi,
      knownConfirmedTxIds: new Set<string>(),
      knownPendingTxIds: new Set<string>(),
      trackedCandidatePayments: new Map<string, ObservedPendingPayment>(),
      completedPayment: null,
      sweepTransactionHash: null,
      createdAt: now,
      updatedAt: now,
      initializing: true,
    };

    const maybeSubmitSweepTransaction = async () => {
      if (!session.completedPayment) {
        return null;
      }

      if ((session.completedPayment.confirmations ?? 0) <= 1) {
        return null;
      }

      if (session.sweepTransactionHash) {
        return session.sweepTransactionHash;
      }

      const merchantPrivateKey = process.env.GATEWAY_WALLET_PRIVATE_KEY ?? process.env.MERCHANT_PRIVATE_KEY;
      const sweepAddress = process.env.MERCHANT_SWEEP_ADDRESS;

      if (!merchantPrivateKey) {
        throw new Error("GATEWAY_WALLET_PRIVATE_KEY is not configured");
      }

      if (!sweepAddress) {
        throw new Error("MERCHANT_SWEEP_ADDRESS is not configured");
      }

      if (!HoosatUtils.isValidAddress(sweepAddress)) {
        throw new Error("MERCHANT_SWEEP_ADDRESS is invalid");
      }

      const inFlight = sweepInFlightByAddress.get(address);

      if (inFlight) {
        session.sweepTransactionHash = await inFlight;
      } else {
        const sweepPromise = sweepMerchantFunds(client, merchantPrivateKey, sweepAddress);
        sweepInFlightByAddress.set(address, sweepPromise);
        try {
          session.sweepTransactionHash = await sweepPromise;
        } finally {
          sweepInFlightByAddress.delete(address);
        }
      }
      session.completedPayment = {
        ...session.completedPayment,
        sweepTransactionHash: session.sweepTransactionHash,
      };
      session.updatedAt = now;
      typedPaymentSessions.set(sessionId, session);

      return session.sweepTransactionHash;
    };

    if (needsInitialization) {
      for (const payment of observedConfirmedPayments) {
        session.knownConfirmedTxIds.add(payment.transactionHash);
      }

      for (const payment of observedPendingPayments) {
        session.knownPendingTxIds.add(payment.transactionHash);
      }

      session.initializing = false;
      session.updatedAt = now;
      typedPaymentSessions.set(sessionId, session);

      return NextResponse.json({
        paymentStatus: "waiting_for_payment",
        paymentDetails: null,
        expectedAmountSompi,
        expectedAmountHtn: HoosatUtils.sompiToAmount(expectedAmountSompi),
        observedConfirmedCount: observedConfirmedPayments.length,
        observedPendingCount: observedPendingPayments.length,
        sessionInitialized: true,
      });
    }

    if (session.completedPayment) {
      if (action === "confirm-transaction") {
        await maybeSubmitSweepTransaction();
      }

      session.updatedAt = now;
      typedPaymentSessions.set(sessionId, session);

      return NextResponse.json({
        paymentStatus: "completed",
        paymentDetails: {
          ...session.completedPayment,
          sweepTransactionHash: session.sweepTransactionHash ?? undefined,
        },
        expectedAmountSompi,
        expectedAmountHtn: HoosatUtils.sompiToAmount(expectedAmountSompi),
        observedConfirmedCount: observedConfirmedPayments.length,
        observedPendingCount: observedPendingPayments.length,
        sessionInitialized: false,
      });
    }

    const matchingConfirmedPayments = observedConfirmedPayments.filter(
      (payment) =>
        !session.knownConfirmedTxIds.has(payment.transactionHash) &&
        BigInt(payment.amountSompi) === BigInt(expectedAmountSompi),
    );

    const matchingPendingPayments = observedPendingPayments.filter(
      (payment) =>
        !session.knownPendingTxIds.has(payment.transactionHash) &&
        BigInt(payment.amountSompi) === BigInt(expectedAmountSompi),
    );

    for (const payment of matchingPendingPayments) {
      session.trackedCandidatePayments.set(payment.transactionHash, payment);
    }

    for (const payment of matchingConfirmedPayments) {
      session.trackedCandidatePayments.set(payment.transactionHash, {
        transactionHash: payment.transactionHash,
        amountSompi: payment.amountSompi,
        amountHtn: payment.amountHtn,
      });
    }

    for (const payment of observedConfirmedPayments) {
      session.knownConfirmedTxIds.add(payment.transactionHash);
    }

    for (const payment of observedPendingPayments) {
      session.knownPendingTxIds.add(payment.transactionHash);
    }

    session.updatedAt = now;
    typedPaymentSessions.set(sessionId, session);

    const trackedConfirmedPayments = observedConfirmedPayments.filter((payment) =>
      session.trackedCandidatePayments.has(payment.transactionHash),
    );

    const trackedCandidatePayments = Array.from(session.trackedCandidatePayments.values());

    const latestConfirmedPayment = await findNetworkConfirmedPayment(client, address, [
      ...matchingConfirmedPayments,
      ...trackedConfirmedPayments.filter(
        (payment) =>
          !matchingConfirmedPayments.some((candidate) => candidate.transactionHash === payment.transactionHash),
      ),
    ]);

    const latestConfirmedTrackedCandidate = latestConfirmedPayment
      ? null
      : await findConfirmedTrackedCandidatePayment(client, address, expectedAmountSompi, trackedCandidatePayments);

    const resolvedConfirmedPayment = latestConfirmedPayment ?? latestConfirmedTrackedCandidate;

    if (resolvedConfirmedPayment) {
      if ((resolvedConfirmedPayment.confirmations ?? 0) > 1) {
        session.completedPayment = resolvedConfirmedPayment;
        session.trackedCandidatePayments.delete(resolvedConfirmedPayment.transactionHash);
        if (action === "confirm-transaction") {
          await maybeSubmitSweepTransaction();
        }
        session.updatedAt = now;
        typedPaymentSessions.set(sessionId, session);

        return NextResponse.json({
          paymentStatus: "completed",
          paymentDetails: {
            ...session.completedPayment,
            sweepTransactionHash: session.sweepTransactionHash ?? undefined,
          },
          expectedAmountSompi,
          expectedAmountHtn: HoosatUtils.sompiToAmount(expectedAmountSompi),
          observedConfirmedCount: observedConfirmedPayments.length,
          observedPendingCount: observedPendingPayments.length,
          sessionInitialized: false,
        });
      }

      session.updatedAt = now;
      typedPaymentSessions.set(sessionId, session);

      return NextResponse.json({
        paymentStatus: "pending_confirmation",
        paymentDetails: resolvedConfirmedPayment,
        expectedAmountSompi,
        expectedAmountHtn: HoosatUtils.sompiToAmount(expectedAmountSompi),
        observedConfirmedCount: observedConfirmedPayments.length,
        observedPendingCount: observedPendingPayments.length,
        sessionInitialized: false,
      });
    }

    const latestPendingPayment = matchingPendingPayments[0] ?? null;

    const latestUnconfirmedObservedPayment =
      matchingConfirmedPayments.sort((left, right) =>
        Number(BigInt(right.blockDaaScore) - BigInt(left.blockDaaScore)),
      )[0] ?? null;

    const latestTrackedCandidatePayment =
      latestPendingPayment ??
      latestUnconfirmedObservedPayment ??
      Array.from(session.trackedCandidatePayments.values()).at(-1) ??
      null;

    return NextResponse.json({
      paymentStatus: latestTrackedCandidatePayment ? "pending_confirmation" : "waiting_for_payment",
      paymentDetails: latestTrackedCandidatePayment,
      expectedAmountSompi,
      expectedAmountHtn: HoosatUtils.sompiToAmount(expectedAmountSompi),
      observedConfirmedCount: observedConfirmedPayments.length,
      observedPendingCount: observedPendingPayments.length,
      sessionInitialized: false,
    });
  } catch (error) {
    console.error("Payment check error:", error);

    if (reservedSessionId) {
      const maybeReserved = typedPaymentSessions.get(reservedSessionId);
      if (maybeReserved?.initializing) {
        typedPaymentSessions.delete(reservedSessionId);
      }
    }

    return NextResponse.json({ error: "Failed to check payment status" }, { status: 500 });
  } finally {
    client.disconnect();
  }
}
