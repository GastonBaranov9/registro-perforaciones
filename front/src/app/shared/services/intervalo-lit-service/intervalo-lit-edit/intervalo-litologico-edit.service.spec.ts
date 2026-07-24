import { TestBed } from '@angular/core/testing';

import { IntervaloLitologicoEditService } from '../intervalo-lit-edit/intervalo-litologico-edit.service';

describe('IntervaloLitologicoEditService', () => {
  let service: IntervaloLitologicoEditService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(IntervaloLitologicoEditService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
