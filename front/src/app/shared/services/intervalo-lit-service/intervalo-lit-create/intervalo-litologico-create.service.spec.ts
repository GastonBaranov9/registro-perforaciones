import { TestBed } from '@angular/core/testing';

import { IntervaloLitologicoCreateService } from './intervalo-litologico-create.service';

describe('IntervaloLitologicoCreateService', () => {
  let service: IntervaloLitologicoCreateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(IntervaloLitologicoCreateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
