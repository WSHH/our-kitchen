const CACHE='love-kitchen-v5';
const FILES=['./','start.html','index.html','style.css','core.js','network.js','app.js','config.js','manifest.webmanifest','assets/icon.svg','assets/icon-192.png','assets/icon-512.png'];
self.addEventListener('install',event=>{
  // Install the whole release together; keep the previous release if installation fails.
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES.map(file=>new Request(new URL(file,self.registration.scope),{cache:'reload'})))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('love-kitchen-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
async function shell(request){
  const cache=await caches.open(CACHE);
  const saved=await cache.match(request,{ignoreSearch:true});
  // Desktop shortcuts open immediately even when the mobile network stalls.
  // Keep release files together until the next complete worker update.
  if(saved)return saved;
  const controller=new AbortController();let timer;
  const deadline=new Promise((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Website timed out'));},8000);});
  try{
    const response=await Promise.race([fetch(request,{signal:controller.signal}),deadline]);
    if(response.ok)return response;
    throw new Error('Website unavailable');
  }catch{
    if(request.mode==='navigate'){
      const index=await cache.match(new URL('index.html',self.registration.scope));if(index)return index;
      return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>小厨房暂时离线</title><body style="font-family:system-ui;padding:40px;line-height:2;background:#faf7f0;color:#535d42"><h1>网络暂时没有连上</h1><p>第一次打开需要联网。请检查手机浏览器是否允许使用移动数据，再重新打开小厨房。</p><a href="./">重新打开</a></body></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8'}});
    }
    return Response.error();
  }finally{clearTimeout(timer);}
}
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  // No API requests, credentials, menu data or other sites go into the shell cache.
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  if(!FILES.some(file=>new URL(file,self.registration.scope).pathname===url.pathname))return;
  event.respondWith(shell(event.request));
});
