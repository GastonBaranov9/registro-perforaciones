import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFPage, type PDFFont } from "pdf-lib";
import * as fs from "fs/promises";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import type { ReportePozo } from "../services/generar-informe-consultas.ts";
import { crearPerfilLitologico, dibujarPerfilLitologico } from "./perfil-litologico.ts";
import { configuracionMapaDesdeEntorno, leerCoordenadas, obtenerMapaEstatico, type ConfiguracionMapa } from "./mapa-estatico.ts";
import { formatearFechaCalendario } from "../utils/fechas.ts";

const A4: [number, number] = [595.28, 841.89];
const AZUL = rgb(0.03, 0.24, 0.48);
const GRIS = rgb(0.34, 0.39, 0.44);
const PUBLIC_DIR = path.join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

export interface OpcionesPDF { directorioFotos?: string; mapa?: ConfiguracionMapa; fetchMapa?: typeof fetch }
export interface DiagnosticoTabla {
  titulo:string; alturaEncabezado:number; alturasFilas:number[]; alturaCompleta:number; posicionFinal:number;
  paginas:number[]; fuente?:number; paginaTitulo:number; tituloTop:number; tituloBottom:number;
  contenidoTop:number; bordeInferiorFinal:number; gapAntesTitulo?:number; gapDespuesTitulo:number;
  lineaBaseTitulo?:number; ascensoVisualTitulo?:number; descensoVisualTitulo?:number;
}
export interface DiagnosticoPDF {
  paginas: { tipo: string; bloques: string[] }[]; tablas: DiagnosticoTabla[]; fallbackMapaAlto?: number;
  mapa?: { x:number; y:number; ancho:number; alto:number; imagenX:number; imagenY:number; imagenAncho:number; imagenAlto:number; atribucionY:number; overlayOpaco:boolean };
}

