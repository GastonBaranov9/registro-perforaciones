// Existing policy; bcrypt's byte limit is a storage constraint, not a strength rule.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_NON_BLANK = '\\S';
export const BCRYPT_MAX_BYTES = 72;
