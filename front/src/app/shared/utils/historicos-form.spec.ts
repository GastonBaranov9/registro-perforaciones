import { cuerpoHistorico, tecnicosVacios } from './historicos-form';
import { CampoTecnicoEstandar, DATOS_TECNICOS_ESTANDAR } from '../constants/datos-tecnicos-estandar';
import { NuevoPozo } from '../types/schemas';

describe('Payload histórico completo',()=>{
  for (const valor of [undefined, null, '', '   ']) {
    it(`conserva desconocidos (${JSON.stringify(valor)}) como omisión al crear y NULL al editar`, () => {
      const pozo: NuevoPozo = { id_propietario: null, id_perforador: 0, id_sitio: 0 };
      for (const campo of Object.keys(DATOS_TECNICOS_ESTANDAR) as CampoTecnicoEstandar[]) Object.assign(pozo, { [campo]: valor });
      const sitio = { departamento: '', localidad: '', latitud: '', longitud: '' };
      const nuevo = cuerpoHistorico(pozo, sitio, tecnicosVacios(), false);
      const edicion = cuerpoHistorico(pozo, sitio, tecnicosVacios(), true);
      for (const campo of Object.keys(DATOS_TECNICOS_ESTANDAR)) {
        expect(campo in nuevo).toBeFalse();
        expect(edicion[campo]).toBeNull();
      }
    });
  }
  it('omite desconocidos al crear y no introduce defaults ni identidades editables',()=>{
    const body=cuerpoHistorico({id_propietario:null,id_perforador:0,id_sitio:0,numero_perforacion:3281},{departamento:'',localidad:'',latitud:'',longitud:''},tecnicosVacios(),false);
    expect(body).toEqual({});
  });
  it('incluye todas las secciones técnicas y cero conocido, manteniendo número fuera de edición',()=>{
    const technical=tecnicosVacios();
    technical.intervalosLitologicos=[{idLocal:'l',dato:{desde_m:0,hasta_m:20,material:'Basalto',id_litologia:1}}];
    technical.intervalosDiametro=[{idLocal:'d',dato:{desde_m:0,hasta_m:20,diametro_pulg:6,material_tuberia:'PVC'}}];
    technical.intervalosFiltro=[{idLocal:'f',dato:{desde_m:10,hasta_m:20,diametro_pulg:4,material_tuberia:'PVC',ranura_mm:0.75}}];
    technical.nivelesAporte=[{idLocal:'a',dato:{profundidad_m:15}}];
    const body=cuerpoHistorico({numero_perforacion:3281,id_sitio:18,id_propietario:2,id_perforador:3,empresa:'Empresa',fecha_inicio:'1998-01-01',fecha_fin:'1998-01-02',profundidad_final_m:20,nivel_estatico_m:0,nivel_dinamico_m:4,caudal_estimado_lh:0,metodo_sedimentario:'Rotación',metodo_rocoso:'Percusión',cementacion:'Conocida',desarrollo:'Aire',revestimiento:'PVC'}, {departamento:'Salto',localidad:'Campo',padron:'12',latitud:'-31',longitud:'-57'},technical,true);
    expect(body['numero_perforacion']).toBeUndefined();expect(body['id_sitio']).toBeUndefined();expect(body['origen']).toBeUndefined();
    expect(body['nivel_estatico_m']).toBe(0);expect(body['caudal_estimado_lh']).toBe(0);
    for(const key of ['intervalos_litologicos','intervalos_diametro','intervalos_filtro','niveles_aporte'])expect((body[key] as unknown[]).length).toBe(1);
    expect(body['sitio']).toEqual({departamento:'Salto',localidad:'Campo',padron:'12',latitud:'-31',longitud:'-57'});
    expect(body['empresa']).toBe('Empresa');expect(body['propietario_provisional']).toBeNull();
  });
});
