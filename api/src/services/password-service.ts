import bcrypt from "bcryptjs";
import { PASSWORD_MIN_LENGTH, BCRYPT_MAX_BYTES } from '../constants/password.ts';
import { T05DatosIncorrectos } from '../models/errors.ts';

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new T05DatosIncorrectos(`La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`);
  }

  if (!/\S/.test(password)) {
    throw new T05DatosIncorrectos("La contraseña debe contener al menos un carácter no blanco");
  }
  if (Buffer.byteLength(password, 'utf8') > BCRYPT_MAX_BYTES)
    throw new T05DatosIncorrectos('La contraseña debe ocupar hasta 72 bytes UTF-8.');

  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}
