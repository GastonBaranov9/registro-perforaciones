import { inject, Injectable } from '@angular/core';
import { CAPACITOR_RUNTIME } from './native-plugin.tokens';

export type RuntimePlatform = 'web' | 'android' | 'ios' | 'unknown';
export type NativePlatform = Extract<RuntimePlatform, 'android' | 'ios'>;

@Injectable({ providedIn: 'root' })
export class RuntimePlatformService {
  private readonly capacitor = inject(CAPACITOR_RUNTIME);
  private readonly detected = this.detect();

  platform(): RuntimePlatform {
    return this.detected;
  }

  isNative(): boolean {
    return this.detected === 'android' || this.detected === 'ios';
  }

  nativePlatform(): NativePlatform {
    if (!this.isNative()) throw new Error('Operación disponible sólo en la aplicación mobile.');
    return this.detected as NativePlatform;
  }

  private detect(): RuntimePlatform {
    const platform = this.capacitor.getPlatform();
    if (platform === 'android' || platform === 'ios') {
      return this.capacitor.isNativePlatform() ? platform : 'unknown';
    }
    if (platform === 'web') return 'web';
    return 'unknown';
  }
}
