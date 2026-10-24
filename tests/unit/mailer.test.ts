import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/server/config';
import { createMailer, loginCodeMail } from '../../src/server/mailer';

const mail = loginCodeMail('amiga@example.com', '482913', 10);

function fakeFetch(status = 200): {
  fn: typeof fetch;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response('{}', { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('correo por API (SMTP esta bloqueado en el plan gratuito de Render)', () => {
  it('Resend: POST a su API con la llave en Authorization y el texto del codigo', async () => {
    const { fn, calls } = fakeFetch();
    const mailer = createMailer(
      {
        provider: 'resend',
        apiKey: 're_llave',
        from: 'hola@juego.example',
        fromName: 'Gato Royale',
      },
      fn,
    );
    await mailer?.send(mail);
    expect(calls[0]?.url).toBe('https://api.resend.com/emails');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_llave');
    const body = JSON.parse(calls[0]?.init.body as string);
    expect(body).toMatchObject({
      from: 'Gato Royale <hola@juego.example>',
      to: ['amiga@example.com'],
    });
    expect(body.text).toContain('482913');
  });

  it('Brevo: POST con la llave en api-key y remitente verificado', async () => {
    const { fn, calls } = fakeFetch(201);
    const mailer = createMailer(
      {
        provider: 'brevo',
        apiKey: 'xkeysib-1',
        from: 'hola@juego.example',
        fromName: 'Gato Royale',
      },
      fn,
    );
    await mailer?.send(mail);
    expect(calls[0]?.url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((calls[0]?.init.headers as Record<string, string>)['api-key']).toBe('xkeysib-1');
    const body = JSON.parse(calls[0]?.init.body as string);
    expect(body.sender).toEqual({ name: 'Gato Royale', email: 'hola@juego.example' });
    expect(body.to).toEqual([{ email: 'amiga@example.com' }]);
    expect(body.textContent).toContain('482913');
  });

  it('si el proveedor responde con error, falla (y la ruta responde 502)', async () => {
    const { fn } = fakeFetch(401);
    const mailer = createMailer(
      { provider: 'resend', apiKey: 'mala', from: 'a@b.co', fromName: 'G' },
      fn,
    );
    await expect(mailer?.send(mail)).rejects.toThrow('Resend respondio 401');
  });

  it('sin configuracion no hay correo', () => {
    expect(createMailer(null)).toBeNull();
  });

  it('el mensaje dice el codigo, cuanto dura y que se ignore si no lo pidio', () => {
    expect(mail.subject).toContain('482913');
    expect(mail.text).toContain('10 minutos');
    expect(mail.text).toContain('ignora');
  });
});

describe('configuracion de acceso desde el entorno', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  const base = { NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(40) };

  it('el modo "console" del correo no existe en produccion', () => {
    process.env = { ...saved, ...base, EMAIL_PROVIDER: 'console' };
    expect(loadConfig().email).toBeNull();
    process.env = { ...saved, ...base, NODE_ENV: 'development', EMAIL_PROVIDER: 'console' };
    expect(loadConfig().email?.provider).toBe('console');
  });

  it('Resend y Brevo piden llave y remitente; sin ellos no se activan', () => {
    process.env = { ...saved, ...base, EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: 'k' };
    expect(loadConfig().email).toBeNull();
    process.env = {
      ...saved,
      ...base,
      EMAIL_PROVIDER: 'brevo',
      EMAIL_API_KEY: 'k',
      EMAIL_FROM: 'a@b.co',
    };
    expect(loadConfig().email).toMatchObject({ provider: 'brevo', from: 'a@b.co' });
  });

  it('Google solo se activa con id y secreto; la URL publica sale de Render si no se da', () => {
    process.env = { ...saved, ...base, GOOGLE_CLIENT_ID: 'id' };
    expect(loadConfig().google).toBeNull();
    process.env = {
      ...saved,
      ...base,
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 's',
      RENDER_EXTERNAL_URL: 'https://juego.onrender.com/',
    };
    const cfg = loadConfig();
    expect(cfg.google?.clientId).toBe('id');
    expect(cfg.publicUrl).toBe('https://juego.onrender.com');
  });

  it('el acceso con contrasena y el de invitado se apagan con una variable', () => {
    process.env = { ...saved, ...base, PASSWORD_AUTH: 'false', GUEST_LOGIN: 'false' };
    const cfg = loadConfig();
    expect(cfg.passwordAuth).toBe(false);
    expect(cfg.guestLogin).toBe(false);
    process.env = { ...saved, ...base };
    expect(loadConfig().passwordAuth).toBe(true);
  });
});
