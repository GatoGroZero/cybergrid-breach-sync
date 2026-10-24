import { nicknameSchema } from '../../shared/nickname';
import { api, ApiError, type User } from '../api';
import { $, trapFocus } from './dom';

const done = (id: number): string => `cg_apodo_${id}`;

/** Si este navegador ya confirmo el apodo de esta cuenta. Falla en silencio sin almacenamiento. */
export function nicknameConfirmed(user: User): boolean {
  if (user.provider === 'local') return true;
  try {
    return localStorage.getItem(done(user.id)) === '1';
  } catch {
    return false;
  }
}

function remember(user: User): void {
  try {
    localStorage.setItem(done(user.id), '1');
  } catch {
    // sin almacenamiento: se vuelve a preguntar la proxima vez
  }
}

/** Ventana para elegir o cambiar el apodo. Devuelve la cuenta actualizada, o null si se cancela. */
export class NicknameDialog {
  private readonly panel = $('nick-panel');
  private readonly input = $<HTMLInputElement>('nick-input');
  private readonly error = $('nick-error');
  private current: User | null = null;
  private finish: (user: User | null) => void = () => undefined;
  private release: (() => void) | null = null;

  constructor() {
    $<HTMLFormElement>('nick-form').addEventListener('submit', (e) => void this.save(e));
    $('nick-cancel').addEventListener('click', () => this.close(null));
    this.panel.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        e.stopPropagation();
        this.close(null);
      }
    });
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  open(user: User): Promise<User | null> {
    this.current = user;
    this.input.value = user.username;
    this.error.textContent = '';
    this.panel.hidden = false;
    this.release = trapFocus(this.panel);
    this.input.select();
    return new Promise((resolve) => {
      this.finish = resolve;
    });
  }

  private close(user: User | null): void {
    if (!this.current) return;
    // Cerrar sin cambiar tambien cuenta como confirmado: no se vuelve a preguntar.
    remember(this.current);
    this.panel.hidden = true;
    this.release?.();
    this.release = null;
    this.current = null;
    this.finish(user);
  }

  private async save(event: Event): Promise<void> {
    event.preventDefault();
    const user = this.current;
    if (!user) return;
    const parsed = nicknameSchema.safeParse(this.input.value);
    if (!parsed.success) {
      this.error.textContent = parsed.error.issues[0]?.message ?? 'Apodo inválido';
      return;
    }
    if (parsed.data === user.username) return this.close(null);
    const button = $<HTMLButtonElement>('nick-save');
    button.disabled = true;
    try {
      this.close(await api.setNickname(parsed.data));
    } catch (err) {
      this.error.textContent =
        err instanceof ApiError ? err.message : 'No se pudo conectar con el servidor';
    } finally {
      button.disabled = false;
    }
  }
}