class FlujoPDF {
  page!: PDFPage; y = 0; readonly diagnostico: DiagnosticoPDF = { paginas: [], tablas: [] };
  readonly margen = 48; readonly inferior = 52;
  readonly doc: PDFDocument; readonly font: PDFFont; readonly bold: PDFFont;
  constructor(doc: PDFDocument, font: PDFFont, bold: PDFFont) { this.doc=doc; this.font=font; this.bold=bold; }
  pagina(tipo = "tecnica") {
    this.page = this.doc.addPage(A4); this.y = A4[1] - 62;
    this.diagnostico.paginas.push({ tipo, bloques: [] });
    if (tipo === "tecnica") {
      this.page.drawText("Informe de Perforación", { x: this.margen, y: A4[1] - 36, size: 11, font: this.bold, color: AZUL });
      this.page.drawLine({ start:{x:this.margen,y:A4[1]-44}, end:{x:A4[0]-this.margen,y:A4[1]-44}, thickness:.7, color:rgb(.7,.74,.78) });
    }
  }
  marcar(nombre: string) { this.diagnostico.paginas.at(-1)?.bloques.push(nombre); }
  reservar(alto: number) { if (this.y - alto < this.inferior) this.pagina(); }
  titulo(texto: string, altoSiguiente = 24) {
    this.reservar(30 + altoSiguiente); this.marcar(`seccion:${texto}`);
    this.page.drawText(texto, { x:this.margen, y:this.y, size:18, font:this.bold, color:AZUL }); this.y -= 28;
  }
  campo(etiqueta: string, valor: unknown) {
    const texto = valor === null || valor === undefined || valor === "" ? "No especificado" : String(valor);
    const lineas = envolver(texto, this.font, 12, A4[0] - this.margen * 2 - 150);
    this.reservar(Math.max(24, lineas.length * 15 + 5)); this.marcar(`campo:${etiqueta}`);
    this.page.drawText(etiqueta, { x:this.margen, y:this.y, size:11.5, font:this.bold, color:GRIS });
    lineas.forEach((linea,i)=>this.page.drawText(linea,{x:this.margen+150,y:this.y-i*15,size:12,font:this.font}));
    this.y -= Math.max(24, lineas.length * 15 + 5);
  }
  tabla(titulo: string, columnas: { titulo:string; ancho:number; valor:(fila:Record<string, unknown>)=>string }[], filas: Record<string, unknown>[]) {
    if (!filas.length) { this.y-=10; this.titulo(titulo, 20); this.texto("Sin registros"); this.y-=8; return; }
    const linea=14, padding=6;
    const celdas=filas.map(fila=>columnas.map(c=>envolver(c.valor(fila),this.font,11,c.ancho-padding*2)));
    const altos=celdas.map(c=>Math.max(...c.map(l=>l.length))*linea+padding*2);
    const encabezados=columnas.map(c=>envolver(c.titulo,this.bold,11,c.ancho-padding*2));
    const altoEncabezado=Math.max(...encabezados.map(l=>l.length))*linea+padding*2;
    const paginas:number[]=[]; let alturaCompleta=0;
    const dibujarEncabezado=(conTitulo:boolean,altoPrimeraFila:number)=>{
      const altoTitulo=conTitulo?38:0;
      this.reservar(altoTitulo+altoEncabezado+altoPrimeraFila);
      if(conTitulo){this.y-=10;this.page.drawText(titulo,{x:this.margen,y:this.y,size:17,font:this.bold,color:AZUL});this.y-=28;alturaCompleta+=38;}
      this.marcar(`tabla:${titulo}`); paginas.push(this.diagnostico.paginas.length-1);
      const superior=this.y; let x=this.margen;
      encabezados.forEach((lineas,i)=>{lineas.forEach((texto,j)=>this.page.drawText(texto,{x:x+padding,y:superior-padding-11-j*linea,size:11,font:this.bold,color:GRIS}));x+=columnas[i].ancho;});
      this.y=superior-altoEncabezado;
      this.page.drawLine({start:{x:this.margen,y:this.y},end:{x:A4[0]-this.margen,y:this.y},thickness:.7,color:rgb(.55,.6,.65)});
      alturaCompleta+=altoEncabezado;
    };
    dibujarEncabezado(true,altos[0]);
    celdas.forEach((fila,indice)=>{
      const alto=altos[indice];
      if(this.y-alto<this.inferior){this.pagina();dibujarEncabezado(false,alto);}
      const superior=this.y; let x=this.margen;
      fila.forEach((lineas,i)=>{lineas.forEach((texto,j)=>this.page.drawText(texto,{x:x+padding,y:superior-padding-11-j*linea,size:11,font:this.font}));x+=columnas[i].ancho;});
      this.y=superior-alto;
      this.page.drawLine({start:{x:this.margen,y:this.y},end:{x:A4[0]-this.margen,y:this.y},thickness:.35,color:rgb(.82,.84,.86)});
      alturaCompleta+=alto;
    });
    this.y-=18;
    const inicio=this.y+18+alturaCompleta;
    const ascensoTitulo=this.bold.heightAtSize(17,{descender:false});
    const descensoTitulo=this.bold.heightAtSize(17)-ascensoTitulo;
    const tituloTop=inicio-10+ascensoTitulo;
    const tituloBottom=inicio-10-descensoTitulo;
    const contenidoTop=inicio-38;
    this.diagnostico.tablas.push({
      titulo,alturaEncabezado:altoEncabezado,alturasFilas:altos,alturaCompleta,posicionFinal:this.y,paginas:[...new Set(paginas)],
      paginaTitulo:paginas[0],tituloTop,tituloBottom,contenidoTop,bordeInferiorFinal:this.y+18,
      gapAntesTitulo:inicio-tituloTop,gapDespuesTitulo:tituloBottom-contenidoTop,
    });
  }
  texto(texto:string){const lineas=envolver(texto,this.font,30,A4[0]-this.margen*2);this.reservar(lineas.length*15+8);this.marcar("texto");lineas.forEach((l,i)=>this.page.drawText(l,{x:this.margen,y:this.y-i*15,size:12,font:this.font,color:GRIS}));this.y-=lineas.length*15+8;}
}

export async function crearPDF(reporte: ReportePozo, pozoId: number, opciones: OpcionesPDF = {}) {
  return (await crearPDFConDiagnostico(reporte, pozoId, opciones)).documento;
}

