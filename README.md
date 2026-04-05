# HTN payment gateway

A minimal HTN payment gateway for Hoosat cryptocurrency. Allows merchants to create payment requests and display QR codes for buyers to scan and pay.

## Features

- Create payment requests with custom amounts
- Generate QR codes containing Hoosat payment URIs
- **Real payment confirmation checking** via Hoosat blockchain using the official Hoosat SDK
- **Seperate payment gateway** - all payments go to your configured payment gateway wallet
- Automatic payment confirmation when funds are received and sweeped upwards to merchant bigger wallet
- Installable PWA shell for mobile devices with cached client assets

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure merchant wallet:**
   
   Create a `.env.local` file in the project root:
   ```bash
   # Payment Gateway Wallet Configuration
   # Replace this with your actual Hoosat private key (64-character hex string) can be generated with genkeypair
   MERCHANT_PRIVATE_KEY=33a4a81ecd31615c51385299969121707897fb1e167634196f31bd311de5fe43

   # Destination address for sweeping payment gateway funds after payment confirmation
   MERCHANT_SWEEP_ADDRESS=hoosat:qzemxtcz54tvjcd5pwvh8d494997k762md4t8q9aw3kxjy4qjtmtsqtdlw3gh

   # Hoosat SDK node configuration
   HOOSAT_NODE_HOST=mainnet-node-1.hoosat.fi
   HOOSAT_NODE_PORT=42420
   HOOSAT_NODE_TIMEOUT=10000 
   ```

3. **Run the development server:**
   ```bash
   npm run dev
   ```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the merchant interface.

## Usage

1. Enter the payment amount in HTN (Hoosat tokens)
2. Click "Generate Payment QR Code"
3. Display the QR code to the buyer
4. Buyer scans the QR code with their Hoosat wallet to complete the payment


## Built with

- Next.js
- TypeScript
- Tailwind CSS
- **Hoosat Web SDK** - Browser-compatible SDK for Hoosat blockchain integration.
- **Hoosat SDK** - Node-compatible SDK for Hoosat blockchain integration.