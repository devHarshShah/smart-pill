const TOKEN_KEY = 'medilink_auth_token';

export function getStoredToken() {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setStoredToken(token: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
}

type TokenPayload = {
  email?: string;
  name?: string;
};

export function getStoredUser() {
  const token = getStoredToken();
  if (!token) return null;

  try {
    const payload = JSON.parse(atob(token.split('.')[1])) as TokenPayload;
    const email = payload.email ?? '';
    const name = payload.name ?? email.split('@')[0] ?? 'User';
    return { name, email };
  } catch {
    return null;
  }
}
