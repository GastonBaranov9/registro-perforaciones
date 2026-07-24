import { Routes } from '@angular/router';
import { HomePage } from './routes/home/home.page';
import { isAdminGuard, isloggedGuard, isPerfOrAdminGuard } from './core/guards/islogged-guard-guard';

export const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: 'home', component: HomePage, title: 'Home' },

  {
    path: 'login',
    loadComponent: async () => (await import('../app/routes/login/login.page')).LoginPage,
    title: 'Login',
  },

  {
    path: 'pozo',
    loadComponent: async () => (await import('../app/routes/pozos/pozo/pozo.page')).PozoPage,
    title: 'pozo-menu',
  },
  {
    path: 'sitio',
    loadComponent: async () => (await import('../app/routes/sitios/sitio/sitio.page')).SitioPage,
    title: 'sitio',
  },

  {
    path: 'usuario',
    loadComponent: async () =>
      (await import('../app/routes/usuarios/usuario/usuario.page')).UsuarioPage,
    title: 'usuario',
  },
  {
    path: 'pozos/:id_pozo/aportes-create',

    canActivate: [isloggedGuard, isPerfOrAdminGuard],
    loadComponent: async () =>
      (await import('./routes/pozos/pages/tecnica/aportes/aportes-create/aportes-create.page'))
        .AportesCreatePage,
    title: 'portes-create',
  },

  {
    path: 'pozos/:id_pozo/aportes-edit/:id_nivel_aporte',
    canActivate: [isloggedGuard, isPerfOrAdminGuard],
    loadComponent: async () =>
      (await import('./routes/pozos/pages/tecnica/aportes/aportes-edit/aportes-edit.page'))
        .AportesEditPage,
    title: 'portes-edit',
  },

  {
    path: 'pozos/:id_pozo/aportes-list',
    canActivate: [isloggedGuard],
    loadComponent: async () =>
      (await import('./routes/pozos/pages/tecnica/aportes/aportes-list/aportes-list.page'))
        .AportesListPage,
    title: 'aportes-list',
  },

  {
    path: 'pozos/:id_pozo/intervalos-diametros-create',
    canActivate: [isloggedGuard, isPerfOrAdminGuard],
    loadComponent: async () =>
      (
        await import(
          '../app/routes/pozos/pages/tecnica/intervalos-diamentros/intervalos-diametros-create/intervalos-diametros-create.page'
        )
      ).IntervalosDiametrosCreatePage,
    title: 'intervalos-diametros-create',
  },

  {
    path: 'pozos/:id_pozo/intervalos-diametros-edit/:id_intervalo_diametro',
    canActivate: [isloggedGuard, isPerfOrAdminGuard],
    loadComponent: async () =>
      (
        await import(
          '../app/routes/pozos/pages/tecnica/intervalos-diamentros/intervalos-diametros-edit/intervalos-diametros-edit.page'
        )
      ).IntervalosDiametrosEditPage,
    title: 'intervalos-diametros-edit',
  },

  {
    path: 'pozos/:id_pozo/intervalos-diametros-list',
    canActivate: [isloggedGuard],
    loadComponent: async () =>
      (
        await import(
          './routes/pozos/pages/tecnica/intervalos-diamentros/intervalos-diametros-list/intervalos-diametros-list.page'
        )
      ).IntervalosDiametrosListPage,
    title: 'intervalos-diametros-list',
  },

  {
    path: 'pozos/:id_pozo/intervalos-litologicos-create',
    canActivate: [isloggedGuard, isPerfOrAdminGuard],
    loadComponent: async () =>
      (
        await import(
          '../app/routes/pozos/pages/tecnica/intervalos-litologicos/intervalos-litologicos-create/intervalos-litologicos-create.page'
        )
      ).IntervalosLitologicosCreatePage,
    title: 'intervalos-litologicos-create',
  },

  {
    path: 'pozos/:id_pozo/intervalos-litologicos-edit/:id_intervalo_litologico',
    canActivate: [isloggedGuard, isPerfOrAdminGuard],
    loadComponent: async () =>
      (
        await import(
          '../app/routes/pozos/pages/tecnica/intervalos-litologicos/intervalos-litologicos-edit/intervalos-litologicos-edit.page'
        )
      ).IntervalosLitologicosEditPage,
    title: 'intervalos-litologicos-edit',
  },

  {
    path: 'pozos/:id_pozo/intervalos-litologicos-list',
    canActivate: [isloggedGuard],
    loadComponent: async () =>
      (
        await import(
          '../app/routes/pozos/pages/tecnica/intervalos-litologicos/intervalos-litologicos-list/intervalos-litologicos-list.page'
        )
      ).IntervalosLitologicosListPage,
    title: 'intervalos-litologicos-list',
  },

  {
    path: 'not-found',
    loadComponent: async () =>
      (await import('../app/routes/not-found/not-found.page')).NotFoundPage,
    title: 'Not-Found',
  },
  {
    path: 'pozo-edit/:id_pozo',
    canActivate: [isloggedGuard, isPerfOrAdminGuard],
    loadComponent: async () =>
      (await import('../app/routes/pozos/pages/pozo-edit/pozo-edit.page')).PozoEditPage,
    title: 'pozo-edit',
  },

  {
    path: 'pozos-create',
    canActivate: [isloggedGuard, isPerfOrAdminGuard],
    loadComponent: async () =>
      (await import('../app/routes/pozos/pages/pozos-create/pozos-create.page')).PozosCreatePage,
    title: 'Crear pozo',
  },

  {
    path: 'pozos-detail/:id_pozo',
    canActivate: [isloggedGuard],
    loadComponent: async () =>
      (await import('../app/routes/pozos/pages/pozos-detail/pozos-detail.page')).PozosDetailPage,
    title: 'pozos-detail',
  },

  {
    path: 'pozos-list',
    canActivate: [isloggedGuard],
    loadComponent: async () =>
      (await import('../app/routes/pozos/pages/pozos-list/pozos-list.page')).PozosListPage,
    title: 'pozos-list',
  },

  {
    path: 'sitio-detail',
    canActivate: [isloggedGuard],
    loadComponent: async () =>
      (await import('../app/routes/sitios/pages/sitio-detail/sitio-detail.page')).SitioDetailPage,
    title: 'sitio-detail',
  },

  {
    path: 'sitios-edit/:id_sitio',

    canActivate: [isloggedGuard, isPerfOrAdminGuard],
    loadComponent: async () =>
      (await import('../app/routes/sitios/pages/sitios-edit/sitios-edit.page')).SitiosEditPage,
    title: 'sitios-edit',
  },

  {
    path: 'sitios-create/:id_usuario',

    canActivate: [isloggedGuard, isPerfOrAdminGuard],
    loadComponent: async () =>
      (await import('../app/routes/sitios/pages/sitios-create/sitios-create.page'))
        .SitiosCreatePage,
    title: 'sitios-create',
  },

  {
    path: 'sitios-list',

    canActivate: [isloggedGuard],
    loadComponent: async () =>
      (await import('../app/routes/sitios/pages/sitios-list/sitios-list.page')).SitiosListPage,
    title: 'sitios-list',
  },

  {
    path: 'usuarios-edit/:id_usuario',
    canActivate: [isloggedGuard],
    loadComponent: async () =>
      (await import('./routes/usuarios/pages/usuarios-edit/usuarios-edit.page')).UsuariosEditPage,
    title: 'usuarios-edit',
  },
  {
    path: 'usuarios-create',
    canActivate: [isloggedGuard, isAdminGuard],
    loadComponent: async () =>
      (await import('./routes/usuarios/pages/usuarios-create/usuarios-create.page'))
        .UsuariosCreatePage,
    title: 'crear-persona',
  },

  {
    path: 'usuario-detail',
    canActivate: [isloggedGuard],
    loadComponent: async () =>
      (await import('../app/routes/usuarios/pages/usuario-detail/usuario-detail.page'))
        .UsuarioDetailPage,
    title: 'usuario-detai',
  },
  {
    path: 'usuarios-list',
    canActivate: [isloggedGuard, isAdminGuard],
    loadComponent: async () =>
      (await import('../app/routes/usuarios/pages/usuarios-list/usuarios-list.page'))
        .UsuariosListPage,
    title: 'usuarios-list',
  },
];