export async function crearPDFConDiagnostico(reporte: ReportePozo, pozoId: number, opciones: OpcionesPDF = {}) {
  const doc=await PDFDocument.create(); const font=await doc.embedFont(StandardFonts.Helvetica); const bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const flujo=new FlujoPDF(doc,font,bold); const imagen=await cargarFoto(doc,reporte,pozoId,opciones.directorioFotos??PUBLIC_DIR);
  dibujarPortada(flujo,reporte,pozoId,imagen);
  const coordenadas=leerCoordenadas(reporte.latitud??null,reporte.longitud??null);
  const mapa=coordenadas ? await obtenerMapaEstatico(coordenadas,opciones.mapa??configuracionMapaDesdeEntorno(),opciones.fetchMapa) : { estado:"no-disponible" as const, motivo:"Sin coordenadas" };
  await dibujarUbicacion(flujo,reporte,coordenadas,mapa);
  dibujarPaginaTecnica(flujo,reporte);
  const perfil=crearPerfilLitologico(reporte.litologia,reporte.profundidad_final_m,reporte.niveles_aporte,reporte.diametros,reporte.filtros??[]);
  if(perfil) dibujarPerfilLitologico(doc,perfil,font,bold);
  return { documento:doc, diagnostico:flujo.diagnostico };
}

type ColumnaTecnica = { titulo:string; ancho:number; valor:(fila:Record<string,unknown>)=>string };
type AjusteTecnico = { fuente:number; linea:number; padding:number };
const TITULO_TECNICO_TAMANO = 12;
const GAP_ANTES_TITULO_TECNICO = 20;
const GAP_DESPUES_TITULO_TECNICO = 7;
const GROSOR_BORDE_FILA = .3;

interface PosicionTituloTecnico {
  paginaTitulo:number; tituloTop:number; tituloBottom:number; contenidoTop:number;
  gapAntesTitulo?:number; gapDespuesTitulo:number;
  lineaBaseTitulo:number; ascensoVisualTitulo:number; descensoVisualTitulo:number;
}

function medirCajaVisualTexto(font:PDFFont,size:number) {
  const ascensoFuente=font.heightAtSize(size,{descender:false});
  const descensoFuente=font.heightAtSize(size)-ascensoFuente;
  // Helvetica-Bold declara Ascender 718, pero su FontBBox alcanza 962/-228.
  // El tamaño y el 25 % encierran también diacríticos y descendentes reales.
  return {
    ascenso:Math.max(ascensoFuente,size),
    descenso:Math.max(descensoFuente,size*.25),
  };
}

