import { promises as fs } from "fs";
import path from "path";

type TokenStoreFile = {
  shops: Record<string, { accessToken: string; updatedAt: string }>;
};

const STORE_DIR = path.join(process.cwd(), ".data");
const STORE_FILE = path.join(STORE_DIR, "shopify-tokens.json");

function normalizeShopDomain(shop: string): string {
  const trimmed = shop.trim().toLowerCase();
  if (!trimmed) throw new Error("Missing shop");
  // allow either foo.myshopify.com or custom domains, but block obvious injection
  if (!/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/.test(trimmed)) {
    throw new Error("Invalid shop domain");
  }
  return trimmed;
}

function getMemoryStore(): Map<string, { accessToken: string; updatedAt: string }> {
  const g = globalThis as unknown as {
    __SHOPIFY_TOKEN_STORE__?: Map<string, { accessToken: string; updatedAt: string }>;
    __SHOPIFY_TOKEN_STORE_LOADED__?: boolean;
  };

  if (!g.__SHOPIFY_TOKEN_STORE__) {
    g.__SHOPIFY_TOKEN_STORE__ = new Map();
  }
  return g.__SHOPIFY_TOKEN_STORE__;
}

async function ensureLoadedFromDisk() {
  const g = globalThis as unknown as { __SHOPIFY_TOKEN_STORE_LOADED__?: boolean };
  if (g.__SHOPIFY_TOKEN_STORE_LOADED__) return;

  const mem = getMemoryStore();
  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as TokenStoreFile;
    for (const [shop, record] of Object.entries(parsed.shops ?? {})) {
      if (record?.accessToken) {
        mem.set(shop, { accessToken: record.accessToken, updatedAt: record.updatedAt ?? new Date().toISOString() });
      }
    }
  } catch {
    // ignore; file likely doesn't exist yet
  }

  g.__SHOPIFY_TOKEN_STORE_LOADED__ = true;
}

async function persistToDisk() {
  const mem = getMemoryStore();
  const file: TokenStoreFile = { shops: {} };
  for (const [shop, record] of mem.entries()) {
    file.shops[shop] = record;
  }

  await fs.mkdir(STORE_DIR, { recursive: true });
  await fs.writeFile(STORE_FILE, JSON.stringify(file, null, 2), "utf8");
}

export async function getShopAccessToken(shopInput: string): Promise<string | null> {
  const shop = normalizeShopDomain(shopInput);

  // single-store fallback for "self runnable" mode (no OAuth)
  const envShop = process.env.SHOPIFY_SHOP_DOMAIN?.trim().toLowerCase();
  const envToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim();
  if (envShop && envToken && shop === envShop) {
    return envToken;
  }

  await ensureLoadedFromDisk();
  const mem = getMemoryStore();
  return mem.get(shop)?.accessToken ?? null;
}

export async function setShopAccessToken(shopInput: string, accessToken: string): Promise<void> {
  const shop = normalizeShopDomain(shopInput);
  if (!accessToken?.trim()) throw new Error("Missing access token");

  await ensureLoadedFromDisk();
  const mem = getMemoryStore();
  mem.set(shop, { accessToken: accessToken.trim(), updatedAt: new Date().toISOString() });
  await persistToDisk();
}

export function requireShopifyEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}
