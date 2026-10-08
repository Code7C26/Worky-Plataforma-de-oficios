import nodemailer, { type SendMailOptions } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

type WorkyEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

type MailTransport = {
  sendMail(message: SendMailOptions): Promise<{ accepted?: unknown[]; rejected?: unknown[] }>;
  close(): void;
};
type TransportFactory = (options: SMTPTransport.Options) => MailTransport;

export class WorkyEmailDeliveryError extends Error {
  constructor(readonly reason: "missing_configuration" | "invalid_configuration" | "smtp_failure" | "recipient_rejected") {
    super(`Worky email delivery failed: ${reason}`);
    this.name = "WorkyEmailDeliveryError";
  }
}

export function workyGmailConfig(env: Record<string, string | undefined> = process.env) {
  const user = env.WORKY_ADMIN_GMAIL_USER?.trim().toLowerCase();
  const pass = env.WORKY_ADMIN_GMAIL_APP_PASSWORD?.replace(/\s/g, "");
  if (!user || !pass) throw new WorkyEmailDeliveryError("missing_configuration");
  if (!/^[^\s@]+@gmail\.com$/.test(user) || !/^[a-zA-Z0-9]{16}$/.test(pass)) {
    throw new WorkyEmailDeliveryError("invalid_configuration");
  }
  return { user, pass };
}

// Used only by privileged admin signup; existing Worky mail flows remain unchanged.
export async function sendWorkyEmail(
  { to, subject, text, html }: WorkyEmail,
  createTransport: TransportFactory = (options) => nodemailer.createTransport(options),
) {
  const config = workyGmailConfig();
  let transport: MailTransport | undefined;
  try {
    transport = createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: config,
      tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    const result = await transport.sendMail({
      from: { name: "Worky", address: config.user },
      envelope: { from: config.user, to: [to] },
      to,
      subject,
      text,
      html,
    });
    if (!result.accepted?.length || result.rejected?.length) {
      throw new WorkyEmailDeliveryError("recipient_rejected");
    }
  } catch (error) {
    if (error instanceof WorkyEmailDeliveryError) throw error;
    // Never attach/log raw SMTP errors: they may contain mailbox or authentication details.
    throw new WorkyEmailDeliveryError("smtp_failure");
  } finally {
    transport?.close();
  }
}