function dibujarPaginaTecnica(f:FlujoPDF,r:ReportePozo) {
  const numero=(v:unknown)=>formatearNumero(Number(v));
  const generales: Array<[string,string]>=[
    ["Nivel estático",unidad(r.nivel_estatico_m,"m")],["Nivel dinámico",unidad(r.nivel_dinamico_m,"m")],
    ["Caudal estimado",unidad(r.caudal_estimado_lh,"l/h")],["Sello sanitario",booleano(r.sello_sanitario)],
    ["Prefiltro",valorTexto(r.pre_filtro)],["Revestimiento",valorTexto(r.revestimiento)],
    ["Método sedimentario",valorTexto(r.metodo_sedimentario)],["Método rocoso",valorTexto(r.metodo_rocoso)],
    ["Cementación",valorTexto(r.cementacion)],["Desarrollo",valorTexto(r.desarrollo)],
  ];
  const tablas: Array<{titulo:string;columnas:ColumnaTecnica[];filas:Record<string,unknown>[]}> = [
    { titulo:"Intervalos litológicos", filas:r.litologia, columnas:[
      {titulo:"Desde",ancho:90,valor:x=>`${numero(x.desde_m)} m`},{titulo:"Hasta",ancho:90,valor:x=>`${numero(x.hasta_m)} m`},{titulo:"Material",ancho:319,valor:x=>String(x.material)},
    ]},
    { titulo:"Tuberías y diámetros", filas:r.diametros, columnas:[
      {titulo:"Desde",ancho:85,valor:x=>`${numero(x.desde_m)} m`},{titulo:"Hasta",ancho:85,valor:x=>`${numero(x.hasta_m)} m`},{titulo:"Diámetro",ancho:115,valor:x=>`${numero(x.diametro_pulg)} pulg`},{titulo:"Material",ancho:214,valor:x=>String(x.material_tuberia??"No especificado")},
    ]},
    { titulo:"Intervalos de filtro", filas:r.filtros??[], columnas:[
      {titulo:"Desde",ancho:85,valor:x=>`${numero(x.desde_m)} m`},{titulo:"Hasta",ancho:85,valor:x=>`${numero(x.hasta_m)} m`},{titulo:"Diámetro",ancho:115,valor:x=>`${numero(x.diametro_pulg)} pulg`},{titulo:"Material",ancho:214,valor:x=>String(x.material_tuberia)},
    ]},
    { titulo:"Niveles de aporte", filas:r.niveles_aporte, columnas:[{titulo:"Profundidad",ancho:499,valor:x=>`${numero(x.profundidad_m)} m`}] },
  ];
  const ajustes: AjusteTecnico[] = [
    {fuente:10.2,linea:12.5,padding:4},
    {fuente:9.7,linea:11.8,padding:3},
    {fuente:9,linea:11,padding:2.5},
  ];
  const altoGeneral=medirDatosGenerales(f,generales);
  const disponible=A4[1]-62-f.inferior-altoGeneral;
  const ajuste=ajustes.find(a=>tablas.reduce((s,t)=>s+medirTabla(t,a,f),0)<=disponible)??ajustes.at(-1)!;
  f.pagina("tecnica"); f.marcar("datos-generales");
  f.page.drawText("Datos generales",{x:f.margen,y:f.y,size:16,font:f.bold,color:AZUL}); f.y-=25;
  for(let indice=0;indice<generales.length;indice+=2){
    const par=generales.slice(indice,indice+2);
    const preparados=par.map(([etiqueta,valor])=>prepararCampoGeneral(f,etiqueta,valor));
    dibujarParCamposGenerales(f, preparados);
  }
  f.y-=7;
  for(const tabla of tablas) dibujarTablaTecnica(f,tabla,ajuste);
}

function prepararCampoGeneral(f:FlujoPDF,etiqueta:string,valor:string){
  const anchoEtiqueta=Math.min(150,Math.max(78,f.bold.widthOfTextAtSize(`${etiqueta}: `,9.7)+4));
  return {etiqueta,anchoEtiqueta,lineas:envolver(valor,f.font,9.7,238-anchoEtiqueta)};
}

function dibujarParCamposGenerales(f:FlujoPDF, campos:ReturnType<typeof prepararCampoGeneral>[]) {
  const maximoLineas = Math.max(...campos.map((campo) => campo.lineas.length));
  let desplazamiento = 0;
  while (desplazamiento < maximoLineas) {
    if (f.y - f.inferior < 18) {
      f.pagina("tecnica-continuacion");
      f.marcar("datos-generales-continuacion");
    }
    const lineasDisponibles = Math.max(1, Math.floor((f.y - f.inferior) / 11));
    const cantidad = Math.min(maximoLineas - desplazamiento, lineasDisponibles);
    campos.forEach((campo, columna) => {
      const x = f.margen + columna * 255;
      if (desplazamiento === 0) f.page.drawText(`${campo.etiqueta}:`, { x, y:f.y, size:9.7, font:f.bold, color:GRIS });
      campo.lineas.slice(desplazamiento, desplazamiento + cantidad).forEach((linea, indice) => {
        f.page.drawText(linea, { x:x+campo.anchoEtiqueta, y:f.y-indice*11, size:9.7, font:f.font });
      });
    });
    f.y -= Math.max(18, cantidad * 11);
    desplazamiento += cantidad;
  }
}

function medirDatosGenerales(f:FlujoPDF,generales:Array<[string,string]>) {
  let alto=25+7;
  for(let indice=0;indice<generales.length;indice+=2){
    const par=generales.slice(indice,indice+2).map(([etiqueta,valor])=>prepararCampoGeneral(f,etiqueta,valor));
    alto+=Math.max(...par.map(c=>Math.max(18,c.lineas.length*11)));
  }
  return alto;
}

