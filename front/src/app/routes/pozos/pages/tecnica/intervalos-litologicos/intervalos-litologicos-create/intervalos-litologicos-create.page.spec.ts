import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IntervalosLitologicosCreatePage } from './intervalos-litologicos-create.page';

describe('IntervalosLitologicosCreatePage', () => {
  let component: IntervalosLitologicosCreatePage;
  let fixture: ComponentFixture<IntervalosLitologicosCreatePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [IntervalosLitologicosCreatePage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(IntervalosLitologicosCreatePage);
    fixture.componentRef.setInput('id_pozo', 1);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
