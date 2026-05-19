export const SESSION_COOKIE_NAME = 'sakura_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
export const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

export const PASSWORD_HASH_ALGORITHM = 'pbkdf2_sha256';
export const PASSWORD_HASH_ITERATIONS = 210_000;
export const PASSWORD_SALT_BYTES = 16;
export const PASSWORD_HASH_BYTES = 32;

export const SESSION_TOKEN_BYTES = 32;
