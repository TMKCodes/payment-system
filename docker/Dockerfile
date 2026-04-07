FROM node:20-bookworm-slim AS builder

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=5645

# Payment Gateway Wallet Configuration
# Replace this with your actual Hoosat private key (64-character hex string) can be generated with genkeypair
ENV GATEWAY_WALLET_PRIVATE_KEY=33a4a81ecd31615c51385299969121707897fb1e167634196f31bd311de5fe43

# Destination address for sweeping payment gateway funds after payment confirmation
ENV MERCHANT_SWEEP_ADDRESS=hoosat:qzemxtcz54tvjcd5pwvh8d494997k762md4t8q9aw3kxjy4qjtmtsqtdlw3gh 

# Hoosat SDK node configuration
ENV HOOSAT_NODE_HOST=mainnet-node-1.hoosat.fi
ENV HOOSAT_NODE_PORT=42420
ENV HOOSAT_NODE_TIMEOUT=10000
# Used by the gateway to sign WooCommerce callbacks
ENV WOOCOMMERCE_SHARED_SECRET=your_unique_shared_secret_here

# Comma-separated list of allowed WooCommerce site origins for callback/return URLs

ENV WOOCOMMERCE_ALLOWED_ORIGINS=https://wordpress.hoosat.fi


WORKDIR /app

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER node

EXPOSE 5645

CMD ["node", "server.js"]