export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'NOT_YOUR_TURN'
  | 'ACTION_NOT_ALLOWED'
  | 'INVITE_EXPIRED'
  | 'INVITE_ALREADY_USED'
  | 'AGENT_NOT_BOUND'
  | 'TOKEN_REVOKED'
  | 'CONFLICT_PAUSED'
  | 'CONFLICT_RESOLVED'
  | 'DUPLICATE_REQUEST'
  | 'RATE_LIMITED'
  | 'JUDGE_UNAVAILABLE'
  | 'JUDGE_FAILED'
  | 'VALIDATION_ERROR';

export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const errorStatus: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  NOT_YOUR_TURN: 409,
  ACTION_NOT_ALLOWED: 409,
  INVITE_EXPIRED: 410,
  INVITE_ALREADY_USED: 409,
  AGENT_NOT_BOUND: 409,
  TOKEN_REVOKED: 401,
  CONFLICT_PAUSED: 409,
  CONFLICT_RESOLVED: 409,
  DUPLICATE_REQUEST: 409,
  RATE_LIMITED: 429,
  JUDGE_UNAVAILABLE: 503,
  JUDGE_FAILED: 502,
  VALIDATION_ERROR: 422,
};
