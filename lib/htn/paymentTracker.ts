import { HoosatClient, HoosatCrypto, HoosatTxBuilder, HoosatUtils, type UtxoForSigning } from "hoosat-sdk";

export type CheckPaymentAction = "confirm-transaction" | undefined;

export type CheckPaymentRequest = {
  address: string;
  amount: string;
  sessionId: string;
  action?: CheckPaymentAction;
};

export type CheckPaymentResponse = {
  paymentStatus: "waiting_for_payment" | "pending_confirmation" | "completed";
  paymentDetails: {
    transactionHash: string;
    amountSompi: string;
    amountHtn: string;
    outputIndex?: number;
    blockDaaScore?: string;
    confirmations?: number;
    blockHash?: string;
    sweepTransactionHash?: string;
  } | null;
  expectedAmountSompi: string;
  expectedAmountHtn: string;
  observedConfirmedCount: number;
  observedPendingCount: number;
  sessionInitialized: boolean;
};

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

const sdkNodePort = Number.parseInt(process.env.HOOSAT_NODE_PORT ?? "42420", 10);
const sdkNodeTimeout = Number.parseInt(process.env.HOOSAT_NODE_TIMEOUT ?? "10000", 10);

const SDK_NODE_CONFIG = {
  host: process.env.HOOSAT_NODE_HOST ?? "mainnet-node-1.hoosat.fi",
  port: Number.isFinite(sdkNodePort) ? sdkNodePort : 42420,
  timeout: Number.isFinite(sdkNodeTimeout) ? sdkNodeTimeout : 10000,
};

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

function getSessionStore(): Map<string, PaymentSession> {
  const g = globalThis as unknown as { __HTN_PAYMENT_SESSIONS__?: Map<string, PaymentSession> };
  if (!g.__HTN_PAYMENT_SESSIONS__) {
    g.__HTN_PAYMENT_SESSIONS__ = new Map<string, PaymentSession>();
  }
  return g.__HTN_PAYMENT_SESSIONS__;
}

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

