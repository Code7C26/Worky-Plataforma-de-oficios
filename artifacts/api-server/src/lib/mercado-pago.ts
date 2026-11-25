import { createHmac, timingSafeEqual } from "node:crypto";

export type MercadoPagoPreferenceRequest = {
  items: Array<{ id: string; title: string; quantity: number; currency_id: "ARS"; unit_price: number }>;
  external_reference: string;
  notification_url: string;
  back_urls: { success: string; failure: string; pending: string };
  auto_return: "approved";
};

export type MercadoPagoPreference = {
  id: string;
  init_point?: string;
  sandbox_init_point?: string;
};

export type MercadoPagoPayment = {
  id: number | string;
  status: string;
  external_reference?: string | null;
  preference_id?: string | null;
  transaction_amount?: number | null;
  currency_id?: string | null;
};

export function verifyMercadoPagoWebhookSignature(input: {
  signature: string | undefined;
  requestId: string | undefined;
  dataId: string;
  secret: string;
}) {
  if (!input.signature || !input.requestId || !input.dataId || !input.secret) return false;

  const values = new Map(input.signature.split(",").map((part) => {
    const [key, ...rest] = part.trim().split("=");
    return [key, rest.join("=")];
  }));
  const timestamp = values.get("ts");
  const receivedSignature = values.get("v1");
  if (!timestamp || !receivedSignature || !/^[a-f0-9]{64}$/i.test(receivedSignature)) return false;

  const manifest = `id:${input.dataId.toLowerCase()};request-id:${input.requestId};ts:${timestamp};`;
  const expected = createHmac("sha256", input.secret).update(manifest).digest();
  const received = Buffer.from(receivedSignature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function buildMercadoPagoWebhookSignature(input: {
  requestId: string;
  dataId: string;
  timestamp: string;
  secret: string;
}) {
  const manifest = `id:${input.dataId.toLowerCase()};request-id:${input.requestId};ts:${input.timestamp};`;
  return createHmac("sha256", input.secret).update(manifest).digest("hex");
}

export function getWorkyPublicOrigin(env: NodeJS.ProcessEnv = process.env) {
  const configuredUrl = env.WORKY_PUBLIC_URL?.trim();
  const configuredDomain = env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  const candidate = configuredUrl || (configuredDomain ? `https://${configuredDomain}` : "");
  if (!candidate) throw new Error("No está configurada la URL pública de Worky.");
  const url = new URL(candidate);
  if (url.protocol !== "https:" || !url.host) throw new Error("La URL pública de Worky debe usar HTTPS.");
  return url.origin;
}

export async function createMercadoPagoPreference(input: {
  accessToken: string;
  idempotencyKey: string;
  request: MercadoPagoPreferenceRequest;
  fetcher?: typeof fetch;
}) {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify(input.request),
  });
  if (!response.ok) throw new Error(`Mercado Pago rechazó la preferencia (${response.status}).`);
  const preference = await response.json() as MercadoPagoPreference;
  if (!preference.id || typeof preference.id !== "string") throw new Error("Mercado Pago devolvió una preferencia inválida.");
  return preference;
}

export async function getMercadoPagoPayment(input: {
  paymentId: string;
  accessToken: string;
  fetcher?: typeof fetch;
}) {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(input.paymentId)}`, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
  });
  if (!response.ok) throw new Error(`Mercado Pago no pudo verificar el pago (${response.status}).`);
  return await response.json() as MercadoPagoPayment;
}
