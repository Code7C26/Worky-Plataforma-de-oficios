import { EmailVerificationDeliveryError, verificationMailConfig } from "./email-verification";

type WorkyEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export async function sendWorkyEmail({ to, subject, text, html }: WorkyEmail) {
  const config = verificationMailConfig();

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to: [to],
      subject,
      text,
      html,
    }),
  }).catch(() => { throw new EmailVerificationDeliveryError("network_or_timeout"); });

  if (!response.ok) {
    throw new EmailVerificationDeliveryError("provider_rejected", response.status);
  }
}
