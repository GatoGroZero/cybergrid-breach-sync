import { z } from 'zod';
import { signinSchema, signupSchema } from '../../shared/br/protocol';
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

/** Pantalla de acceso: correo y contrasena (entrar o crear cuenta), Google, codigo por correo e invitado. */
export class AuthScreen {
  private mode: 'login' | 'signup' = 'login';
  private email = '';
  private cfg: AuthConfig = NO_CONFIG;

  /** Se llama al terminar de entrar por cualquier camino. */
  onLogin: (user: User) => void | Promise<void> = () => undefined;
  /** Se llama justo antes de salir hacia Google (para recordar a que sala iba el jugador). */
  onLeaveForGoogle: () => void = () => undefined;

  private readonly error = $('auth-error');
  private readonly loginForm = $<HTMLFormElement>('login-form');
  private readonly signupForm = $<HTMLFormElement>('signup-form');
  private readonly emailForm = $<HTMLFormElement>('email-form');
  private readonly codeForm = $<HTMLFormElement>('code-form');

  constructor() {
    $('btn-google').addEventListener('click', () => this.onLeaveForGoogle());
    this.emailForm.addEventListener('submit', (e) => void this.sendCode(e));
    this.codeForm.addEventListener('submit', (e) => void this.verifyCode(e));
    $('code-back').addEventListener('click', () => this.showEmailStep());
    $('btn-guest').addEventListener('click', () => void this.guest());

    $('to-signup').addEventListener('click', () => this.setMode('signup'));
    $('to-login').addEventListener('click', () => this.setMode('login'));
    this.loginForm.addEventListener('submit', (e) => void this.signin(e));
    this.signupForm.addEventListener('submit', (e) => void this.signup(e));
  }

  /** Deja la pantalla lista para mostrarse: campos limpios y solo las formas de entrar activas. */
  async prepare(message = ''): Promise<void> {
    this.setMode('login');
    this.showEmailStep();
    for (const form of [this.loginForm, this.signupForm]) form.reset();
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
    $('auth-guest').hidden = !guest;
    $('auth-others-title').hidden = !(google || email || guest) || !password;
    this.showForms();
  }

  /** Cambia entre entrar y crear cuenta. */
  private setMode(mode: 'login' | 'signup'): void {
    this.mode = mode;
    this.showForms();
    this.error.textContent = '';
  }

  /** Muestra el formulario de entrar o el de crear cuenta (solo si el servidor admite contrasena). */
  private showForms(): void {
    const password = this.cfg.password;
    this.loginForm.hidden = !password || this.mode !== 'login';
    this.signupForm.hidden = !password || this.mode !== 'signup';
    $('switch-signup').hidden = !password || this.mode !== 'login';
    $('switch-login').hidden = !password || this.mode !== 'signup';
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

  /** Entrar con el correo (o el usuario de una cuenta de demostracion) y la contrasena. */
  private async signin(event: Event): Promise<void> {
    event.preventDefault();
    this.error.textContent = '';
    const parsed = signinSchema.safeParse({
      identifier: $<HTMLInputElement>('login-email').value,
      password: $<HTMLInputElement>('login-pass').value,
    });
    if (!parsed.success) {
      this.error.textContent = 'Escribe tu correo y tu contraseña';
      return;
    }
    await this.busy($<HTMLButtonElement>('login-submit'), async () => {
      const user = await api.signin(parsed.data.identifier, parsed.data.password);
      $<HTMLInputElement>('login-pass').value = '';
      await this.onLogin(user);
    });
  }

  /** Crear una cuenta con correo, contrasena y la contrasena repetida. */
  private async signup(event: Event): Promise<void> {
    event.preventDefault();
    this.error.textContent = '';
    const password = $<HTMLInputElement>('signup-pass').value;
    const confirm = $<HTMLInputElement>('signup-confirm').value;
    const parsed = signupSchema.safeParse({
      email: $<HTMLInputElement>('signup-email').value,
      password,
      confirm,
    });
    if (!parsed.success) {
      this.error.textContent = parsed.error.issues[0]?.message ?? 'Datos inválidos';
      return;
    }
    await this.busy($<HTMLButtonElement>('signup-submit'), async () => {
      const user = await api.signup(parsed.data.email, password, confirm);
      for (const id of ['signup-pass', 'signup-confirm']) $<HTMLInputElement>(id).value = '';
      await this.onLogin(user);
    });
  }
}
