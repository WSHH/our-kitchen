/* Shared validation and local demo model; cloud authorization lives in database.sql. */
(function(root){
  'use strict';
  const STATUS={pending:'等待主厨接单',cooking:'主厨正在制作',done:'可以开饭啦'};
  const id=()=>{
    if(root.crypto.randomUUID)return root.crypto.randomUUID();
    // getRandomValues remains available on HTTP LAN previews on Android.
    const bytes=root.crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const hex=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  };
  const assert=(condition,message)=>{if(!condition)throw new Error(message);};
  function accessKey(value){
    const key=String(value??'').trim().toLowerCase();
    assert(/^[a-z0-9]{8}$/.test(key),'厨房口令应为 8 位字母或数字，请完整填写');
    return key;
  }
  function dish(input){
    const result={};
    for(const [key,max] of Object.entries({name:50,ingredients:2000,method:6000,note:1000})){
      result[key]=String(input[key]||'').trim();assert(result[key].length<=max,'内容过长，请精简后再保存');
    }
    assert(result.name,'请填写菜品名称');
    result.minutes=Number(input.minutes);assert(Number.isInteger(result.minutes)&&result.minutes>=1&&result.minutes<=1440,'制作时间请填写 1–1440 分钟');
    result.photo=String(input.photo||'');
    assert(!result.photo||(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(result.photo)&&result.photo.length<=220000),'照片格式无效或过大，请重新选择');
    return result;
  }
  const SEED=[
    {name:'番茄炖牛腩',minutes:70,ingredients:'牛腩 300g\n番茄 2 个\n土豆 1 个\n葱姜、盐、生抽适量',method:'1. 牛腩切块，冷水下锅焯去血沫。\n2. 番茄切块，一半炒出汤汁，加入牛腩。\n3. 加热水，小火炖约 50 分钟。\n4. 加入土豆和剩余番茄，再炖 15 分钟，调味。',note:'软软糯糯，汤汁拌饭刚刚好。',emoji:'🍅'},
    {name:'西兰花炒虾仁',minutes:20,ingredients:'虾仁 200g\n西兰花半颗\n蒜 2 瓣\n盐、黑胡椒适量',method:'1. 虾仁擦干，加少量盐和黑胡椒。\n2. 西兰花切小朵，焯水后沥干。\n3. 蒜末爆香，炒熟虾仁，加入西兰花翻炒调味。',note:'清清爽爽，是今天的小清新。含虾，海鲜过敏请勿食用。',emoji:'🥦'},
    {name:'金黄玉子烧',minutes:15,ingredients:'鸡蛋 3 个\n牛奶 20ml\n盐少许\n食用油适量',method:'1. 鸡蛋和牛奶打匀，加少量盐。\n2. 平底锅薄刷油，小火倒入薄薄一层蛋液。\n3. 将蛋皮卷起，继续加蛋液再卷，至蛋液用完。\n4. 确认熟透后切块。',note:'给平凡的一餐，加一点温柔。',emoji:'🍳'}
  ];
  function initial(){return {kitchen:{name:'我们的小厨房',revision:1},dishes:SEED.map(d=>({...d,id:id(),photo:'',updated_at:new Date().toISOString()})),orders:[]};}
  function createOrder(data,items,note,requestId){
    const old=data.orders.find(o=>o.request_id===requestId);if(old)return old;
    assert(Array.isArray(items)&&items.length>0&&items.length<=30,'请选择 1–30 道菜');
    const seen=new Set();
    const snapshot=items.map(i=>{
      assert(!seen.has(i.id),'不能重复添加同一道菜');seen.add(i.id);
      assert(Number.isInteger(i.quantity)&&i.quantity>=1&&i.quantity<=20,'每道菜最多选择 20 份');
      const found=data.dishes.find(d=>d.id===i.id);assert(found,'有菜品已下架，请刷新菜单');
      const {photo,emoji,...rest}=found;return {...rest,quantity:i.quantity};
    });
    assert(typeof note==='string'&&note.length<=1000,'备注不能超过 1000 字');
    const order={id:id(),request_id:requestId,items:snapshot,note,status:'pending',created_at:new Date().toISOString()};
    data.orders.unshift(order);data.kitchen.revision++;return order;
  }
  async function localAction(data,role,action,payload){
    const chef=role==='chef';
    if(action==='snapshot')return {...data,kitchen:{...data.kitchen,role}};
    if(['save_dish','delete_dish','order_status','rename'].includes(action))assert(chef,'只有主厨可以操作');
    if(action==='save_dish'){
      const valid=dish(payload);const old=data.dishes.find(d=>d.id===payload.id);
      if(payload.id)assert(old,'这道菜不存在');else assert(data.dishes.length<100,'菜单最多添加 100 道菜');
      const item={...valid,id:old?old.id:id(),updated_at:new Date().toISOString()};
      data.dishes=old?data.dishes.map(d=>d.id===old.id?item:d):[item,...data.dishes];data.kitchen.revision++;return {id:item.id};
    }
    if(action==='delete_dish'){assert(data.dishes.some(d=>d.id===payload.id),'菜品不存在');data.dishes=data.dishes.filter(d=>d.id!==payload.id);data.kitchen.revision++;return {};}
    if(action==='create_order'){assert(!chef,'切换到品尝官后再点菜');return createOrder(data,payload.items,payload.note,payload.request_id);}
    if(action==='order_status'){
      const order=data.orders.find(o=>o.id===payload.id);assert(order,'订单不存在');
      assert(({pending:'cooking',cooking:'done'})[order.status]===payload.status,'订单状态已变化，请刷新');
      order.status=payload.status;data.kitchen.revision++;return {};
    }
    if(action==='rename'){const name=String(payload.name||'').trim();assert(name&&name.length<=30,'厨房名请填写 1–30 字');data.kitchen.name=name;data.kitchen.revision++;return {};}
    throw new Error('本机演示不支持此操作');
  }
  const api={STATUS,id,assert,accessKey,dish,initial,createOrder,localAction};
  root.KitchenCore=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
