import { TestBed } from '@angular/core/testing';
import { DatosTecnicosBorrador, NuevoPozo, SitioBody } from '../types/schemas';
import { advertenciasPrefiltro, prefiltroParaEnvio, validarDatosTecnicos } from './datos-tecnicos-borrador';
import { tecnicosPersistidos } from './tecnicos-persistidos';
import { reconciliarDatosTecnicos } from './reconciliar-perforacion';
import { huellaDatosTecnicos } from './estado-formulario-perforacion';
import { cuerpoHistorico } from './historicos-form';
import { DatosTecnicosBorradorComponent } from '../../routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component';

const vacio=():DatosTecnicosBorrador=>({intervalosLitologicos:[],intervalosDiametro:[],intervalosFiltro:[],nivelesAporte:[]});
const pf=[{desde_m:13.5,hasta_m:15.5},{desde_m:20,hasta_m:25}];
describe('Prefiltro constructivo',()=>{
  for(const value of [undefined,null,[],pf,[{desde_m:0,hasta_m:4},{desde_m:4,hasta_m:6}]])
    it('admite ausencia e intervalos consecutivos '+JSON.stringify(value),()=>expect(validarDatosTecnicos({...vacio(),prefiltro_constructivo:value},30)).toEqual([]));
  for(const value of [[{desde_m:-1,hasta_m:2}],[{desde_m:3,hasta_m:2}],[{desde_m:0,hasta_m:Infinity}],
    [{desde_m:NaN,hasta_m:4}],[{desde_m:0,hasta_m:31}],[{desde_m:0,hasta_m:4},{desde_m:3,hasta_m:5}],
    [{desde_m:0,hasta_m:4},{desde_m:0,hasta_m:4}]])
    it('rechaza rangos inválidos '+JSON.stringify(value),()=>expect(validarDatosTecnicos({...vacio(),prefiltro_constructivo:value},30).length).toBeGreaterThan(0));
  it('exige profundidad final para prefiltro, sin exigirlo para históricos vacíos',()=>{
    expect(validarDatosTecnicos({...vacio(),prefiltro_constructivo:pf}).length).toBeGreaterThan(0);
    expect(validarDatosTecnicos(vacio())).toEqual([]);
  });
  it('omite campo antiguo, conserva reintentos sin mutar ni reordenar el borrador',()=>{
    const old=vacio(),before=JSON.stringify(old);expect(prefiltroParaEnvio(old)).toBeUndefined();expect(JSON.stringify(old)).toBe(before);
    const current={...vacio(),prefiltro_constructivo:[...pf].reverse()},snapshot=JSON.stringify(current);
    expect(prefiltroParaEnvio(current)).toEqual([...pf].reverse());expect(JSON.stringify(current)).toBe(snapshot);
    expect(prefiltroParaEnvio(current,structuredClone(current))).toBeUndefined();
    expect(prefiltroParaEnvio({...vacio(),prefiltro_constructivo:null},current)).toEqual([]);
  });
  it('relectura y reconciliación conservan cambios posteriores al envío',()=>{
    const guardado=tecnicosPersistidos([],[],[],[],null,pf);expect(guardado.prefiltro_constructivo).toEqual(pf);
    const enviado=structuredClone(guardado),actual={...guardado,prefiltro_constructivo:[{desde_m:2,hasta_m:3}]};
    expect(reconciliarDatosTecnicos(enviado,actual,guardado).prefiltro_constructivo).toEqual(actual.prefiltro_constructivo);
    expect(huellaDatosTecnicos(actual)).not.toBe(huellaDatosTecnicos(guardado));
    expect(huellaDatosTecnicos(vacio())).toBe(huellaDatosTecnicos({...vacio(),prefiltro_constructivo:[]}));
  });
  it('históricos incluyen, omiten sin cambios y eliminan explícitamente',()=>{
    const p={profundidad_final_m:30} as NuevoPozo,s={} as SitioBody,d={...vacio(),prefiltro_constructivo:pf};
    expect(cuerpoHistorico(p,s,d,false)['prefiltro_constructivo']).toEqual(pf);
    expect(cuerpoHistorico(p,s,d,true,d)['prefiltro_constructivo']).toBeUndefined();
    expect(cuerpoHistorico(p,s,{...d,prefiltro_constructivo:[]},true,d)['prefiltro_constructivo']).toEqual([]);
  });
  it('advierte solapamiento y falta de filtro sin rechazar ni mover profundidades',()=>{
    const d={...vacio(),prefiltro_constructivo:pf,sello_sanitario_constructivo:{desde_m:0,hasta_m:15}};
    expect(advertenciasPrefiltro(d).length).toBe(2);expect(validarDatosTecnicos(d,30)).toEqual([]);expect(d.prefiltro_constructivo).toEqual(pf);
  });
  it('formulario agrega, edita, elimina y deshabilita durante guardado',async()=>{
    await TestBed.configureTestingModule({imports:[DatosTecnicosBorradorComponent]}).compileComponents();
    const f=TestBed.createComponent(DatosTecnicosBorradorComponent);f.componentRef.setInput('profundidad',30);f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Sin prefiltro registrado');
    f.componentInstance.agregarPrefiltro();f.detectChanges();
    const a=f.nativeElement.querySelector('[aria-label="Prefiltro 1 desde (m)"]') as HTMLInputElement;
    a.value='13.5';a.dispatchEvent(new Event('input'));f.detectChanges();
    expect(f.componentInstance.datos().prefiltro_constructivo![0].desde_m).toBe(13.5);
    f.componentInstance.agregarPrefiltro();f.detectChanges();expect(f.componentInstance.datos().prefiltro_constructivo!.length).toBe(2);
    f.componentInstance.quitarPrefiltro(0);f.componentInstance.quitarPrefiltro(0);f.detectChanges();expect(f.componentInstance.datos().prefiltro_constructivo).toEqual([]);
    f.componentRef.setInput('guardando',true);f.detectChanges();f.componentInstance.agregarPrefiltro();expect(f.componentInstance.datos().prefiltro_constructivo).toEqual([]);
  });
});