function pruneExpiredSessions(paymentSessions: Map<string, PaymentSession>) {
  const now = Date.now();

  for (const [sessionId, session] of paymentSessions.entries()) {
    if (now - session.updatedAt > SESSION_TTL_MS) {
      paymentSessions.delete(sessionId);
    }
  }
}

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
  pendingCandidates: ObservedPendingPayment[],
): Promise<ObservedConfirmedPayment | null> {
  if (pendingCandidates.length === 0) {
    return null;
  }

  const dagInfoResult = await client.getBlockDagInfo();

  if (!dagInfoResult.ok || !dagInfoResult.result) {
    throw new Error(dagInfoResult.error ?? "Failed to query block DAG info");
  }

  const currentVirtualDaaScore = BigInt(dagInfoResult.result.virtualDaaScore);

  for (const payment of pendingCandidates) {
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

    if (BigInt(confirmedAmount) < BigInt(expectedAmountSompi)) {
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

export async function checkPaymentStatus(input: CheckPaymentRequest): Promise<CheckPaymentResponse> {
  const paymentSessions = getSessionStore();
  const client = new HoosatClient(SDK_NODE_CONFIG);

  try {
    pruneExpiredSessions(paymentSessions);

    const { address, amount, sessionId, action } = input;

    if (!address) {
      throw new Error("Merchant address is required");
    }

    if (!amount) {
      throw new Error("Payment amount is required");
    }

    if (!sessionId) {
      throw new Error("Payment session is required");
    }

    if (!HoosatUtils.isValidAddress(address)) {
      throw new Error("Invalid merchant address");
    }

    const expectedAmountSompi = HoosatUtils.amountToSompi(String(amount));

    const [utxosResult, mempoolResult] = await Promise.all([
      client.getUtxosByAddresses([address]),
      client.getMempoolEntriesByAddresses([address]),
    ]);

    if (!utxosResult.ok || !utxosResult.result) {
      throw new Error(utxosResult.error ?? "Failed to query address UTXOs");
    }

    if (!mempoolResult.ok || !mempoolResult.result) {
      throw new Error(mempoolResult.error ?? "Failed to query mempool entries");
    }

    const observedConfirmedPayments = buildConfirmedPayments(address, utxosResult.result.utxos);
    const observedPendingPayments = buildPendingPayments(address, mempoolResult.result.entries);

    const now = Date.now();
    const existingSession = paymentSessions.get(sessionId);

    const session: PaymentSession =
      existingSession && existingSession.address === address && existingSession.amountSompi === expectedAmountSompi
        ? existingSession
        : {
            address,
            amountSompi: expectedAmountSompi,
            knownConfirmedTxIds: new Set<string>(),
            knownPendingTxIds: new Set<string>(),
            trackedCandidatePayments: new Map<string, ObservedPendingPayment>(),
            completedPayment: null,
            sweepTransactionHash: null,
            createdAt: now,
            updatedAt: now,
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

      const merchantPrivateKey = process.env.MERCHANT_PRIVATE_KEY;
      const sweepAddress = process.env.MERCHANT_SWEEP_ADDRESS;

      if (!merchantPrivateKey) {
        throw new Error("MERCHANT_PRIVATE_KEY is not configured");
      }

      if (!sweepAddress) {
        throw new Error("MERCHANT_SWEEP_ADDRESS is not configured");
      }

      if (!HoosatUtils.isValidAddress(sweepAddress)) {
        throw new Error("MERCHANT_SWEEP_ADDRESS is invalid");
      }

      session.sweepTransactionHash = await sweepMerchantFunds(client, merchantPrivateKey, sweepAddress);
      session.completedPayment = {
        ...session.completedPayment,
        sweepTransactionHash: session.sweepTransactionHash,
      };
      session.updatedAt = now;
      paymentSessions.set(sessionId, session);

      return session.sweepTransactionHash;
    };

    const isNewSession = !existingSession || session !== existingSession;

    if (isNewSession) {
      for (const payment of observedConfirmedPayments) {
        session.knownConfirmedTxIds.add(payment.transactionHash);
      }

      for (const payment of observedPendingPayments) {
        session.knownPendingTxIds.add(payment.transactionHash);
      }

      paymentSessions.set(sessionId, session);

      return {
        paymentStatus: "waiting_for_payment",
        paymentDetails: null,
        expectedAmountSompi,
        expectedAmountHtn: HoosatUtils.sompiToAmount(expectedAmountSompi),
        observedConfirmedCount: observedConfirmedPayments.length,
        observedPendingCount: observedPendingPayments.length,
        sessionInitialized: true,
      };
    }

    if (session.completedPayment) {
      if (action === "confirm-transaction") {
        await maybeSubmitSweepTransaction();
      }

      session.updatedAt = now;
      paymentSessions.set(sessionId, session);

      return {
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
      };
    }

    const matchingConfirmedPayments = observedConfirmedPayments.filter(
      (payment) =>
        !session.knownConfirmedTxIds.has(payment.transactionHash) &&
        BigInt(payment.amountSompi) >= BigInt(expectedAmountSompi),
    );

    const matchingPendingPayments = observedPendingPayments.filter(
      (payment) =>
        !session.knownPendingTxIds.has(payment.transactionHash) &&
        BigInt(payment.amountSompi) >= BigInt(expectedAmountSompi),
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
    paymentSessions.set(sessionId, session);

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
        paymentSessions.set(sessionId, session);

        return {
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
        };
      }

      session.updatedAt = now;
      paymentSessions.set(sessionId, session);

      return {
        paymentStatus: "pending_confirmation",
        paymentDetails: resolvedConfirmedPayment,
        expectedAmountSompi,
        expectedAmountHtn: HoosatUtils.sompiToAmount(expectedAmountSompi),
        observedConfirmedCount: observedConfirmedPayments.length,
        observedPendingCount: observedPendingPayments.length,
        sessionInitialized: false,
      };
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

    return {
      paymentStatus: latestTrackedCandidatePayment ? "pending_confirmation" : "waiting_for_payment",
      paymentDetails: latestTrackedCandidatePayment,
      expectedAmountSompi,
      expectedAmountHtn: HoosatUtils.sompiToAmount(expectedAmountSompi),
      observedConfirmedCount: observedConfirmedPayments.length,
      observedPendingCount: observedPendingPayments.length,
      sessionInitialized: false,
    };
  } finally {
    client.disconnect();
  }
}
