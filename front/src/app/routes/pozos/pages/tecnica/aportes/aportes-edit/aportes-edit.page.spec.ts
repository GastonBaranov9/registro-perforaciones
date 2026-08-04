import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AportesEditPage } from './aportes-edit.page';

describe('AportesEditPage', () => {
  let component: AportesEditPage;
  let fixture: ComponentFixture<AportesEditPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [AportesEditPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AportesEditPage);
    fixture.componentRef.setInput('id_pozo', 1);
    fixture.componentRef.setInput('id_nivel_aporte', 1);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
