import {RenderMode, ServerRoute} from '@angular/ssr';

// Uygulama şifre arkasındaki bir panel; sunucuda önceden render etmenin faydası yok.
export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    renderMode: RenderMode.Client,
  },
];
