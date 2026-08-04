import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UsuariosEditPage } from './usuarios-edit.page';

describe('UsuariosEditPage', () => {
  let component: UsuariosEditPage;
  let fixture: ComponentFixture<UsuariosEditPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [UsuariosEditPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(UsuariosEditPage);
    fixture.componentRef.setInput('id_usuario', 1);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
