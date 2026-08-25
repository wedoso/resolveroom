const encoder = new TextEncoder();

export function opaqueId(
  prefix:
    'usr' | 'agt' | 'tok' | 'prg' | 'con' | 'pty' | 'evt' | 'ver' | 'shr' | 'inv' | 'ntf' | 'brf',
): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

const pairingAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function securePairingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const characters = Array.from(bytes, (byte) => pairingAlphabet[byte & 31]);
  return [characters.slice(0, 4), characters.slice(4, 8), characters.slice(8, 12)]
    .map((part) => part.join(''))
    .join('-');
}

export function normalizePairingCode(value: string): string {
  const compact = value.toUpperCase().replace(/[^A-Z2-9]/g, '');
  if (
    compact.length !== 12 ||
    [...compact].some((character) => !pairingAlphabet.includes(character))
  )
    return '';
  return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 12)}`;
}

export function secureToken(prefix: 'rr_agent_' | 'rr_inv_' | 'rr_share_' | 'rr_session_'): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return prefix + Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1)
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

export function redactSensitive(value: string): string {
  return value
    .replace(/rr_(agent|inv|share)_[a-f0-9]+/gi, 'rr_$1_[REDACTED]')
    .replace(/\b[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}\b/g, '[PAIRING_CODE_REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
}
