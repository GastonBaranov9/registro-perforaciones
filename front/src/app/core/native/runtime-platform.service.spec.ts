import { TestBed } from '@angular/core/testing';
import { CAPACITOR_RUNTIME, type CapacitorRuntimeApi } from './native-plugin.tokens';
import { RuntimePlatformService } from './runtime-platform.service';

describe('RuntimePlatformService', () => {
  function detect(platform: string, native: boolean) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CAPACITOR_RUNTIME,
          useValue: { getPlatform: () => platform, isNativePlatform: () => native } satisfies CapacitorRuntimeApi,
        },
      ],
    });
    return TestBed.inject(RuntimePlatformService);
  }

  it('distingue web, Android e iOS sin User-Agent', () => {
    expect(detect('web', false).platform()).toBe('web');
    expect(detect('android', true).platform()).toBe('android');
    expect(detect('ios', true).platform()).toBe('ios');
  });

  it('falla cerrado para plataforma desconocida o falsa plataforma native', () => {
    expect(detect('windows', false).platform()).toBe('unknown');
    expect(detect('android', false).platform()).toBe('unknown');
  });
});
