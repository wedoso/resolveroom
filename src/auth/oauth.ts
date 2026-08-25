import { DomainError } from '@/domain/errors';

export type OAuthProviderName = 'google' | 'github';
export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}
export interface OAuthProfile {
  subject: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

const definitions = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    profile: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
  },
  github: {
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    profile: 'https://api.github.com/user',
    scope: 'read:user user:email',
  },
} as const;

export function authorizationUrl(
  provider: OAuthProviderName,
  credentials: OAuthCredentials,
  redirectUri: string,
  state: string,
) {
  const d = definitions[provider];
  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: d.scope,
    state,
  });
  return `${d.authorize}?${params}`;
}

export async function exchangeOAuth(
  provider: OAuthProviderName,
  credentials: OAuthCredentials,
  redirectUri: string,
  code: string,
): Promise<OAuthProfile> {
  const d = definitions[provider];
  const tokenResponse = await fetch(d.token, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenResponse.ok) throw new DomainError('UNAUTHORIZED', 'OAuth code exchange failed.', 401);
  const token: any = await tokenResponse.json();
  if (!token.access_token)
    throw new DomainError('UNAUTHORIZED', 'OAuth provider returned no access token.', 401);
  const profileResponse = await fetch(d.profile, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: 'application/json',
      'User-Agent': 'ResolveRoom',
    },
  });
  if (!profileResponse.ok)
    throw new DomainError('UNAUTHORIZED', 'OAuth profile lookup failed.', 401);
  const profile: any = await profileResponse.json();
  if (provider === 'google') {
    if (!profile.email || !profile.sub || profile.email_verified !== true)
      throw new DomainError('UNAUTHORIZED', 'Google profile must include a verified email.', 401);
    return {
      subject: String(profile.sub),
      email: String(profile.email).toLowerCase(),
      displayName: String(profile.name ?? profile.email),
      avatarUrl: profile.picture ?? null,
    };
  }
  let email = profile.email as string | undefined;
  if (!email) {
    const emails = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ResolveRoom',
      },
    });
    if (emails.ok) {
      const values: any[] = await emails.json();
      email =
        values.find((item) => item.primary && item.verified)?.email ??
        values.find((item) => item.verified)?.email;
    }
  }
  if (!email || !profile.id)
    throw new DomainError('UNAUTHORIZED', 'GitHub account must provide a verified email.', 401);
  return {
    subject: String(profile.id),
    email: email.toLowerCase(),
    displayName: String(profile.name ?? profile.login ?? email),
    avatarUrl: profile.avatar_url ?? null,
  };
}
