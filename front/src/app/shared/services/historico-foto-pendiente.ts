// La foto puede ocupar 5 MB: no almacenarla como base64 en sessionStorage.
// La clave incluye servidor, actor y UUID de la creación idempotente.
export async function fotoHistoricaPendiente(key:string, action:'leer'|'guardar'|'borrar', value?:unknown):Promise<unknown>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open('rsp-historicos-pendientes',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('fotos');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('fotos',action==='leer'?'readonly':'readwrite');
    const store=tx.objectStore('fotos');
    const req=action==='leer'?store.get(key):action==='guardar'?store.put(value,key):store.delete(key);
    tx.oncomplete=()=>resolve(req.result);tx.onabort=()=>reject(tx.error??Error('No se pudo conservar la fotografía para reintentar.'));
    tx.onerror=()=>reject(tx.error);
  });}finally{db.close();}
}
