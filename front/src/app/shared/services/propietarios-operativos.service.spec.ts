import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PropietariosOperativosService } from './propietarios-operativos.service';

describe('PropietariosOperativosService', () => {
  it('envía datos operativos sin campos de cuenta', async () => {
    TestBed.configureTestingModule({ providers:[provideHttpClient(),provideHttpClientTesting()] });
    const servicio=TestBed.inject(PropietariosOperativosService);const http=TestBed.inject(HttpTestingController);
    const promesa=servicio.crear({nombre:'Persona nueva'});
    const req=http.expectOne((r)=>r.method==='POST'&&r.url.endsWith('/pozos/propietarios'));
    expect(req.request.body).toEqual({nombre:'Persona nueva'});
    expect(req.request.body.roles).toBeUndefined();expect(req.request.body.activo).toBeUndefined();
    req.flush({id_usuario:91,nombre:'Persona nueva',roles:['propietario']});
    expect((await promesa).id_usuario).toBe(91);
  });

  it('obtiene y actualiza por el endpoint operativo separado de usuarios', async () => {
    TestBed.configureTestingModule({ providers:[provideHttpClient(),provideHttpClientTesting()] });
    const servicio=TestBed.inject(PropietariosOperativosService);const http=TestBed.inject(HttpTestingController);
    const obtener=servicio.obtener(91);const get=http.expectOne((r)=>r.method==='GET'&&r.url.endsWith('/pozos/propietarios/91'));
    get.flush({id_usuario:91,nombre:'Persona',documento_rut:null,telefono:null,email:null,direccion:null,localidad:null,departamento:null,observaciones:null});
    expect((await obtener).email).toBeNull();
    const actualizar=servicio.actualizar(91,{telefono:'',departamento:'Salto'});
    const put=http.expectOne((r)=>r.method==='PUT'&&r.url.endsWith('/pozos/propietarios/91'));
    expect(put.request.body).toEqual({telefono:'',departamento:'Salto'});
    put.flush({id_usuario:91,nombre:'Persona',documento_rut:null,telefono:null,email:null,direccion:null,localidad:null,departamento:'Salto',observaciones:null});
    expect((await actualizar).departamento).toBe('Salto');
  });
});