function medirTabla(tabla:{columnas:ColumnaTecnica[];filas:Record<string,unknown>[]},a:AjusteTecnico,f:FlujoPDF) {
  const cajaTitulo=medirCajaVisualTexto(f.bold,TITULO_TECNICO_TAMANO);
  const altoTitulo=cajaTitulo.ascenso+cajaTitulo.descenso;
  const separacion=GAP_ANTES_TITULO_TECNICO+altoTitulo+GAP_DESPUES_TITULO_TECNICO;
  if(!tabla.filas.length){const caja=medirCajaVisualTexto(f.font,a.fuente);return separacion+caja.ascenso+caja.descenso;}
  const cajaEncabezado=medirCajaVisualTexto(f.bold,a.fuente);
  const desplazamientoCaja=a.padding+a.fuente-cajaEncabezado.ascenso;
  const encabezado=Math.max(...tabla.columnas.map(c=>envolver(c.titulo,f.bold,a.fuente,c.ancho-a.padding*2).length))*a.linea+a.padding*2;
  const filas=tabla.filas.reduce((s,fila)=>s+Math.max(...tabla.columnas.map(c=>envolver(c.valor(fila),f.font,a.fuente,c.ancho-a.padding*2).length))*a.linea+a.padding*2,0);
  return separacion+encabezado-desplazamientoCaja+filas+GROSOR_BORDE_FILA/2;
}

function iniciarSeccionTecnica(f:FlujoPDF,titulo:string,altoSiguiente:number):PosicionTituloTecnico {
  const cajaTitulo=medirCajaVisualTexto(f.bold,TITULO_TECNICO_TAMANO);
  const altoTitulo=cajaTitulo.ascenso+cajaTitulo.descenso;
  const paginaAnterior=f.diagnostico.paginas.length-1;
  const fondoAnterior=f.y;
  const requerido=GAP_ANTES_TITULO_TECNICO+altoTitulo+GAP_DESPUES_TITULO_TECNICO+altoSiguiente;
  if(f.y-requerido<f.inferior)f.pagina("tecnica-continuacion");
  const paginaTitulo=f.diagnostico.paginas.length-1;
  const mismaPagina=paginaTitulo===paginaAnterior;
  const tituloTop=f.y-(mismaPagina?GAP_ANTES_TITULO_TECNICO:0);
  const lineaBase=tituloTop-cajaTitulo.ascenso;
  const tituloBottom=lineaBase-cajaTitulo.descenso;
  f.page.drawText(titulo,{x:f.margen,y:lineaBase,size:TITULO_TECNICO_TAMANO,font:f.bold,color:AZUL});
  f.y=tituloBottom-GAP_DESPUES_TITULO_TECNICO;
  return {
    paginaTitulo,tituloTop,tituloBottom,contenidoTop:f.y,
    gapAntesTitulo:mismaPagina?fondoAnterior-tituloTop:undefined,
    gapDespuesTitulo:GAP_DESPUES_TITULO_TECNICO,
    lineaBaseTitulo:lineaBase,ascensoVisualTitulo:cajaTitulo.ascenso,descensoVisualTitulo:cajaTitulo.descenso,
  };
}

