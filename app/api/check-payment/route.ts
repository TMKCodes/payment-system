import { NextRequest, NextResponse } from "next/server";
import { HoosatUtils } from "hoosat-sdk";

import { checkPaymentStatus } from "@/lib/htn/paymentTracker";

export async function POST(request: NextRequest) {
  try {
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
    const result = await checkPaymentStatus({
      address,
      amount: String(amount),
      sessionId,
      action,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Payment check error:", error);
    return NextResponse.json({ error: "Failed to check payment status" }, { status: 500 });
  }
}
