import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { MainStore } from '../../shared/services/mainstore-service/main.store';

export const tokenInterceptor: HttpInterceptorFn = (req, next) => {
  const mainStore = inject(MainStore);
  
  if (!mainStore.token()) return next(req);

  const modifiedReq = req.clone({
    headers: req.headers.set('Authorization', `Bearer ${mainStore.token()}`),
  });
  return next(modifiedReq);
};
