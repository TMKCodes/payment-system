import { NextResponse } from 'next/server';
import { HoosatCrypto } from 'hoosat-sdk';

export async function GET() {
    try {
        // Get merchant private key from environment (server-side only)
        const merchantPrivateKey = process.env.MERCHANT_PRIVATE_KEY;

        if (!merchantPrivateKey) {
            return NextResponse.json(
                { error: 'Merchant private key not configured' },
                { status: 500 }
            );
        }

        // Generate merchant wallet from private key
        const merchantWallet = HoosatCrypto.importKeyPair(merchantPrivateKey, 'mainnet');

        return NextResponse.json({
            address: merchantWallet.address,
            success: true
        });
    } catch (error) {
        console.error('Error getting merchant address:', error);
        return NextResponse.json(
            { error: 'Failed to get merchant address', success: false },
            { status: 500 }
        );
    }
}