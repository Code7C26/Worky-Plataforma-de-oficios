import { randomUUID } from "node:crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";

export type GmailDeliveryFailureReason =
  | "missing_sender"
  | "invalid_recipient"
  | "provider_rejected"
  | "network_or_timeout";

export class GmailDeliveryError extends Error {
  constructor(readonly reason: GmailDeliveryFailureReason, readonly providerStatus?: number) {
    super(`Gmail delivery failed: ${reason}`);
    this.name = "GmailDeliveryError";
  }
}

export function gmailDeliveryFailureDetails(error: unknown) {
  return error instanceof GmailDeliveryError
    ? { reason: error.reason, providerStatus: error.providerStatus }
    : { reason: "internal_error" };
}

function isSafeEmailAddress(value: unknown): value is string {
  return typeof value === "string" &&
    /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value) &&
    !/[\r\n]/.test(value);
}

function encodeMimeHeader(value: string) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function encodeMimeBody(value: string) {
  const encoded = Buffer.from(value, "utf8").toString("base64");
  return encoded.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function createRawEmail({
  from,
  to,
  subject,
  text,
  html,
}: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}) {
  const boundary = `worky-email-${randomUUID()}`;
  const message = [
    `From: Worky <${from}>`,
    `To: ${to}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    encodeMimeBody(text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    encodeMimeBody(html),
    `--${boundary}--`,
    "",
  ].join("\r\n");

  return Buffer.from(message, "utf8").toString("base64url");
}

async function gmailRequest(path: string, body?: Record<string, unknown>) {
  try {
    const connectors = new ReplitConnectors();
    const gmailFetch = connectors.createProxyFetch("google-mail");
    const response = await gmailFetch(`https://gmail.googleapis.com${path}`, {
      method: body ? "POST" : "GET",
      ...(body ? {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new GmailDeliveryError("provider_rejected", response.status);
    }
    return response;
  } catch (error) {
    if (error instanceof GmailDeliveryError) throw error;
    throw new GmailDeliveryError("network_or_timeout");
  }
}

export async function sendGmailEmail({
  to,
  subject,
  text,
  html,
}: {
  to: string;
  subject: string;
  text: string;
  html: string;
}) {
  if (!isSafeEmailAddress(to)) throw new GmailDeliveryError("invalid_recipient");

  const profileResponse = await gmailRequest("/gmail/v1/users/me/profile");
  const profile = await profileResponse.json().catch(() => null) as { emailAddress?: unknown } | null;
  if (!isSafeEmailAddress(profile?.emailAddress)) throw new GmailDeliveryError("missing_sender");

  await gmailRequest("/gmail/v1/users/me/messages/send", {
    raw: createRawEmail({
      from: profile.emailAddress,
      to,
      subject,
      text,
      html,
    }),
  });
}