function dibujarTablaTecnica(f:FlujoPDF,tabla:{titulo:string;columnas:ColumnaTecnica[];filas:Record<string,unknown>[]},a:AjusteTecnico) {
  const celdas=tabla.filas.map(fila=>tabla.columnas.map(c=>envolver(c.valor(fila),f.font,a.fuente,c.ancho-a.padding*2)));
  const altos=celdas.map(c=>Math.max(...c.map(lineas=>lineas.length))*a.linea+a.padding*2);
  const encabezados=tabla.columnas.map(c=>envolver(c.titulo,f.bold,a.fuente,c.ancho-a.padding*2));
  const altoEncabezado=Math.max(...encabezados.map(l=>l.length))*a.linea+a.padding*2;
  const cajaEncabezado=medirCajaVisualTexto(f.bold,a.fuente);
  const desplazamientoCaja=a.padding+a.fuente-cajaEncabezado.ascenso;
  const paginas:number[]=[]; let alturaCompleta=0;
  const cajaVacio=medirCajaVisualTexto(f.font,a.fuente);
  const altoContenidoInicial=tabla.filas.length?altoEncabezado-desplazamientoCaja+altos[0]+GROSOR_BORDE_FILA/2:cajaVacio.ascenso+cajaVacio.descenso;
  const posicionTitulo=iniciarSeccionTecnica(f,tabla.titulo,altoContenidoInicial);
  const cajaTitulo=medirCajaVisualTexto(f.bold,TITULO_TECNICO_TAMANO);
  alturaCompleta+=GAP_ANTES_TITULO_TECNICO+cajaTitulo.ascenso+cajaTitulo.descenso+GAP_DESPUES_TITULO_TECNICO;
  const encabezado=(primera:number)=>{
    if(f.y-(altoEncabezado-desplazamientoCaja)-primera-GROSOR_BORDE_FILA/2<f.inferior)f.pagina("tecnica-continuacion");
    f.marcar(`tabla:${tabla.titulo}`); paginas.push(f.diagnostico.paginas.length-1);
    let x=f.margen;const superior=f.y+desplazamientoCaja;
    encabezados.forEach((lineas,i)=>{lineas.forEach((texto,j)=>f.page.drawText(texto,{x:x+a.padding,y:superior-a.padding-a.fuente-j*a.linea,size:a.fuente,font:f.bold,color:GRIS}));x+=tabla.columnas[i].ancho;});
    f.y=superior-altoEncabezado;alturaCompleta+=altoEncabezado-desplazamientoCaja;
    f.page.drawLine({start:{x:f.margen,y:f.y},end:{x:A4[0]-f.margen,y:f.y},thickness:.55,color:rgb(.55,.6,.65)});
  };
  if(!tabla.filas.length){
    f.marcar(`tabla:${tabla.titulo}`);paginas.push(f.diagnostico.paginas.length-1);
    const lineaBase=f.y-cajaVacio.ascenso;
    f.page.drawText("Sin registros",{x:f.margen,y:lineaBase,size:a.fuente,font:f.font,color:GRIS});
    f.y=lineaBase-cajaVacio.descenso;alturaCompleta+=cajaVacio.ascenso+cajaVacio.descenso;
    f.diagnostico.tablas.push({titulo:tabla.titulo,alturaEncabezado:0,alturasFilas:[],alturaCompleta,posicionFinal:f.y,paginas,fuente:a.fuente,...posicionTitulo,bordeInferiorFinal:f.y});return;
  }
  encabezado(altos[0]);
  celdas.forEach((fila,indice)=>{
    const restantes=celdas.length-indice;
    if(restantes===2&&f.y-altos[indice]-GROSOR_BORDE_FILA/2>=f.inferior&&f.y-altos[indice]-altos[indice+1]-GROSOR_BORDE_FILA/2<f.inferior){f.pagina("tecnica-continuacion");encabezado(altos[indice]);}
    else if(f.y-altos[indice]-GROSOR_BORDE_FILA/2<f.inferior){f.pagina("tecnica-continuacion");encabezado(altos[indice]);}
    const superior=f.y;let x=f.margen;
    fila.forEach((lineas,i)=>{lineas.forEach((texto,j)=>f.page.drawText(texto,{x:x+a.padding,y:superior-a.padding-a.fuente-j*a.linea,size:a.fuente,font:f.font}));x+=tabla.columnas[i].ancho;});
    f.y-=altos[indice];alturaCompleta+=altos[indice];
    f.page.drawLine({start:{x:f.margen,y:f.y},end:{x:A4[0]-f.margen,y:f.y},thickness:GROSOR_BORDE_FILA,color:rgb(.82,.84,.86)});
  });
  f.y-=GROSOR_BORDE_FILA/2;alturaCompleta+=GROSOR_BORDE_FILA/2;
  f.diagnostico.tablas.push({titulo:tabla.titulo,alturaEncabezado:altoEncabezado,alturasFilas:altos,alturaCompleta,posicionFinal:f.y,paginas:[...new Set(paginas)],fuente:a.fuente,...posicionTitulo,bordeInferiorFinal:f.y});
}

