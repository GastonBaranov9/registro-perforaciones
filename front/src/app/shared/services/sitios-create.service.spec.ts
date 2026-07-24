import { TestBed } from '@angular/core/testing';

import { SitiosCreateService } from './sitios-create.service';

describe('SitiosCreateService', () => {
  let service: SitiosCreateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SitiosCreateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
