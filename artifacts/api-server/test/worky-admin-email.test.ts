import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { SendMailOptions } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { sendWorkyEmail, workyGmailConfig, WorkyEmailDeliveryError } from "../src/lib/worky-email";

const fixtureUser = "fixture-worky@gmail.com";
const fixturePassword = "abcdefghijklmnop";
const message = { to: "admin@example.test", subject: "Fixture code", text: "123456", html: "<p>123456</p>" };
let previousUser: string | undefined;
let previousPassword: string | undefined;

beforeEach(() => {
  previousUser = process.env.WORKY_ADMIN_GMAIL_USER;
  previousPassword = process.env.WORKY_ADMIN_GMAIL_APP_PASSWORD;
  process.env.WORKY_ADMIN_GMAIL_USER = fixtureUser;
  process.env.WORKY_ADMIN_GMAIL_APP_PASSWORD = fixturePassword;
});
afterEach(() => {
  if (previousUser === undefined) delete process.env.WORKY_ADMIN_GMAIL_USER;
  else process.env.WORKY_ADMIN_GMAIL_USER = previousUser;
  if (previousPassword === undefined) delete process.env.WORKY_ADMIN_GMAIL_APP_PASSWORD;
  else process.env.WORKY_ADMIN_GMAIL_APP_PASSWORD = previousPassword;
});

test("Gmail config requires a mailbox and application password, without provider fallback", () => {
  assert.throws(() => workyGmailConfig({}), WorkyEmailDeliveryError);
  assert.throws(() => workyGmailConfig({ WORKY_ADMIN_GMAIL_USER: "mailer@example.test", WORKY_ADMIN_GMAIL_APP_PASSWORD: fixturePassword }), WorkyEmailDeliveryError);
  assert.throws(() => workyGmailConfig({ WORKY_ADMIN_GMAIL_USER: fixtureUser, WORKY_ADMIN_GMAIL_APP_PASSWORD: "normal-password" }), WorkyEmailDeliveryError);
  assert.deepEqual(workyGmailConfig({
    WORKY_ADMIN_GMAIL_USER: ` ${fixtureUser.toUpperCase()} `,
    WORKY_ADMIN_GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop",
  }), { user: fixtureUser, pass: fixturePassword });
});

test("admin codes use encrypted Gmail SMTP and the authenticated Worky sender", async () => {
  let options: SMTPTransport.Options | undefined;
  let sent: SendMailOptions | undefined;
  let closed = false;
  await sendWorkyEmail(message, (config) => {
    options = config;
    return {
      sendMail: async (mail) => { sent = mail; return { accepted: [message.to], rejected: [] }; },
      close: () => { closed = true; },
    };
  });
  assert.equal(options?.host, "smtp.gmail.com");
  assert.equal(options?.port, 465);
  assert.equal(options?.secure, true);
  assert.equal(options?.tls?.rejectUnauthorized, true);
  assert.equal(options?.logger, false);
  assert.equal(options?.debug, false);
  assert.deepEqual(sent?.from, { name: "Worky", address: fixtureUser });
  assert.deepEqual(sent?.envelope, { from: fixtureUser, to: [message.to] });
  assert.equal(sent?.text, message.text);
  assert.equal(closed, true);
});

test("missing configuration refuses delivery before creating a connection", async () => {
  delete process.env.WORKY_ADMIN_GMAIL_APP_PASSWORD;
  let connections = 0;
  await assert.rejects(() => sendWorkyEmail(message, () => {
    connections++;
    throw new Error("must not connect");
  }), (error: unknown) => error instanceof WorkyEmailDeliveryError && error.reason === "missing_configuration");
  assert.equal(connections, 0);
});

test("SMTP failure is sanitized and closes the transport without another provider", async () => {
  let closed = false;
  await assert.rejects(() => sendWorkyEmail(message, () => ({
    sendMail: async () => { throw new Error(`unsafe diagnostic ${fixtureUser} ${fixturePassword}`); },
    close: () => { closed = true; },
  })), (error: unknown) => {
    assert.ok(error instanceof WorkyEmailDeliveryError);
    assert.equal(error.reason, "smtp_failure");
    assert.ok(!error.message.includes(fixtureUser));
    assert.ok(!error.message.includes(fixturePassword));
    return true;
  });
  assert.equal(closed, true);
});

test("rejected recipient is not reported as a successful send", async () => {
  await assert.rejects(() => sendWorkyEmail(message, () => ({
    sendMail: async () => ({ accepted: [], rejected: [message.to] }),
    close: () => {},
  })), (error: unknown) => error instanceof WorkyEmailDeliveryError && error.reason === "recipient_rejected");
});
