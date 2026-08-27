import { TestBed } from '@angular/core/testing';
import { CAPACITOR_APP, CAPACITOR_RUNTIME } from './native-plugin.tokens';
import { NativeMetadataService, normalizeNativeBuild } from './native-metadata.service';

describe('NativeMetadataService', () => {
  it('normaliza build entero y usa plataforma/version del binario actual', async () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: CAPACITOR_RUNTIME, useValue: { getPlatform: () => 'ios', isNativePlatform: () => true } },
        {
          provide: CAPACITOR_APP,
          useValue: {
            getInfo: async () => ({ name: 'front', id: 'example', build: '120', version: '1.4.2' }),
            addListener: jasmine.createSpy(),
          },
        },
      ],
    });

    await expectAsync(TestBed.inject(NativeMetadataService).current()).toBeResolvedTo({
      platform: 'ios',
      appBuild: 120,
      appVersion: '1.4.2',
    });
  });

  it('rechaza builds ausentes, cero, decimales y fuera de rango', () => {
    for (const build of ['', '0', '01', '-1', '1.2', '2147483648']) {
      expect(() => normalizeNativeBuild(build)).toThrow();
    }
  });

  it('no obtiene metadata native desde web', async () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: CAPACITOR_RUNTIME, useValue: { getPlatform: () => 'web', isNativePlatform: () => false } },
      ],
    });
    await expectAsync(TestBed.inject(NativeMetadataService).current()).toBeRejected();
  });
});
