import { z } from 'zod';

export const NICK_MIN = 3;
export const NICK_MAX = 16;

const WORD = '[A-Za-zÀ-ÖØ-öø-ÿ0-9_]+';
/** Letras latinas con acentos, numeros y guion bajo; palabras separadas por un solo espacio. */
export const NICK_PATTERN = new RegExp(`^${WORD}(?: ${WORD})*$`);
const OUTSIDE = /[^A-Za-zÀ-ÖØ-öø-ÿ0-9_ ]+/g;

export const nicknameSchema = z
  .string()
  .trim()
  .min(NICK_MIN, `El apodo debe tener al menos ${NICK_MIN} caracteres`)
  .max(NICK_MAX, `El apodo no puede pasar de ${NICK_MAX} caracteres`)
  .regex(NICK_PATTERN, 'El apodo solo puede llevar letras, números, guion bajo y espacios');

/** Apodo al azar para quien no eligio uno: "Gato4821". */
export function randomNickname(rand: () => number = Math.random): string {
  return `Gato${String(Math.floor(rand() * 10_000)).padStart(4, '0')}`;
}

/** Deja un texto cualquiera (por ejemplo el nombre de Google) como un apodo valido, o `null`. */
export function sanitizeNickname(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .normalize('NFC')
    .replace(OUTSIDE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NICK_MAX)
    .trim();
  return cleaned.length >= NICK_MIN && NICK_PATTERN.test(cleaned) ? cleaned : null;
}
