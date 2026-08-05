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
export interface DiagnosticoPDF { paginas: { tipo: string; bloques: string[] }[] }

class FlujoPDF {
  page!: PDFPage; y = 0; readonly diagnostico: DiagnosticoPDF = { paginas: [] };
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
    if (!filas.length) { this.titulo(titulo, 20); this.texto("Sin registros"); return; }
    const encabezado = () => {
      this.reservar(54); this.marcar(`tabla:${titulo}`);
      this.page.drawText(titulo, {x:this.margen,y:this.y,size:17,font:this.bold,color:AZUL}); this.y-=24;
      let x=this.margen; for(const c of columnas){this.page.drawText(c.titulo,{x:x+5,y:this.y,size:11,font:this.bold});x+=c.ancho;} this.y-=18;
      this.page.drawLine({start:{x:this.margen,y:this.y+5},end:{x:A4[0]-this.margen,y:this.y+5},thickness:.7,color:rgb(.55,.6,.65)});
    };
    encabezado();
    for (const fila of filas) {
      const celdas=columnas.map(c=>envolver(c.valor(fila),this.font,11,c.ancho-10));
      const alto=Math.max(25,...celdas.map(l=>l.length*14+8));
      if(this.y-alto<this.inferior){this.pagina();encabezado();}
      let x=this.margen; celdas.forEach((lineas,i)=>{lineas.forEach((linea,j)=>this.page.drawText(linea,{x:x+5,y:this.y-j*14,size:11,font:this.font}));x+=columnas[i].ancho;});
      this.y-=alto; this.page.drawLine({start:{x:this.margen,y:this.y+5},end:{x:A4[0]-this.margen,y:this.y+5},thickness:.35,color:rgb(.82,.84,.86)});
    }
    this.y-=14;
  }
  texto(texto:string){const lineas=envolver(texto,this.font,12,A4[0]-this.margen*2);this.reservar(lineas.length*15+8);this.marcar("texto");lineas.forEach((l,i)=>this.page.drawText(l,{x:this.margen,y:this.y-i*15,size:12,font:this.font,color:GRIS}));this.y-=lineas.length*15+8;}
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
  flujo.pagina(); flujo.titulo("Datos generales");
  flujo.campo("Nivel estático", unidad(reporte.nivel_estatico_m,"m")); flujo.campo("Nivel dinámico",unidad(reporte.nivel_dinamico_m,"m"));
  flujo.campo("Caudal estimado",unidad(reporte.caudal_estimado_lh,"l/h")); flujo.campo("Sello sanitario",booleano(reporte.sello_sanitario));
  flujo.campo("Prefiltro",reporte.pre_filtro); flujo.campo("Revestimiento",reporte.revestimiento); flujo.campo("Método sedimentario",reporte.metodo_sedimentario);
  flujo.campo("Método rocoso",reporte.metodo_rocoso); flujo.campo("Cementación",reporte.cementacion); flujo.campo("Desarrollo",reporte.desarrollo);
  const n=(v:number)=>formatearNumero(v);
  flujo.tabla("Intervalos litológicos",[{titulo:"Desde",ancho:90,valor:f=>`${n(Number(f.desde_m))} m`},{titulo:"Hasta",ancho:90,valor:f=>`${n(Number(f.hasta_m))} m`},{titulo:"Material",ancho:319,valor:f=>String(f.material)}],reporte.litologia);
  flujo.tabla("Tuberías y diámetros",[{titulo:"Desde",ancho:85,valor:f=>`${n(Number(f.desde_m))} m`},{titulo:"Hasta",ancho:85,valor:f=>`${n(Number(f.hasta_m))} m`},{titulo:"Diámetro",ancho:115,valor:f=>`${n(Number(f.diametro_pulg))} pulg`},{titulo:"Material",ancho:214,valor:f=>String(f.material_tuberia??"No especificado")}],reporte.diametros);
  flujo.tabla("Intervalos de filtro",[{titulo:"Desde",ancho:85,valor:f=>`${n(Number(f.desde_m))} m`},{titulo:"Hasta",ancho:85,valor:f=>`${n(Number(f.hasta_m))} m`},{titulo:"Diámetro",ancho:115,valor:f=>`${n(Number(f.diametro_pulg))} pulg`},{titulo:"Material",ancho:214,valor:f=>String(f.material_tuberia)}],reporte.filtros??[]);
  flujo.tabla("Niveles de aporte",[{titulo:"Profundidad",ancho:499,valor:f=>`${n(Number(f.profundidad_m))} m`}],reporte.niveles_aporte);
  const perfil=crearPerfilLitologico(reporte.litologia,reporte.profundidad_final_m,reporte.niveles_aporte,reporte.diametros,reporte.filtros??[]);
  if(perfil) dibujarPerfilLitologico(doc,perfil,font,bold);
  return { documento:doc, diagnostico:flujo.diagnostico };
}

