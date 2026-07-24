import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SitiosEditPage } from './sitios-edit.page';

describe('SitiosEditPage', () => {
  let component: SitiosEditPage;
  let fixture: ComponentFixture<SitiosEditPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SitiosEditPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SitiosEditPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
