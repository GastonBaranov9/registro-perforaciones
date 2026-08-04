import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SitiosCreatePage } from './sitios-create.page';

describe('SitiosCreatePage', () => {
  let component: SitiosCreatePage;
  let fixture: ComponentFixture<SitiosCreatePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
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
