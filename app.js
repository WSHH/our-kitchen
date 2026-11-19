/* Native browser app: no build tools, no analytics, no external JavaScript dependencies. */
(() => {
  'use strict';
  const C=window.KitchenCore;
  const $=selector=>document.querySelector(selector);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icons={menu:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>',orders:'<path d="M7 5h10l2 16H5L7 5Z"/><path d="M9 7V5a3 3 0 0 1 6 0v2M9 12h6M9 16h4"/>',heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 4M18 18a8 8 0 0 1-13-4"/>',plus:'<path d="M12 5v14M5 12h14"/>',photo:'<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',chat:'<path d="M21 11a9 9 0 0 1-9 9c-2 0-4-.6-5.4-1.7L3 20l1.2-4A9 9 0 1 1 21 11Z"/><path d="M7 11h.01M12 11h.01M17 11h.01"/>'};
  const icon=name=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[name]+'</svg>';
  const store={read(k,fallback){try{return JSON.parse(localStorage.getItem(k))??fallback;}catch{return fallback;}},write(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{throw new Error('浏览器存储空间不足，请先备份数据并减少照片');}}};
  let demo=store.read('lk-demo-v1',null)||C.initial();
  const savedConnection=store.read('lk-connection-v1',null);
  const defaults=window.KITCHEN_CONFIG||{};
  let connection=savedConnection||{url:defaults.supabaseUrl||'',publicKey:defaults.supabasePublicKey||'',key:''};
  const state={mode:store.read('lk-mode-v1','demo'),role:store.read('lk-role-v1','guest'),tab:'menu',search:'',data:null,cart:{},busy:false,loading:false,error:'',checkoutRequest:null};
  if(!connection.key)state.mode='demo';
  let timer,toastTimer,editorPhoto='',uploading=false,modalReturnFocus=null,modalHandler=null,installPrompt=null,refreshQueued=false;
  function toast(message){const node=$('#toast');node.textContent=message;node.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('visible'),4200);}
  function validConnection(value){
    const url=value.url.trim().replace(/\/$/,'');
    C.assert(/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url),'请填写正确的 Supabase Project URL（https://项目编号.supabase.co）');
    const publicKey=value.publicKey.trim();
    C.assert(publicKey&&!publicKey.startsWith('sb_secret_'),'只能使用 publishable / anon 公钥，不能使用私密密钥');
    if(publicKey.startsWith('eyJ')){try{const claims=JSON.parse(atob(publicKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));C.assert(claims.role==='anon','请使用 anon 公钥，不能使用 service_role 密钥');}catch{throw new Error('公钥格式不正确，或者不是 anon 公钥');}}
    else C.assert(/^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey),'请填写 Supabase publishable 或 anon 公钥');
    return {url,publicKey,key:C.accessKey(value.key)};
  }
  async function cloud(action,payload={},cfg=connection){
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),18000);
    try{
      const headers={'Content-Type':'application/json',apikey:cfg.publicKey};if(cfg.publicKey.startsWith('eyJ'))headers.Authorization='Bearer '+cfg.publicKey;
      const response=await fetch(cfg.url+'/rest/v1/rpc/love_menu_api',{method:'POST',headers,body:JSON.stringify({p_key:cfg.key,p_action:action,p_payload:payload}),signal:controller.signal,cache:'no-store',referrerPolicy:'no-referrer'});
      const body=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(body?.message||'云端连接失败，请核对配置及数据库脚本');return body;
    }catch(e){if(e.name==='AbortError')throw new Error('连接超时，请检查网络后重试');if(e instanceof TypeError)throw new Error('网络连接失败，请联网后再试');throw e;}finally{clearTimeout(timeout);}
  }
  async function action(name,payload={}){
    if(state.mode==='cloud')return cloud(name,payload);
    const next=JSON.parse(JSON.stringify(demo));const result=await C.localAction(next,state.role,name,payload);store.write('lk-demo-v1',next);demo=next;return result;
  }
  function chef(){return state.role==='chef';}
  function date(value){return new Date(value).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});}
  function photo(d){return d.photo&&/^data:image\/(jpeg|png|webp);base64,/.test(d.photo)?'<img src="'+esc(d.photo)+'" alt="'+esc(d.name)+'" loading="lazy">':'<span class="illustration"><span class="mini-plate" aria-hidden="true">'+esc(d.emoji||'🍽️')+'</span></span>';}
  const dishes=()=>state.data?.dishes||[];
  const orders=()=>state.data?.orders||[];
  function cartItems(){return dishes().filter(d=>state.cart[d.id]>0).map(d=>({...d,quantity:state.cart[d.id]}));}
  function tidyCart(){const ids=new Set(dishes().map(d=>d.id));for(const id of Object.keys(state.cart))if(!ids.has(id))delete state.cart[id];}
  async function refresh(manual=false){
    if(state.loading){refreshQueued=true;return;}state.loading=true;
    const context=state.mode+':'+connection.key+':'+state.role;
    try{
      const snapshot=await action('snapshot',{revision:manual?-1:state.data?.kitchen.revision??-1});
      if(context!==state.mode+':'+connection.key+':'+state.role)return;
      if(!snapshot.unchanged){
        const oldIds=new Set(orders().map(o=>o.id));const hadData=!!state.data;
        state.data=snapshot;state.role=snapshot.kitchen.role;tidyCart();state.error='';render();
        if(hadData&&chef()&&orders().some(o=>o.status==='pending'&&!oldIds.has(o.id)))toast('收到新的点菜订单啦，请查看「订单」');
      }else if(state.error){state.error='';render();}
      if(manual)toast('已刷新最新菜单和订单');
    }catch(e){if(context!==state.mode+':'+connection.key+':'+state.role)return;const firstError=!state.error;state.error=e.message;if(!state.data||manual||firstError)render();if(manual)toast(e.message);}finally{state.loading=false;if(refreshQueued){refreshQueued=false;queueMicrotask(()=>refresh(false));}}
  }
  function banner(){return state.mode==='demo'?'<div class="demo-banner"><span>本机演示 · 数据只保存在当前浏览器，尚未与另一部手机同步。</span><button class="text-button" data-action="connect">连接云端</button></div>':'';}
  function render(){
    if(!state.data){$('#app').innerHTML='<main class="shell"><div class="page-top"><p class="eyebrow">A LITTLE KITCHEN FOR TWO</p><h1>正在打开小厨房…</h1><p class="muted">'+esc(state.error||'请稍候')+'</p><div class="actions"><button class="secondary" data-action="refresh">重新连接</button><button class="secondary" data-action="demo">使用本机演示</button></div></div></main>';return;}
    const name=state.data.kitchen.name;
    $('#app').innerHTML='<main class="shell"><header class="header"><div class="brand"><img src="assets/icon.svg" alt=""><span>'+esc(name)+'</span></div><div class="header-right"><span class="badge"><span class="status-dot"></span>'+ (chef()?'专属主厨':'首席品尝官')+'</span><button class="icon-button" data-action="refresh" aria-label="刷新菜单和订单">'+icon('refresh')+'</button></div></header>'+banner()+(state.error?'<div class="error-banner">'+esc(state.error)+' · 云端操作需联网，正在等待连接恢复。</div>':'')+(state.tab==='menu'?menuView():state.tab==='orders'?ordersView():settingsView())+'<footer class="footer">两个人，一日三餐 · 把喜欢，做成日常</footer></main><nav class="nav" aria-label="主要导航">'+[['menu','menu','今日菜单'],['orders','orders','我们的订单'],['settings','heart','我们']].map(([key,i,label])=>'<button data-action="tab" data-tab="'+key+'" class="'+(state.tab===key?'active':'')+'" '+(state.tab===key?'aria-current="page"':'')+'>'+icon(i)+label+'</button>').join('')+'</nav>';
  }
  function menuView(){const now=new Date();return '<section class="intro"><div><div class="eyebrow">GOOD FOOD, BETTER TOGETHER</div><h1>今天，想吃什么？</h1><p>你负责认真点菜，我负责把爱意端上桌。</p></div><div class="intro-date">'+(now.getMonth()+1)+' 月<strong>'+String(now.getDate()).padStart(2,'0')+'</strong>'+['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][now.getDay()]+'</div></section><section class="hero"><div class="hero-copy"><div class="eyebrow">ONLY FOR MY FAVORITE PERSON</div><h2>一屋 · 两人<br>三餐 · 四季</h2><p>人间烟火里，<br>有你喜欢的每一种味道。</p></div><div class="hero-art" aria-hidden="true"><div class="plate"><span class="plate-heart">♥</span><span class="plate-label">made with love</span></div><span class="twig">❧</span></div></section><div class="toolbar"><div class="section-heading"><h2>主厨的拿手菜</h2><span>'+dishes().length+' 道家常</span></div><div class="toolbar-controls"><input type="search" class="search" id="search" aria-label="搜索菜名或食材" placeholder="搜一搜，今天想吃的那一口" value="'+esc(state.search)+'">'+(chef()?'<button class="primary" data-action="edit">'+icon('plus')+'添加菜品</button>':'')+'</div></div><div class="grid" id="dish-grid">'+dishCards()+'</div><div id="cart-slot">'+cartView()+'</div>';}
  function dishCards(){return dishes().filter(d=>(d.name+' '+d.ingredients).toLowerCase().includes(state.search.toLowerCase())).map(d=>'<article class="dish"><button class="dish-visual" data-action="detail" data-id="'+esc(d.id)+'" aria-label="查看'+esc(d.name)+'的做法">'+photo(d)+'</button><div class="dish-content"><div class="dish-title"><button data-action="detail" data-id="'+esc(d.id)+'">'+esc(d.name)+'</button><span class="time">'+icon('clock')+d.minutes+' 分钟</span></div><p class="dish-note">'+esc(d.note||'平凡的一道家常，也是专属于你的偏爱。')+'</p><div class="dish-bottom"><span class="tag">'+esc(d.ingredients?.split('\n')[0]||'主厨私房菜')+'</span>'+(chef()?'<button class="edit-dish" data-action="edit" data-id="'+esc(d.id)+'">编辑菜谱 ↗</button>':'<div class="qty" aria-label="点菜数量"><button data-action="quantity" data-id="'+esc(d.id)+'" data-delta="-1" aria-label="减少'+esc(d.name)+'的份数">−</button><span>'+(state.cart[d.id]||0)+'</span><button data-action="quantity" data-id="'+esc(d.id)+'" data-delta="1" aria-label="增加'+esc(d.name)+'的份数">＋</button></div>')+'</div></div></article>').join('')||'<div class="empty">'+icon('menu')+(state.search?'暂时没找到这道菜，换个关键词试试。':'菜单还是空的，等主厨添加第一道拿手菜吧。')+'</div>';}
  function cartView(){const total=cartItems().reduce((s,d)=>s+d.quantity,0);return total&&!chef()?'<aside class="cart"><div><strong>今天的期待，共 '+total+' 份</strong><p>选好喜欢的，剩下的交给我。</p></div><button data-action="checkout">选好啦 →</button></aside>':'';}
  function ordersView(){return '<section class="page-top"><div class="eyebrow">LOVE, SERVED WARM</div><h1>每一餐，都有回应</h1><p class="muted">'+(chef()?'有人在期待你的拿手好菜。':'从一张小纸条，到热气腾腾的一餐。')+' · 最近 30 笔订单</p></section><div class="order-list">'+(orders().map(o=>'<article class="order"><div class="order-header"><span class="muted">'+date(o.created_at)+'</span><span class="order-state '+o.status+'">'+esc(C.STATUS[o.status]||o.status)+'</span></div>'+o.items.map((d,index)=>'<div class="order-line"><button data-action="order-recipe" data-order="'+esc(o.id)+'" data-index="'+index+'">'+esc(d.name)+'<small>约 '+d.minutes+' 分钟 · 查看下单时的菜谱 ›</small></button><span>×'+d.quantity+'</span></div>').join('')+(o.note?'<div class="order-note">给主厨的小纸条：<br>'+esc(o.note)+'</div>':'')+(chef()&&o.status!=='done'?'<button class="primary" data-action="advance" data-id="'+esc(o.id)+'" data-status="'+o.status+'" '+(state.busy?'disabled':'')+'>'+(o.status==='pending'?'收到，开始做饭':'做好啦，准备开饭')+'</button>':'')+(o.status==='done'?'<div class="order-end">这一餐的爱意，已经送达 ♡</div>':'')+'</article>').join('')||'<div class="empty">'+icon('orders')+'还没有订单。先去菜单里选一选吧。<br><button class="text-button" data-action="tab" data-tab="menu">去点一份喜欢</button></div>')+'</div>';}
  function settingsView(){return '<section class="page-top"><div class="eyebrow">OUR SMALL, HAPPY LIFE</div><h1>把日常，过成喜欢</h1><p class="muted">一人掌勺，一人期待。刚刚好的两人份生活。</p></section><div class="settings-grid"><section class="panel"><div class="eyebrow">OUR LITTLE KITCHEN</div><h2>'+esc(state.data.kitchen.name)+'</h2><p>'+(chef()?'你是这间小厨房的专属主厨。':'你是这间小厨房的首席品尝官。')+'</p>'+(state.mode==='demo'?'<div class="notice">这是本机演示：下单、编辑和订单进度都能试用，但另一部手机看不到这里的数据。</div><div class="role-switch"><button data-action="role" data-role="chef" class="'+(chef()?'active':'')+'">我是主厨</button><button data-action="role" data-role="guest" class="'+(!chef()?'active':'')+'">我是品尝官</button></div><button class="primary" data-action="connect">配置两部手机同步</button>':'<div class="connection">● 已连接私人云厨房 · 前台每 15 秒检查更新</div>'+(chef()?'<button class="primary" data-action="invite">邀请另一半</button>':'')+'<button class="secondary" data-action="backup-key">查看并备份我的口令</button><button class="secondary" data-action="disconnect">退出云厨房，返回本机演示</button>')+(chef()?'<button class="secondary" data-action="rename">修改厨房名称</button><button class="secondary" data-action="export">导出当前可见菜谱与订单</button>':'')+'</section><section class="panel"><div class="eyebrow">KEEP IN TOUCH</div><h2>聊天，还是微信最顺手</h2><p>文字、照片、文件、语音和视频，都在你们熟悉的微信里继续。网页负责好好点菜，微信负责好好聊天。</p><button class="secondary" data-action="wechat">'+icon('chat')+'如何在微信里提醒 TA？</button><div class="notice" style="margin-top:20px">本网页不自动发送微信消息。下单后可复制一段小纸条，自己发到你们的微信聊天里。主厨打开网页时能查看订单。</div></section><section class="panel"><div class="eyebrow">ALWAYS CLOSE TO YOU</div><h2>放到手机桌面</h2><ol class="steps"><li>用手机浏览器打开正式部署的网址。</li><li>iPhone：Safari → 分享 → 添加到主屏幕。</li><li>安卓：Chrome / Edge 菜单 → 添加到主屏幕或安装应用。</li></ol><button class="secondary" data-action="install">添加到桌面说明</button><p class="muted">安装能力因浏览器而异；微信内置浏览器可能需要先选择“在浏览器打开”。</p></section><section class="panel"><div class="eyebrow">SMALL AND SIMPLE</div><h2>免费，也要用得明白</h2><p>网页本身没有订阅费。GitHub Pages 和 Supabase 可使用其免费方案；是否超额、暂停或调整政策，以服务商实际规则为准。照片会自动压缩，以节省空间和流量。</p><p class="muted">不绑定付款方式、不升级付费计划。免费项目可能在闲置后暂停；重新启用需要登录服务商后台。尚未连接云端时，只能在本机演示。</p></section></div>';}
  function openModal(title,body,handler,wide=false){
    modalReturnFocus=document.activeElement;modalHandler=handler;
    $('#modal-root').innerHTML='<div class="overlay"><section class="modal '+(wide?'wide':'')+'" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"><div class="modal-head"><h2 id="modal-title">'+esc(title)+'</h2><button class="close" data-action="close" aria-label="关闭">×</button></div>'+body+'</section></div>';
    document.body.style.overflow='hidden';requestAnimationFrame(()=>$('.modal')?.focus());
  }
  function closeModal(){if(state.busy||uploading)return;$('#modal-root').innerHTML='';modalHandler=null;document.body.style.overflow='';modalReturnFocus?.focus();}
  function markBusy(busy){state.busy=busy;document.querySelectorAll('.modal button[type="submit"]').forEach(b=>{b.disabled=busy;b.textContent=busy?'正在保存…':b.dataset.label||'确认';});}
  function recipe(d,snapshot=false){openModal(d.name,(d.photo?'<img class="detail-photo" src="'+esc(d.photo)+'" alt="'+esc(d.name)+'">':'')+'<div class="badge" style="display:inline-block">'+d.minutes+' 分钟 · '+(snapshot?'下单时的菜谱快照':'用心制作')+'</div>'+[['所需食材',d.ingredients||'主厨还没有填写'],['制作方法',d.method||'独家秘方，待补充'],['主厨的小叮嘱',d.note||'好好吃饭，今天也要开心。']].map(([title,value])=>'<div class="detail-section"><h3>'+title+'</h3><p>'+esc(value)+'</p></div>').join(''),null,true);}
  function edit(id){
    C.assert(chef(),'只有主厨可以编辑菜品');const d=dishes().find(d=>d.id===id)||{name:'',minutes:30,photo:'',ingredients:'',method:'',note:''};editorPhoto=d.photo;
    openModal(id?'完善这道好味':'添加一道拿手菜','<form id="edit-form"><label class="upload" id="upload-label"><span id="photo-preview">'+(d.photo?'<img src="'+esc(d.photo)+'" alt="菜品照片">':icon('photo')+'<span>拍一张，或选择菜品照片</span>')+'</span><input type="file" id="photo-file" accept="image/*" aria-label="上传菜品照片"></label><p class="muted" style="margin-top:9px">自动压缩照片；建议选择清晰的横图。照片可不填。</p><button type="button" class="text-button" data-action="remove-photo">移除照片</button><label class="form-label" for="dish-name">菜品名称 *</label><input class="field" id="dish-name" name="name" required maxlength="50" value="'+esc(d.name)+'" placeholder="例如：番茄炖牛腩"><label class="form-label" for="dish-minutes">制作时间（分钟）*</label><input class="field" id="dish-minutes" name="minutes" type="number" min="1" max="1440" step="1" required value="'+d.minutes+'"><label class="form-label" for="ingredients">所需食材</label><textarea class="field" id="ingredients" name="ingredients" maxlength="2000" placeholder="牛腩 300g、番茄 2 个…">'+esc(d.ingredients)+'</textarea><label class="form-label" for="method">制作方法</label><textarea class="field" id="method" name="method" maxlength="6000" rows="6" placeholder="1. 准备食材…&#10;2. 小火慢炖…">'+esc(d.method)+'</textarea><label class="form-label" for="dish-note">菜品备注</label><textarea class="field" id="dish-note" name="note" maxlength="1000" placeholder="口味、过敏提醒、独家秘诀…">'+esc(d.note)+'</textarea><div class="actions">'+(id?'<button class="danger" type="button" data-action="delete" data-id="'+esc(id)+'">删除菜品</button>':'')+'<button class="primary" type="submit" data-label="保存到菜单">保存到菜单</button></div></form>',async form=>{C.assert(!uploading,'照片正在压缩，请稍候');const values=Object.fromEntries(new FormData(form));await mutate('save_dish',{...C.dish({...values,photo:editorPhoto}),...(id?{id}:{})},'这道好味，已加入菜单');});
  }
  async function mutate(name,payload,message){markBusy(true);try{const result=await action(name,payload);markBusy(false);closeModal();await refresh(false);toast(message);return result;}catch(e){markBusy(false);throw e;}}
  function checkout(){
    const selected=cartItems();C.assert(selected.length>0,'先选择想吃的菜吧');C.assert(selected.length<=30,'一笔订单最多 30 道菜');
    state.checkoutRequest=state.checkoutRequest||C.id();
    openModal('给主厨的小纸条','<form>'+selected.map(d=>'<div class="checkout-row"><span>'+esc(d.name)+'</span><span>× '+d.quantity+'</span></div>').join('')+'<label class="form-label" for="order-note">今天想被怎样照顾？</label><textarea class="field" id="order-note" name="note" maxlength="1000" placeholder="少放辣、不要香菜…"></textarea><p class="muted" style="margin-top:15px">订单会保存在'+(state.mode==='demo'?'本机演示中，不会发送到另一部手机':'云厨房中；本网页不自动发送微信通知')+'。</p><div class="actions"><button class="primary" type="submit" data-label="把期待交给你 · 确认下单">把期待交给你 · 确认下单</button></div></form>',async form=>{
      markBusy(true);try{const note=String(new FormData(form).get('note')||'');await action('create_order',{items:selected.map(d=>({id:d.id,quantity:d.quantity})),note,request_id:state.checkoutRequest});state.cart={};state.checkoutRequest=null;markBusy(false);closeModal();state.tab='orders';await refresh(false);const summary='今天想吃：'+selected.map(d=>d.name+' ×'+d.quantity).join('、')+(note?'\n小备注：'+note:'')+'\n'+(state.mode==='cloud'?'已经在我们的小厨房下单啦，记得来接单 ♡':'这是本机演示订单，还没有发到云端。');openModal('主厨，今天也拜托你啦','<p class="muted">'+(state.mode==='cloud'?'订单已保存。复制下面的小纸条，手动发到你们的微信聊天里。':'本机演示下单成功。启用云端后，另一部手机才能看到订单。')+'</p><div class="code-block">'+esc(summary).replace(/\n/g,'<br>')+'</div><button class="primary" data-action="copy-order">复制点菜小纸条</button>',null);window._lastOrderSummary=summary;}catch(e){markBusy(false);throw e;}
    });
  }
  function connect(initial={}){
    openModal('连接两个人的云厨房','<p class="muted">先按部署教程创建免费 Supabase 项目并执行数据库脚本。这里填写公钥和厨房口令，不需要邮箱密码。</p><form><label class="form-label" for="cloud-url">Supabase Project URL</label><input class="field" id="cloud-url" name="url" type="url" required placeholder="https://你的项目编号.supabase.co" value="'+esc(initial.url||connection.url)+'"><label class="form-label" for="cloud-public">publishable / anon 公钥</label><textarea class="field" id="cloud-public" name="publicKey" required spellcheck="false" placeholder="sb_publishable_… 或 anon 公钥">'+esc(initial.publicKey||connection.publicKey)+'</textarea><label class="form-label" for="cloud-access">你的厨房口令（主厨或品尝官）</label><input class="field" id="cloud-access" type="password" name="key" required autocomplete="off" spellcheck="false" autocapitalize="none" minlength="8" maxlength="8" pattern="[A-Za-z0-9]{8}" title="8 位字母或数字" placeholder="8 位厨房口令" value="'+esc(initial.key||'')+'"><div class="notice" style="margin-top:18px">口令相当于这间厨房的钥匙。主厨口令只给自己保存；另一半使用品尝官口令。演示数据不会自动迁入云端。</div><div class="actions"><button class="primary" type="submit" data-label="连接我的小厨房">连接我的小厨房</button></div></form>',async form=>{
      const cfg=validConnection(Object.fromEntries(new FormData(form)));markBusy(true);
      try{const snapshot=await cloud('snapshot',{revision:-1},cfg);store.write('lk-connection-v1',cfg);store.write('lk-mode-v1','cloud');connection=cfg;state.mode='cloud';state.role=snapshot.kitchen.role;state.data=snapshot;state.cart={};state.error='';markBusy(false);closeModal();render();toast('两个人的云厨房，准备好啦');}catch(e){markBusy(false);throw e;}
    });
  }
  async function copy(text){try{await navigator.clipboard.writeText(text);toast('已复制，去微信粘贴给 TA 吧');}catch{openModal('请长按复制','<p class="muted">浏览器未允许自动复制，请长按下面的文字复制。</p><div class="code-block">'+esc(text)+'</div>');}}
  function invite(){
    openModal('邀请另一半','<p class="muted">会生成一个包含品尝官访问口令的专属链接，请只发给你的另一半。重新生成会使旧口令失效，已加入的人也要使用新链接。</p><div class="actions"><button class="primary" data-action="generate-invite">生成新的邀请链接</button></div>');
  }
  async function generateInvite(){
    if(state.busy)return;markBusy(true);
    try{const result=await action('rotate_guest',{});const url=new URL(location.href);url.hash='invite='+encodeURIComponent(JSON.stringify({url:connection.url,publicKey:connection.publicKey,key:result.key}));markBusy(false);openModal('把专属链接发给 TA','<p class="muted">在另一部手机打开链接后，点击确认连接。链接含品尝官口令，请勿公开。</p><div class="code-block">'+esc(url.href)+'</div><button class="primary" data-action="copy-invite">复制邀请链接</button>');window._inviteUrl=url.href;}catch(e){markBusy(false);throw e;}
  }
  async function imageFile(file){
    C.assert(file&&file.type.startsWith('image/'),'请选择照片文件');C.assert(file.size<=20*1024*1024,'原图请小于 20MB');
    uploading=true;toast('正在压缩照片…');
    const submit=$('.modal button[type="submit"]');if(submit)submit.disabled=true;
    let objectUrl;
    try{
      const source=await new Promise((resolve,reject)=>{objectUrl=URL.createObjectURL(file);const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('这张照片无法读取，试试 JPG 或 PNG 格式'));image.src=objectUrl;});
      const canvas=document.createElement('canvas');let max=760,quality=.78,result='';
      for(let attempt=0;attempt<6;attempt++){const scale=Math.min(1,max/Math.max(source.width,source.height));canvas.width=Math.max(1,Math.round(source.width*scale));canvas.height=Math.max(1,Math.round(source.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0,canvas.width,canvas.height);result=canvas.toDataURL('image/jpeg',quality);if(result.length<=220000)break;max*=.82;quality-=.07;}
      C.assert(result.length<=220000,'这张照片压缩后仍然较大，请换一张');editorPhoto=result;$('#photo-preview').innerHTML='<img src="'+result+'" alt="已选择的菜品照片">';toast('照片准备好啦');
    }finally{uploading=false;if(objectUrl)URL.revokeObjectURL(objectUrl);if(submit)submit.disabled=false;}
  }
  function exportData(){const blob=new Blob([JSON.stringify({exported_at:new Date().toISOString(),mode:state.mode,...state.data},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='小厨房-菜谱与订单-'+new Date().toISOString().slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('备份包含当前菜单和最近 30 笔订单，请妥善保存');}
  async function handle(button){
    const {action:a,id,tab,role,delta,status,order,index}=button.dataset;
    if(a==='close')return closeModal();
    if(a==='tab'){state.tab=tab;render();window.scrollTo({top:0,behavior:'smooth'});return;}
    if(a==='refresh')return refresh(true);
    if(a==='edit')return edit(id);
    if(a==='detail'){const d=dishes().find(d=>d.id===id);if(d)recipe(d);return;}
    if(a==='order-recipe'){const d=orders().find(o=>o.id===order)?.items[Number(index)];if(d)recipe(d,true);return;}
    if(a==='quantity'){state.cart[id]=Math.min(20,Math.max(0,(state.cart[id]||0)+Number(delta)));state.checkoutRequest=null;$('#dish-grid').innerHTML=dishCards();$('#cart-slot').innerHTML=cartView();return;}
    if(a==='checkout')return checkout();
    if(a==='remove-photo'){editorPhoto='';$('#photo-preview').innerHTML=icon('photo')+'<span>拍一张，或选择菜品照片</span>';return;}
    if(a==='delete'){if(state.busy)return;if(confirm('删除这道菜？旧订单会保留当时的菜谱。'))return mutate('delete_dish',{id},'这道菜已从菜单移除');return;}
    if(a==='advance'){if(state.busy)return;return mutate('order_status',{id,status:status==='pending'?'cooking':'done'},status==='pending'?'开始做饭啦':'这一餐，准备开饭');}
    if(a==='role'){C.assert(state.mode==='demo','云厨房角色由口令决定');state.role=role;state.cart={};store.write('lk-role-v1',role);return refresh(false);}
    if(a==='connect')return connect();
    if(a==='invite')return invite();
    if(a==='generate-invite')return generateInvite();
    if(a==='copy-invite')return copy(window._inviteUrl);
    if(a==='copy-order')return copy(window._lastOrderSummary);
    if(a==='backup-key')return openModal('备份我的厨房口令','<p class="muted">清除浏览器数据或更换手机后，重新填写云端配置和下面的口令即可恢复访问。'+(chef()?'这是主厨口令，不要发给另一半。':'这是品尝官口令，请只自己保存。')+'</p><div class="code-block">'+esc(connection.key)+'</div><p class="muted">项目 URL：'+esc(connection.url)+'</p>');
    if(a==='disconnect'||a==='demo'){if(a==='disconnect'&&!confirm('返回本机演示？云端记录不会删除。请先备份口令。'))return;store.write('lk-mode-v1','demo');state.mode='demo';state.data=null;state.cart={};state.role=store.read('lk-role-v1','guest');state.error='';state.tab='menu';closeModal();return refresh(false);}
    if(a==='rename')return openModal('给厨房起个名字','<form><label class="form-label" for="kitchen-name">厨房名称</label><input class="field" id="kitchen-name" name="name" required maxlength="30" value="'+esc(state.data.kitchen.name)+'"><div class="actions"><button type="submit" class="primary" data-label="保存名字">保存名字</button></div></form>',async form=>mutate('rename',{name:new FormData(form).get('name')},'厨房换上新名字啦'));
    if(a==='export')return exportData();
    if(a==='wechat')return openModal('好好说话，也好好吃饭','<p class="muted">下单成功后点击「复制点菜小纸条」，切到微信，手动粘贴到你们的聊天里。<br><br>聊天、照片、文件和语音都直接用微信。本网页不会读取微信聊天，也不能自动选择联系人或发送消息。</p>');
    if(a==='install'){if(installPrompt){await installPrompt.prompt();installPrompt=null;}else openModal('把小厨房放到桌面','<ol class="steps"><li>先将网页部署到 HTTPS 网址。</li><li>iPhone 使用 Safari 的「分享 → 添加到主屏幕」。</li><li>安卓使用 Chrome / Edge 菜单的「添加到主屏幕」或「安装应用」。</li><li>微信里打不开安装菜单时，先用系统浏览器打开。</li></ol>');return;}
  }
  document.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(button){event.preventDefault();Promise.resolve().then(()=>handle(button)).catch(e=>toast(e.message));}});
  document.addEventListener('submit',event=>{if(!event.target.closest('.modal'))return;event.preventDefault();if(state.busy)return;if(modalHandler)Promise.resolve().then(()=>modalHandler(event.target)).catch(e=>{markBusy(false);toast(e.message);});});
  document.addEventListener('input',event=>{if(event.target.id==='search'){state.search=event.target.value;$('#dish-grid').innerHTML=dishCards();}});
  document.addEventListener('change',event=>{if(event.target.id==='photo-file'&&event.target.files[0])imageFile(event.target.files[0]).catch(e=>toast(e.message));});
  document.addEventListener('keydown',event=>{const modal=$('.modal');if(!modal)return;if(event.key==='Escape')closeModal();if(event.key==='Tab'){const elements=[...modal.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(n=>n.offsetParent!==null);if(!elements.length)return;const first=elements[0],last=elements.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===modal)){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.mode==='cloud')refresh(false);});
  window.addEventListener('online',()=>refresh(false));
  let incoming=null;
  if(location.hash.startsWith('#invite=')){try{incoming=validConnection(JSON.parse(decodeURIComponent(location.hash.slice(8))));}catch(e){toast('邀请链接无法识别：'+e.message);}history.replaceState(null,'',location.pathname+location.search);}
  render();refresh(false).then(()=>{if(incoming)connect(incoming);});
  timer=setInterval(()=>{if(!document.hidden&&state.mode==='cloud')refresh(false);},15000);
  if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol))navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();
