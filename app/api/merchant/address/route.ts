import { NextResponse } from "next/server";
import { HoosatCrypto } from "hoosat-sdk";

export const runtime = "nodejs";

export async function GET() {
  try {
    // Get merchant private key from environment (server-side only)
    const merchantPrivateKey = process.env.GATEWAY_WALLET_PRIVATE_KEY ?? process.env.MERCHANT_PRIVATE_KEY;

    if (!merchantPrivateKey) {
      return NextResponse.json(
        { error: "Merchant private key not configured (set GATEWAY_WALLET_PRIVATE_KEY)" },
        { status: 500 },
      );
    }

    // Generate merchant wallet from private key
    let merchantWallet: { address: string };
    try {
      merchantWallet = HoosatCrypto.importKeyPair(merchantPrivateKey, "mainnet");
    } catch (error) {
      console.error("Invalid merchant private key:", error);
      return NextResponse.json(
        { error: "Merchant private key is invalid (check GATEWAY_WALLET_PRIVATE_KEY)" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      address: merchantWallet.address,
      success: true,
    });
  } catch (error) {
    console.error("Error getting merchant address:", error);
    return NextResponse.json({ error: "Failed to get merchant address", success: false }, { status: 500 });
  }
}
