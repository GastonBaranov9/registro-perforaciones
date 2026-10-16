import { huellaIntervaloLitologico } from './estado-intervalo-litologico';
import { IntervaloLitologicoBody } from '../types/schemas';

describe('Huella editable de intervalo litológico',()=>{
  const original:IntervaloLitologicoBody={desde_m:0,hasta_m:2,material:'Tosca',id_litologia:null,litologia_provisional:'Tosca'};
  it('revertir provisional limpia dirty aunque el control cambie null por undefined',()=>{
    const base=huellaIntervaloLitologico(original);
    const editado={...original,id_litologia:undefined,litologia_provisional:'Tosca roja',material:'Tosca roja'};
    expect(huellaIntervaloLitologico(editado)).not.toBe(base);
    editado.litologia_provisional='Tosca';editado.material='Tosca';
    expect(huellaIntervaloLitologico(editado)).toBe(base);
    expect(huellaIntervaloLitologico({...editado,litologia_provisional:' Tosca '})).toBe(base);
  });
  it('no oculta cambio de catálogo, provisional, profundidad ni material legado',()=>{
    expect(huellaIntervaloLitologico({...original,id_litologia:1,litologia_provisional:null})).not.toBe(huellaIntervaloLitologico(original));
    expect(huellaIntervaloLitologico({...original,hasta_m:3})).not.toBe(huellaIntervaloLitologico(original));
    expect(huellaIntervaloLitologico({...original,litologia_provisional:null,material:'Otro'})).not.toBe(huellaIntervaloLitologico({...original,litologia_provisional:null}));
  });
  it('campos opcionales ausentes y metadatos no marcan carga inicial como editada',()=>{
    const legado={desde_m:0,hasta_m:2,material:'Legado'};
    expect(huellaIntervaloLitologico(legado)).toBe(huellaIntervaloLitologico({...legado,id_litologia:null,litologia_provisional:null}));
    expect(huellaIntervaloLitologico({...original,id_intervalo_litologico:9})).toBe(huellaIntervaloLitologico(original));
  });
});
