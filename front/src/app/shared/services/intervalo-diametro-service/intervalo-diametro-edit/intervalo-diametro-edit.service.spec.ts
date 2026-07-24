import { TestBed } from '@angular/core/testing';

import { IntervaloDiametroEditService } from './intervalo-diametro-edit.service';

describe('IntervaloDiametroEditService', () => {
  let service: IntervaloDiametroEditService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(IntervaloDiametroEditService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
