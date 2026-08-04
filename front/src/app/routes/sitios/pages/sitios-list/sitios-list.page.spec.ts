import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SitiosListPage } from './sitios-list.page';

describe('SitiosListPage', () => {
  let component: SitiosListPage;
  let fixture: ComponentFixture<SitiosListPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [SitiosListPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SitiosListPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
