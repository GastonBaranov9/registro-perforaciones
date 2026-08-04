import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SitioDetailPage } from './sitio-detail.page';

describe('SitioDetailPage', () => {
  let component: SitioDetailPage;
  let fixture: ComponentFixture<SitioDetailPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
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
