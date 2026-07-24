import { TestBed } from '@angular/core/testing';

import { IntervaloLitologicoListService } from '../intervalo-lit-list/intervalo-litologico-list.service';

describe('IntervaloLitologicoListService', () => {
  let service: IntervaloLitologicoListService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(IntervaloLitologicoListService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
