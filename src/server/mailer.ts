import type { EmailConfig } from './config';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

type Fetch = typeof fetch;
const TIMEOUT_MS = 8000;

/** Los servicios gratuitos como Render bloquean SMTP, asi que el correo sale por API HTTPS. */
async function post(
  doFetch: Fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  name: string,
): Promise<void> {
  const res = await doFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${name} respondio ${res.status}`);
}

export function createMailer(config: EmailConfig | null, doFetch: Fetch = fetch): Mailer | null {
  if (!config) return null;
  const sender = `${config.fromName} <${config.from}>`;
  switch (config.provider) {
    case 'resend':
      return {
        send: (mail) =>
          post(
            doFetch,
            'https://api.resend.com/emails',
            { Authorization: `Bearer ${config.apiKey}` },
            { from: sender, to: [mail.to], subject: mail.subject, text: mail.text },
            'Resend',
          ),
      };
    case 'brevo':
      return {
        send: (mail) =>
          post(
            doFetch,
            'https://api.brevo.com/v3/smtp/email',
            { 'api-key': config.apiKey },
            {
              sender: { name: config.fromName, email: config.from },
              to: [{ email: mail.to }],
              subject: mail.subject,
              textContent: mail.text,
            },
            'Brevo',
          ),
      };
    case 'console':
      return {
        send: async (mail) => {
          console.info(`[correo de prueba] para ${mail.to}: ${mail.subject}\n${mail.text}`);
        },
      };
  }
}

export function loginCodeMail(to: string, code: string, minutes: number): Mail {
  return {
    to,
    subject: `Tu código de Gato Royale: ${code}`,
    text: [
      `Tu código para entrar a Gato Royale es ${code}.`,
      '',
      `Caduca en ${minutes} minutos y solo sirve una vez.`,
      'Si no lo pediste tú, ignora este correo: nadie puede entrar sin el código.',
    ].join('\n'),
  };
}
