import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IntervalosLitologicosEditPage } from './intervalos-litologicos-edit.page';

describe('IntervalosLitologicosEditPage', () => {
  let component: IntervalosLitologicosEditPage;
  let fixture: ComponentFixture<IntervalosLitologicosEditPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [IntervalosLitologicosEditPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(IntervalosLitologicosEditPage);
    fixture.componentRef.setInput('id_pozo', 1);
    fixture.componentRef.setInput('id_intervalo_litologico', 1);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
