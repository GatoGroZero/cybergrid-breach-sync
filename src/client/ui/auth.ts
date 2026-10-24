import { z } from 'zod';
import { credentialsSchema } from '../../shared/br/protocol';
import { api, ApiError, type AuthConfig, type User } from '../api';
import { $ } from './dom';

const ERROR_TEXT: Record<string, string> = {
  google_cancelado: 'Cancelaste el acceso con Google',
  google_fallo: 'No pudimos entrar con Google, intenta de nuevo',
  demasiados_intentos: 'Demasiados intentos, espera unos minutos',
};

/** Mensaje legible para el codigo de error que el servidor deja en la URL al volver de Google. */
export const authErrorText = (code: string | null): string =>
  code ? (ERROR_TEXT[code] ?? 'No se pudo iniciar sesión') : '';

const emailSchema = z.string().trim().email('Escribe un correo válido');
const NO_CONFIG: AuthConfig = { google: false, email: false, guest: true, password: false };

/** Pantalla de acceso: Google, codigo por correo, invitado y (si esta activo) usuario y contrasena. */
export class AuthScreen {
  private mode: 'login' | 'register' = 'login';
  private email = '';
  private cfg: AuthConfig = NO_CONFIG;

  /** Se llama al terminar de entrar por cualquier camino. */
  onLogin: (user: User) => void | Promise<void> = () => undefined;
  /** Se llama justo antes de salir hacia Google (para recordar a que sala iba el jugador). */
  onLeaveForGoogle: () => void = () => undefined;

  private readonly error = $('auth-error');
  private readonly emailForm = $<HTMLFormElement>('email-form');
  private readonly codeForm = $<HTMLFormElement>('code-form');

  constructor() {
    $('btn-google').addEventListener('click', () => this.onLeaveForGoogle());
    this.emailForm.addEventListener('submit', (e) => void this.sendCode(e));
    this.codeForm.addEventListener('submit', (e) => void this.verifyCode(e));
    $('code-back').addEventListener('click', () => this.showEmailStep());
    $('btn-guest').addEventListener('click', () => void this.guest());

    $('tab-login').addEventListener('click', () => this.setMode('login'));
    $('tab-register').addEventListener('click', () => this.setMode('register'));
    $<HTMLFormElement>('auth-form').addEventListener('submit', (e) => void this.submitPassword(e));
  }

  /** Deja la pantalla lista para mostrarse: campos limpios y solo las formas de entrar activas. */
  async prepare(message = ''): Promise<void> {
    this.setMode('login');
    this.showEmailStep();
    this.error.textContent = message;
    try {
      this.cfg = await api.config();
    } catch {
      this.cfg = NO_CONFIG;
      if (!message) this.error.textContent = 'No se pudo conectar con el servidor';
    }
    const { google, email, guest, password } = this.cfg;
    $('btn-google').hidden = !google;
    $('auth-email').hidden = !email;
    $('or-email').hidden = !google;
    $('auth-guest').hidden = !guest;
    $('or-guest').hidden = !google && !email;
    const legacy = $<HTMLDetailsElement>('auth-legacy');
    legacy.hidden = !password;
    // Si es lo unico que hay, se muestra abierto.
    legacy.open = password && !google && !email && !guest;
  }

  private setMode(mode: 'login' | 'register'): void {
    this.mode = mode;
    $('tab-login').classList.toggle('is-active', mode === 'login');
    $('tab-register').classList.toggle('is-active', mode === 'register');
    $('tab-login').setAttribute('aria-selected', String(mode === 'login'));
    $('tab-register').setAttribute('aria-selected', String(mode === 'register'));
    $('auth-submit').textContent = mode === 'login' ? 'Entrar' : 'Crear cuenta';
    $<HTMLInputElement>('auth-pass').autocomplete =
      mode === 'login' ? 'current-password' : 'new-password';
    this.error.textContent = '';
  }

  private showEmailStep(): void {
    this.codeForm.hidden = true;
    this.emailForm.hidden = false;
    $<HTMLInputElement>('email-code').value = '';
  }

  private fail(err: unknown): void {
    this.error.textContent =
      err instanceof ApiError ? err.message : 'No se pudo conectar con el servidor';
  }

  /** Bloquea el boton mientras dura la peticion para que un doble toque no mande dos. */
  private async busy(button: HTMLButtonElement, work: () => Promise<void>): Promise<void> {
    button.disabled = true;
    try {
      await work();
    } catch (err) {
      this.fail(err);
    } finally {
      button.disabled = false;
    }
  }

  private async sendCode(event: Event): Promise<void> {
    event.preventDefault();
    this.error.textContent = '';
    const parsed = emailSchema.safeParse($<HTMLInputElement>('email-address').value);
    if (!parsed.success) {
      this.error.textContent = parsed.error.issues[0]?.message ?? 'Escribe un correo válido';
      return;
    }
    await this.busy($<HTMLButtonElement>('email-send'), async () => {
      await api.emailStart(parsed.data);
      this.email = parsed.data;
      $('code-help').textContent =
        `Te mandamos un código de 6 números a ${parsed.data}. Dura 10 minutos.`;
      this.emailForm.hidden = true;
      this.codeForm.hidden = false;
      $<HTMLInputElement>('email-code').focus();
    });
  }

  private async verifyCode(event: Event): Promise<void> {
    event.preventDefault();
    this.error.textContent = '';
    const code = $<HTMLInputElement>('email-code').value.trim();
    if (!/^\d{6}$/.test(code)) {
      this.error.textContent = 'El código tiene 6 números';
      return;
    }
    await this.busy($<HTMLButtonElement>('code-submit'), async () => {
      await this.onLogin(await api.emailVerify(this.email, code));
    });
  }

  private async guest(): Promise<void> {
    this.error.textContent = '';
    await this.busy($<HTMLButtonElement>('btn-guest'), async () => {
      await this.onLogin(await api.guest());
    });
  }

  private async submitPassword(event: Event): Promise<void> {
    event.preventDefault();
    const username = $<HTMLInputElement>('auth-user').value.trim();
    const password = $<HTMLInputElement>('auth-pass').value;
    this.error.textContent = '';

    if (this.mode === 'register') {
      const parsed = credentialsSchema.safeParse({ username, password });
      if (!parsed.success) {
        this.error.textContent = parsed.error.issues[0]?.message ?? 'Datos inválidos';
        return;
      }
    } else if (!username || !password) {
      this.error.textContent = 'Escribe tu usuario y tu contraseña';
      return;
    }
    await this.busy($<HTMLButtonElement>('auth-submit'), async () => {
      const user =
        this.mode === 'login'
          ? await api.login(username, password)
          : await api.register(username, password);
      $<HTMLInputElement>('auth-pass').value = '';
      await this.onLogin(user);
    });
  }
}
