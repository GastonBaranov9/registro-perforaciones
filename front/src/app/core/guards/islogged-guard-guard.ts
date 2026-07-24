import { CanActivateFn, RedirectCommand, Route, Router } from '@angular/router';
import { MainStore } from '../../shared/services/mainstore-service/main.store';
import { inject } from '@angular/core';


export const isloggedGuard: CanActivateFn = (route, state) => {
  const mainStore = inject(MainStore);
  const router = inject(Router);
  if (!mainStore.user()) {
    return router.createUrlTree(['/login'],{
      queryParams: {redirectTo: state.url}
    });
  }
  return true;
};

export const isAdminGuard: CanActivateFn = (route, state) => {
  const mainStore = inject(MainStore);
  const router = inject(Router);
  const user = mainStore.user();
  
  const roles = user?.roles || [];
  
  if (!user) {
    return router.createUrlTree(['/login'],{
      queryParams: {redirectTo: state.url}
    });
  }

  for(const rol of roles){
    if(rol.nombre==="administracion") return true;
  }
  return router.createUrlTree(['/home'], {
    queryParams: { redirectTo: state.url }
  });
};

export const isPerfOrAdminGuard: CanActivateFn = (route, state) => {
  const mainStore = inject(MainStore);
  const router = inject(Router);
  const user = mainStore.user();
  
  const roles = user?.roles || [];
  
  if (!user) {
    return router.createUrlTree(['/login'],{
      queryParams: {redirectTo: state.url}
    });
  }

  for(const rol of roles){
    if(rol.nombre==="perforador" || rol.nombre==="administracion") return true;
  }
  return router.createUrlTree(['/home'], {
    queryParams: { redirectTo: state.url }
  });
};

export const isPropGuard: CanActivateFn = (route, state) => {
  const mainStore = inject(MainStore);
  const router = inject(Router);
  const user = mainStore.user();
  
  const roles = user?.roles || [];
  
  if (!user) {
    return router.createUrlTree(['/login'],{
      queryParams: {redirectTo: state.url}
    });
  }

  for(const rol of roles){
    if(rol.nombre==="perforador") return true;
  }
  return router.createUrlTree(['/home'], {
    queryParams: { redirectTo: state.url }
  });
};


