import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UsuariosCreatePage } from './usuarios-create.page';

describe('UsuariosCreatePage', () => {
  let component: UsuariosCreatePage;
  let fixture: ComponentFixture<UsuariosCreatePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UsuariosCreatePage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(UsuariosCreatePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
