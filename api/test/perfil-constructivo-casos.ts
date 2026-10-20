import { crearPerfilLitologico, type IntervaloConstructivo } from '../src/pdf/perfil-litologico.ts';

export function casosConstructivos() {
  const tubo = (desde_m:number,hasta_m:number,diametro_pulg=8):IntervaloConstructivo => ({desde_m,hasta_m,diametro_pulg,material_tuberia:'PVC'});
  const abierto = (desde_m:number,hasta_m:number,diametro_pulg=8):IntervaloConstructivo => ({desde_m,hasta_m,diametro_pulg,material_tuberia:null,sin_tuberia:true});
  const perfil = (profundidad:number, tubos:IntervaloConstructivo[], sello:{desde_m:number;hasta_m:number}|null=null) =>
    crearPerfilLitologico([{desde_m:0,hasta_m:profundidad,material:'Basalto',id_litologia:1,litologia_nombre:'Basalto',litologia_color:'#795548',litologia_patron:'basalt_fractured'}],
      profundidad,[],tubos,[],sello)!;
  return {
    A:perfil(20,[tubo(0,20)],{desde_m:0,hasta_m:10}),
    B:perfil(20,[tubo(0,20)],{desde_m:5,hasta_m:12}),
    C:perfil(50,[tubo(0,20),abierto(20,50)]),
    D:perfil(20,[{...tubo(0,20),material_tuberia:null}]),
    F:perfil(50,[tubo(0,5,10),tubo(5,20,6),abierto(20,40,8),tubo(40,50,6)],{desde_m:0,hasta_m:12}),
    superficieAbierta:perfil(20,[abierto(0,20)],{desde_m:5,hasta_m:12}),
    multipagina:perfil(240,[tubo(0,120),abierto(120,200),tubo(200,240)],{desde_m:0,hasta_m:130}),
  };
}