function dibujarPortada(f:FlujoPDF,r:ReportePozo,id:number,image:PDFImage|null){f.pagina("portada");f.marcar("portada");const p=f.page;p.drawRectangle({x:0,y:A4[1]-18,width:A4[0],height:18,color:AZUL});p.drawText("Informe de Perforación",{x:48,y:744,size:28,font:f.bold,color:AZUL});p.drawText(`Pozo Nº ${id}`,{x:48,y:710,size:17,font:f.bold,color:GRIS});
  if(image){const caja={x:48,y:235,w:499,h:425};p.drawRectangle({x:caja.x,y:caja.y,width:caja.w,height:caja.h,borderColor:rgb(.65,.69,.73),borderWidth:.8});const e=Math.min((caja.w-12)/image.width,(caja.h-12)/image.height);const w=image.width*e,h=image.height*e;p.drawImage(image,{x:caja.x+(caja.w-w)/2,y:caja.y+(caja.h-h)/2,width:w,height:h});p.drawText("Fotografía de la perforación",{x:48,y:216,size:10.5,font:f.font,color:GRIS});}
  else {p.drawRectangle({x:48,y:330,width:499,height:240,color:rgb(.97,.98,.99),borderColor:rgb(.78,.81,.84),borderWidth:.8});p.drawText("Fotografía no registrada",{x:205,y:445,size:14,font:f.font,color:GRIS});}
  p.drawText("Propietario",{x:48,y:154,size:11.5,font:f.bold,color:GRIS});envolver(r.propietario,f.font,14,499).slice(0,2).forEach((l,i)=>p.drawText(l,{x:48,y:132-i*17,size:14,font:f.font}));if(r.empresa)p.drawText(r.empresa,{x:48,y:91,size:11.5,font:f.font,color:GRIS});}

async function dibujarUbicacion(f:FlujoPDF,r:ReportePozo,c:{latitud:number;longitud:number}|null,mapa:Awaited<ReturnType<typeof obtenerMapaEstatico>>){f.pagina("ubicacion");f.marcar("ubicacion");const p=f.page;p.drawText("Ubicación y resumen del pozo",{x:48,y:772,size:20,font:f.bold,color:AZUL});let y=735;const dato=(e:string,v:string)=>{p.drawText(e,{x:48,y,size:11.5,font:f.bold,color:GRIS});p.drawText(v,{x:175,y,size:12,font:f.font});y-=25;};dato("Departamento",r.departamento||"No especificado");dato("Localidad",r.localidad||"No especificada");dato("Coordenadas",c?`${c.latitud.toFixed(6)}, ${c.longitud.toFixed(6)}`:"No registradas");
  const caja={x:48,y:340,w:499,h:285};p.drawRectangle({x:caja.x,y:caja.y,width:caja.w,height:caja.h,color:rgb(.97,.98,.99),borderColor:rgb(.72,.76,.8),borderWidth:.8});if(mapa.estado==="disponible"){try{const img=mapa.tipo==="image/png"?await f.doc.embedPng(mapa.bytes):await f.doc.embedJpg(mapa.bytes);const e=Math.min(caja.w/img.width,caja.h/img.height);p.drawImage(img,{x:caja.x+(caja.w-img.width*e)/2,y:caja.y+(caja.h-img.height*e)/2,width:img.width*e,height:img.height*e});p.drawRectangle({x:48,y:340,width:499,height:18,color:rgb(1,1,1),opacity:.82});p.drawText(mapa.atribucion,{x:54,y:346,size:10.5,font:f.font,color:GRIS});}catch{p.drawText("Mapa no disponible",{x:220,y:480,size:14,font:f.font,color:GRIS});}}else p.drawText("Mapa no disponible",{x:220,y:480,size:14,font:f.font,color:GRIS});
  y=305;dato("Perforador",r.perforador||"No especificado");dato("Fecha de inicio",formatearFechaCalendario(r.fecha_inicio));dato("Fecha de finalización",formatearFechaCalendario(r.fecha_fin));dato("Profundidad final",unidad(r.profundidad_final_m,"m"));}

async function cargarFoto(doc:PDFDocument,r:ReportePozo,id:number,dir:string){if(!r.foto_url)return null;try{const nombres=await fs.readdir(dir);const nombre=nombres.find(n=>n.startsWith(`pozo-${id}.`)&&/^pozo-\d+\.(?:jpe?g|png)$/i.test(n));if(!nombre)return null;const bytes=await fs.readFile(path.join(dir,nombre));if(bytes.length>5_000_000)return null;if(bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47)return await doc.embedPng(bytes);if(bytes[0]===0xff&&bytes[1]===0xd8)return await doc.embedJpg(bytes);}catch{return null;}return null;}
function envolver(texto:string,font:PDFFont,size:number,width:number){const limpio=texto.replace(/[^\x20-\x7E\xA0-\xFF]/g,"?").trim();const palabras:string[]=[];for(const palabra of (limpio||"No especificado").split(/\s+/)){if(font.widthOfTextAtSize(palabra,size)<=width){palabras.push(palabra);continue;}let fragmento="";for(const caracter of palabra){const candidato=fragmento+caracter;if(fragmento&&font.widthOfTextAtSize(candidato,size)>width){palabras.push(fragmento);fragmento=caracter;}else fragmento=candidato;}if(fragmento)palabras.push(fragmento);}const lineas:string[]=[];let actual="";for(const palabra of palabras){const candidato=actual?`${actual} ${palabra}`:palabra;if(font.widthOfTextAtSize(candidato,size)<=width)actual=candidato;else{if(actual)lineas.push(actual);actual=palabra;}}if(actual)lineas.push(actual);return lineas;}
function unidad(v:number|null,u:string){return v==null?"No especificado":`${formatearNumero(v)} ${u}`;} function formatearNumero(v:number){return new Intl.NumberFormat("es-UY",{maximumFractionDigits:3}).format(v);} function booleano(v:boolean|null){return v==null?"No especificado":v?"Sí":"No";}
export async function generarPDF(reporte:ReportePozo,pozoId:number){const bytes=await generarPDFBytes(reporte,pozoId);await fs.mkdir("./output",{recursive:true});await fs.writeFile(`./output/informe_pozo_${pozoId}.pdf`,bytes);}
export async function generarPDFBytes(reporte:ReportePozo,pozoId:number){return await (await crearPDF(reporte,pozoId)).save();}
