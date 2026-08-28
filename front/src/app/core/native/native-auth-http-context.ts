import { HttpContext, HttpContextToken } from '@angular/common/http';

export const SKIP_GLOBAL_NATIVE_AUTH_HANDLER = new HttpContextToken<boolean>(() => false);

export function nativeAuthMutationContext(): HttpContext {
  return new HttpContext().set(SKIP_GLOBAL_NATIVE_AUTH_HANDLER, true);
}
