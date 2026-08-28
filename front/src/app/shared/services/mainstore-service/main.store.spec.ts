import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { MainStore } from './main.store';

describe('MainStore', () => {
  let service: MainStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(MainStore);
  });

  afterEach(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('mainstore-unrelated');
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('elimina credenciales legacy sin leerlas ni migrarlas', () => {
    localStorage.setItem('token', 'legacy-token');
    localStorage.setItem('user', '{"id":7,"email":"legacy@example.test"}');
    const getItem = spyOn(localStorage, 'getItem').and.callThrough();

    service.init();

    expect(getItem).not.toHaveBeenCalled();
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(service.user()).toBeNull();
  });

  it('preserva claves no relacionadas durante el cleanup legacy', () => {
    localStorage.setItem('mainstore-unrelated', 'keep-me');
    localStorage.setItem('token', 'legacy-token');

    service.init();

    expect(localStorage.getItem('mainstore-unrelated')).toBe('keep-me');
    expect(localStorage.getItem('token')).toBeNull();
  });
});
