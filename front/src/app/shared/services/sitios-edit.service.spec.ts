import { TestBed } from '@angular/core/testing';

import { SitiosEditService } from './sitios-edit.service';

describe('SitiosEditService', () => {
  let service: SitiosEditService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SitiosEditService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
