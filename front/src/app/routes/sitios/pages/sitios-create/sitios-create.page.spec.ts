import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SitiosCreatePage } from './sitios-create.page';

describe('SitiosCreatePage', () => {
  let component: SitiosCreatePage;
  let fixture: ComponentFixture<SitiosCreatePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SitiosCreatePage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SitiosCreatePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
