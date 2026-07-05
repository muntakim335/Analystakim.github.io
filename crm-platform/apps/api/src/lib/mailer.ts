import type { Config } from '../config.js';

export interface Mailer {
  readonly enabled: boolean;
  send(to: string, subject: string, text: string): Promise<void>;
}

/** SMTP mailer when SMTP_URL is configured; silent no-op otherwise (actions log as skipped). */
export async function createMailer(config: Config): Promise<Mailer> {
  if (!config.SMTP_URL) {
    return { enabled: false, send: async () => {} };
  }
  const nodemailer = await import('nodemailer');
  const transport = nodemailer.default.createTransport(config.SMTP_URL);
  return {
    enabled: true,
    async send(to, subject, text) {
      await transport.sendMail({ from: config.SMTP_FROM, to, subject, text });
    },
  };
}
