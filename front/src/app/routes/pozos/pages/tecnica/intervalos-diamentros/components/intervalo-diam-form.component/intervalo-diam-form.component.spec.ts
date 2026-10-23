import { TestBed } from '@angular/core/testing';
import { IntervaloDiamFormComponent } from './intervalo-diam-form.component';
import { IntervaloDiametroPerforacionBody } from '../../../../../../../shared/types/schemas';

describe('Formulario individual de diámetro',()=>{
  it('crea y reabre un intervalo sin cañería y permite volver a PVC',async()=>{
    await TestBed.configureTestingModule({imports:[IntervaloDiamFormComponent]}).compileComponents();
    const fixture=TestBed.createComponent(IntervaloDiamFormComponent);
    const dato:IntervaloDiametroPerforacionBody={desde_m:20,hasta_m:50,diametro_pulg:8,material_tuberia:'PVC'};
    fixture.componentRef.setInput('intervaloDiametro',dato);fixture.detectChanges();await fixture.whenStable();
    const select=fixture.nativeElement.querySelector('ion-select');
    expect(select.textContent).toContain('Sin cañería');
    select.value='sin_tuberia';select.dispatchEvent(new CustomEvent('ionChange',{detail:{value:'sin_tuberia'}}));
    fixture.detectChanges();await fixture.whenStable();
    expect(dato.sin_tuberia).toBeTrue();expect(dato.material_tuberia).toBeNull();
    const emit=spyOn(fixture.componentInstance.saved,'emit');
    fixture.componentInstance.handleIntervaloDiam();
    expect(emit).toHaveBeenCalledWith({desde_m:20,hasta_m:50,diametro_pulg:8,material_tuberia:null,sin_tuberia:true});
    fixture.componentRef.setInput('intervaloDiametro',structuredClone(dato));
    fixture.detectChanges();await fixture.whenStable();
    expect(select.value).toBe('sin_tuberia');
    select.value='PVC';select.dispatchEvent(new CustomEvent('ionChange',{detail:{value:'PVC'}}));
    fixture.detectChanges();await fixture.whenStable();
    expect(fixture.componentInstance.intervaloDiametro().sin_tuberia).toBeFalse();
    expect(fixture.componentInstance.intervaloDiametro().material_tuberia).toBe('PVC');
  });
});
