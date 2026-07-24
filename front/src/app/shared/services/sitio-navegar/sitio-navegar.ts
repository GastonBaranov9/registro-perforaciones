import { Injectable, signal } from '@angular/core';
import { Sitio } from '../../types/schemas';

@Injectable({ providedIn: 'root' })
export class SitioReturnService {
  sitioCreado = signal<Sitio | null>(null);
}
