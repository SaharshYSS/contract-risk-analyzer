// Login session helpers (no SQL in this file). The session is a signed
// JWT stored in an httpOnly cookie; the secret comes from AUTH_SECRET in .env.
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export type Role = 'admin' | 'lawyer' | 'reviewer';
export type User = { userId: string; name: string; email: string; role: Role };

const SESSION_COOKIE = 'cra_session';
const MAX_AGE_SECONDS = 60 * 60 * 8; // 8 hours

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('AUTH_SECRET must be set in .env (at least 32 characters)');
  return new TextEncoder().encode(secret);
}

/** Call from a server action after the password has been checked. */
export async function startSession(user: User) {
  const token = await new SignJWT({ ...user })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The logged-in user, or null. */
export async function getUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return { userId: String(payload.userId), name: String(payload.name), email: String(payload.email), role: payload.role as Role };
  } catch {
    return null;
  }
}

/** Sends the visitor to /login if not logged in; otherwise returns the user. */
export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) redirect('/login');
  return user;
}