function valorTexto(valor:unknown){return valor===null||valor===undefined||valor===""?"No especificado":String(valor);}

function dibujarPortada(f:FlujoPDF,r:ReportePozo,id:number,image:PDFImage|null){
  f.pagina("portada");f.marcar("portada");const p=f.page;
  p.drawRectangle({x:0,y:A4[1]-18,width:A4[0],height:18,color:AZUL});
  p.drawText("Informe de Perforación",{x:48,y:754,size:27,font:f.bold,color:AZUL});
  let tamanoPropietario=21,lineasPropietario=envolver(r.propietario,f.bold,tamanoPropietario,499);
  while(lineasPropietario.length>2&&tamanoPropietario>18){tamanoPropietario-=.5;lineasPropietario=envolver(r.propietario,f.bold,tamanoPropietario,499);}
  const interlineado=tamanoPropietario+3;
  lineasPropietario.forEach((linea,indice)=>p.drawText(linea,{x:48,y:716-indice*interlineado,size:tamanoPropietario,font:f.bold,color:AZUL}));
  const yPozo=716-lineasPropietario.length*interlineado-4;
  p.drawText(`Pozo Nº ${id}`,{x:48,y:yPozo,size:14,font:f.bold,color:GRIS});
  if(image){const superior=Math.min(640,yPozo-18),caja={x:48,y:235,w:499,h:superior-235};p.drawRectangle({x:caja.x,y:caja.y,width:caja.w,height:caja.h,borderColor:rgb(.65,.69,.73),borderWidth:.8});const e=Math.min((caja.w-12)/image.width,(caja.h-12)/image.height);const w=image.width*e,h=image.height*e;p.drawImage(image,{x:caja.x+(caja.w-w)/2,y:caja.y+(caja.h-h)/2,width:w,height:h});p.drawText("Fotografía de la perforación",{x:48,y:216,size:10.5,font:f.font,color:GRIS});}
  else {p.drawRectangle({x:48,y:330,width:499,height:240,color:rgb(.97,.98,.99),borderColor:rgb(.78,.81,.84),borderWidth:.8});p.drawText("Fotografía no registrada",{x:205,y:445,size:14,font:f.font,color:GRIS});}
  if(r.empresa)p.drawText(r.empresa,{x:48,y:154,size:12,font:f.font,color:GRIS});}

