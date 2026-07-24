import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SitioDetailPage } from './sitio-detail.page';

describe('SitioDetailPage', () => {
  let component: SitioDetailPage;
  let fixture: ComponentFixture<SitioDetailPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SitioDetailPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SitioDetailPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
