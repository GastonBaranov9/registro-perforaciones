import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PozosCreatePage } from './pozos-create.page';

describe('PozosCreatePage', () => {
  let component: PozosCreatePage;
  let fixture: ComponentFixture<PozosCreatePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PozosCreatePage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PozosCreatePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
