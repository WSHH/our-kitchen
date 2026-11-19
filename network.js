/* Read requests may retry; mutations run once to avoid duplicate dishes or invitations. */
(function(root){
  'use strict';
  class CloudError extends Error{
    constructor(message,{retryable=false,auth=false}={}){super(message);this.name='CloudError';this.retryable=retryable;this.auth=auth;}
  }
  function createClient(options={}){
    const fetcher=options.fetch||root.fetch.bind(root);
    const wait=options.wait||(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
    const later=options.setTimeout||setTimeout,cancel=options.clearTimeout||clearTimeout;
    async function once(cfg,action,payload,signal){
      if(signal?.aborted)throw new DOMException('连接已暂停','AbortError');
      const controller=new AbortController();let timedOut=false;
      let abort,timeout;
      const cancelled=new Promise((_resolve,reject)=>{abort=()=>{controller.abort();reject(new DOMException('连接已暂停','AbortError'));};signal?.addEventListener('abort',abort,{once:true});});
      const deadline=new Promise((_resolve,reject)=>{timeout=later(()=>{timedOut=true;controller.abort();reject(new CloudError('连接较慢，暂时未能同步云厨房',{retryable:true}));},action==='snapshot'?(options.readTimeout||12000):(options.writeTimeout||30000));});
      try{
        const exchange=async()=>{
        const headers={'Content-Type':'application/json',apikey:cfg.publicKey};
        if(cfg.publicKey.startsWith('eyJ'))headers.Authorization='Bearer '+cfg.publicKey;
        const response=await fetcher(cfg.url+'/rest/v1/rpc/love_menu_api',{method:'POST',headers,body:JSON.stringify({p_key:cfg.key,p_action:action,p_payload:payload}),signal:controller.signal,cache:'no-store',referrerPolicy:'no-referrer'});
        const body=await response.json().catch(error=>{if(controller.signal.aborted)throw error;throw new CloudError('网络响应不完整，请重新连接',{retryable:true});});
        if(!response.ok){
          const message=body?.message||'云厨房暂时无法连接';
          throw new CloudError(message,{retryable:response.status===408||response.status===429||response.status>=500,auth:response.status===401||response.status===403||/口令无效|口令已更换|口令应为|厨房口令/.test(message)});
        }
        if(!body||typeof body!=='object')throw new CloudError('网络响应不完整，请重新连接',{retryable:true});
          return body;
        };
        // Some mobile browser requests fail to settle promptly after abort().
        return await Promise.race([exchange(),deadline,cancelled]);
      }catch(error){
        if(signal?.aborted)throw new DOMException('连接已暂停','AbortError');
        if(timedOut||error.name==='AbortError')throw new CloudError('连接较慢，暂时未能同步云厨房',{retryable:true});
        if(error instanceof TypeError)throw new CloudError('网络暂时不可用',{retryable:true});
        throw error;
      }finally{cancel(timeout);signal?.removeEventListener('abort',abort);}
    }
    return async function request(cfg,action,payload={},control={}){
      const attempts=action==='snapshot'?3:1;
      for(let attempt=1;attempt<=attempts;attempt++){
        try{return await once(cfg,action,payload,control.signal);}
        catch(error){
          if(!error.retryable||attempt===attempts||control.signal?.aborted)throw error;
          control.onRetry?.(attempt+1,attempts);
          await wait(attempt*750);
        }
      }
    };
  }
  // Only the currently connected identity may restore this device's last menu.
  function snapshotCache(storage){
    const name='lk-cloud-snapshot-v1';
    return {
      read(connectionId){
        if(!connectionId)return null;
        try{const entry=JSON.parse(storage.getItem(name));const data=entry?.data;
          return entry?.connectionId===connectionId&&Number.isFinite(entry.savedAt)&&typeof data?.kitchen?.name==='string'&&Number.isFinite(data.kitchen.revision)&&['chef','guest'].includes(data.kitchen.role)&&Array.isArray(data.dishes)&&Array.isArray(data.orders)?entry:null;
        }catch{return null;}
      },
      write(connectionId,data,savedAt){
        if(!connectionId)return;
        try{storage.setItem(name,JSON.stringify({connectionId,data,savedAt}));}catch{/* A full device must not turn a successful cloud request into a failed save. */}
      },
      clear(){try{storage.removeItem(name);}catch{}}
    };
  }
  const api={createClient,snapshotCache,CloudError};root.KitchenNetwork=api;
  if(typeof module!=='undefined')module.exports=api;
})(globalThis);
