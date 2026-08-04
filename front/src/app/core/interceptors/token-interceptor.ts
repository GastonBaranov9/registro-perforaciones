import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export const tokenInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiURL)) return next(req);

  let headers = req.headers;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) {
    const csrfToken = document.cookie
      .split('; ')
      .find((cookie) => cookie.startsWith('rsp_csrf='))
      ?.slice('rsp_csrf='.length);

    if (csrfToken) headers = headers.set('X-CSRF-Token', decodeURIComponent(csrfToken));
  }

  const modifiedReq = req.clone({
    headers,
    withCredentials: true,
  });
  return next(modifiedReq);
};
