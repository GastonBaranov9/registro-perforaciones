import { inject, Injectable } from '@angular/core';
import { CAPACITOR_APP } from './native-plugin.tokens';
import { RuntimePlatformService, type NativePlatform } from './runtime-platform.service';
import { NativeClientConfigurationError } from './native-backend-config.service';

export interface NativeAppMetadata {
  platform: NativePlatform;
  appBuild: number;
  appVersion: string;
}

export function normalizeNativeBuild(rawBuild: string): number {
  if (!/^[1-9]\d*$/.test(rawBuild)) throw new NativeClientConfigurationError();
  const build = Number(rawBuild);
  if (!Number.isSafeInteger(build) || build > 2_147_483_647) {
    throw new NativeClientConfigurationError();
  }
  return build;
}

@Injectable({ providedIn: 'root' })
export class NativeMetadataService {
  private readonly app = inject(CAPACITOR_APP);
  private readonly runtime = inject(RuntimePlatformService);
  private currentFlight?: Promise<NativeAppMetadata>;

  current(): Promise<NativeAppMetadata> {
    if (!this.runtime.isNative()) return Promise.reject(new NativeClientConfigurationError());
    this.currentFlight ??= this.load().catch((error) => {
      this.currentFlight = undefined;
      throw error;
    });
    return this.currentFlight;
  }

  private async load(): Promise<NativeAppMetadata> {
    let info;
    try {
      info = await this.app.getInfo();
    } catch {
      throw new NativeClientConfigurationError();
    }
    const appVersion = info.version.trim();
    if (!appVersion || appVersion.length > 80) throw new NativeClientConfigurationError();
    return {
      platform: this.runtime.nativePlatform(),
      appBuild: normalizeNativeBuild(info.build),
      appVersion,
    };
  }
}