async function dibujarUbicacion(f:FlujoPDF,r:ReportePozo,c:{latitud:number;longitud:number}|null,mapa:Awaited<ReturnType<typeof obtenerMapaEstatico>>){
  f.pagina("ubicacion"); f.marcar("ubicacion"); const p=f.page;
  p.drawText("Ubicación y resumen del pozo",{x:48,y:772,size:20,font:f.bold,color:AZUL});
  let y=735;
  const dato=(e:string,v:string)=>{p.drawText(e,{x:48,y,size:11.5,font:f.bold,color:GRIS});p.drawText(v,{x:175,y,size:12,font:f.font});y-=25;};
  dato("Departamento",r.departamento||"No especificado"); dato("Localidad",r.localidad||"No especificada");
  dato("Coordenadas",c?`${c.latitud.toFixed(6)}, ${c.longitud.toFixed(6)}`:"No registradas");
  const mapaImagen=mapa.estado==="disponible"?mapa:null;
  let mapaDisponible=mapaImagen!==null;
  if(mapaImagen){
    const caja={x:48,y:340,w:499,h:285};
    try{
      const img=mapaImagen.tipo==="image/png"?await f.doc.embedPng(mapaImagen.bytes):await f.doc.embedJpg(mapaImagen.bytes);
      p.drawRectangle({x:caja.x,y:caja.y,width:caja.w,height:caja.h,color:rgb(.97,.98,.99),borderColor:rgb(.72,.76,.8),borderWidth:.8});
      const escala=Math.min(caja.w/img.width,caja.h/img.height);
      const imagenX=caja.x+(caja.w-img.width*escala)/2,imagenY=caja.y+(caja.h-img.height*escala)/2;
      const imagenAncho=img.width*escala,imagenAlto=img.height*escala,atribucionY=caja.y-16;
      p.drawImage(img,{x:imagenX,y:imagenY,width:imagenAncho,height:imagenAlto});
      // La atribución incorporada por el proveedor permanece intacta dentro de la imagen.
      // La atribución textual configurada se agrega fuera del mapa, sin fondo ni overlay.
      p.drawText(mapaImagen.atribucion,{x:caja.x,y:atribucionY,size:9.5,font:f.font,color:GRIS});
      f.diagnostico.mapa={x:caja.x,y:caja.y,ancho:caja.w,alto:caja.h,imagenX,imagenY,imagenAncho,imagenAlto,atribucionY,overlayOpaco:false};
      y=295;
    }catch{mapaDisponible=false;}
  }
  if(!mapaDisponible){
    const alto=72, superior=y-4, inferior=superior-alto; f.diagnostico.fallbackMapaAlto=alto;
    p.drawRectangle({x:48,y:inferior,width:499,height:alto,color:rgb(.97,.98,.99),borderColor:rgb(.72,.76,.8),borderWidth:.8});
    p.drawText("Mapa no disponible",{x:62,y:superior-27,size:14,font:f.bold,color:GRIS});
    const motivo=mapa.estado==="no-disponible"?mapa.motivo:"La imagen del proveedor no pudo procesarse";
    p.drawText(motivo,{x:62,y:superior-50,size:10.5,font:f.font,color:GRIS}); y=inferior-30;
  }
  dato("Perforador",r.perforador||"No especificado"); dato("Fecha de inicio",formatearFechaCalendario(r.fecha_inicio));
  dato("Fecha de finalización",formatearFechaCalendario(r.fecha_fin)); dato("Profundidad final",unidad(r.profundidad_final_m,"m"));
}

async function cargarFoto(doc:PDFDocument,r:ReportePozo,id:number,dir:string){if(!r.foto_url)return null;try{const nombres=await fs.readdir(dir);const nombre=nombres.find(n=>n.startsWith(`pozo-${id}.`)&&/^pozo-\d+\.(?:jpe?g|png)$/i.test(n));if(!nombre)return null;const bytes=await fs.readFile(path.join(dir,nombre));if(bytes.length>5_000_000)return null;if(bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47)return await doc.embedPng(bytes);if(bytes[0]===0xff&&bytes[1]===0xd8)return await doc.embedJpg(bytes);}catch{return null;}return null;}
function envolver(texto:string,font:PDFFont,size:number,width:number){const limpio=texto.replace(/[^\x20-\x7E\xA0-\xFF]/g,"?").trim();const palabras:string[]=[];for(const palabra of (limpio||"No especificado").split(/\s+/)){if(font.widthOfTextAtSize(palabra,size)<=width){palabras.push(palabra);continue;}let fragmento="";for(const caracter of palabra){const candidato=fragmento+caracter;if(fragmento&&font.widthOfTextAtSize(candidato,size)>width){palabras.push(fragmento);fragmento=caracter;}else fragmento=candidato;}if(fragmento)palabras.push(fragmento);}const lineas:string[]=[];let actual="";for(const palabra of palabras){const candidato=actual?`${actual} ${palabra}`:palabra;if(font.widthOfTextAtSize(candidato,size)<=width)actual=candidato;else{if(actual)lineas.push(actual);actual=palabra;}}if(actual)lineas.push(actual);return lineas;}
function unidad(v:number|null,u:string){return v==null?"No especificado":`${formatearNumero(v)} ${u}`;} function formatearNumero(v:number){return new Intl.NumberFormat("es-UY",{maximumFractionDigits:3}).format(v);} function booleano(v:boolean|null){return v==null?"No especificado":v?"Sí":"No";}
export async function generarPDF(reporte:ReportePozo,pozoId:number){const bytes=await generarPDFBytes(reporte,pozoId);await fs.mkdir("./output",{recursive:true});await fs.writeFile(`./output/informe_pozo_${pozoId}.pdf`,bytes);}
export async function generarPDFBytes(reporte:ReportePozo,pozoId:number){return await (await crearPDF(reporte,pozoId)).save();}
