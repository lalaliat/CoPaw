/* Puzzle Workshop — dependency-free plugin UI. Uses only the host React + API. */
(() => {
  const ID = "puzzle-workshop";
  const host = window.QwenPaw?.host;
  if (!host?.React) return;
  const R = host.React;
  const NS = "http://www.w3.org/2000/svg";
  const colors = ["#cdbdf8", "#f9d48a", "#a9dcca", "#a8cef2", "#f0bdb7", "#d6dfa0"];
  const modules = [
    {id:"channels", name:"Channels", sub:"消息频道", icon:"↗", group:true, color:colors[0]},
    {id:"browser", name:"Browser", sub:"浏览器与网页", icon:"◎", color:colors[1]},
    {id:"memory", name:"Memory", sub:"记忆与检索", icon:"▤", color:colors[2]},
    {id:"skills", name:"Skills", sub:"文档与专业技能", icon:"✳", color:colors[3]},
    {id:"core", name:"QwenPaw", sub:"执行核心 · 始终连接", icon:"core", core:true, color:"#7861c7"},
    {id:"plugins", name:"Plugins", sub:"已安装的真实插件", icon:"✦", group:true, color:colors[4]},
    {id:"models", name:"Models", sub:"模型与推理", icon:"◈", color:colors[5]},
    {id:"schedule", name:"Schedule", sub:"定时任务", icon:"◷", color:colors[1]},
    {id:"agents", name:"Agents", sub:"协作与委派", icon:"⌘", color:colors[0]},
  ];
  const channels = ["钉钉", "飞书", "Discord", "Telegram", "Slack", "微信", "QQ", "邮件", "Console"].map((name,i) => ({id:"channel-"+i,name,sub:"频道拼图 · 仅演示",icon:["钉","飞","D","➤","#","微","Q","✉","▣"][i],color:colors[i%colors.length]}));
  const css = `
.pw-app{--ink:#252723;--muted:#92938b;--purple:#e56939;color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f0f0ea;border-radius:20px;min-height:calc(100vh - 96px);padding:30px 32px 22px;box-sizing:border-box;isolation:isolate;container-type:inline-size}
.pw-app *{box-sizing:border-box}.pw-app button{font:inherit;cursor:pointer;color:inherit}.pw-app button:disabled{cursor:default;opacity:.35}.pw-head{display:flex;justify-content:space-between;align-items:center;gap:15px}.pw-eyebrow{font-size:10px;font-weight:650;letter-spacing:2.8px;color:#7f8275}.pw-head h1{font-size:30px;letter-spacing:-1.2px;line-height:1.3;margin:10px 0 8px;font-weight:600}.pw-head p{margin:0;color:#85877d;font-size:12px}.pw-headmark{width:44px;height:44px;border:1px solid #d1d4c7;border-radius:50%;display:grid;place-items:center;font-size:22px;color:#6e7460}
.pw-toolbar{display:flex;justify-content:space-between;align-items:center;margin:26px 0 0;padding-top:17px;border-top:1px solid #daddd0;gap:12px;flex-wrap:wrap}.pw-breadcrumb{display:flex;gap:10px;align-items:center;font-size:12px}.pw-btn{border:1px solid #d6d9cd;border-radius:8px;background:transparent;padding:9px 16px;transition:all .18s}.pw-btn:hover{background:#e3e6da}.pw-btn:active{transform:scale(.97)}.pw-btn:focus-visible,.pw-piece:focus-visible{outline:2px solid #e56939;outline-offset:4px}.pw-btn.plain{border:0;padding:0;font-weight:600}.pw-btn.primary{background:#292d25;color:#f8faf3;border-color:#292d25}.pw-btn.primary:hover{background:#454c3c}.pw-legend{display:flex;gap:12px;font-size:10px;color:#85897d}.pw-dot{display:inline-block;width:5px;height:5px;border-radius:50%;background:#7e985f;margin-right:5px}.pw-dot.demo{background:#a8ab9d}
.pw-layout{display:flex;flex-direction:column;max-width:1060px;margin:auto}.pw-board{position:relative;min-width:0;background:radial-gradient(ellipse at 50% 48%,#e4e7d9,transparent 68%)}.pw-board svg{width:100%;max-height:660px;display:block;user-select:none;touch-action:pan-y;overflow:visible}.pw-boardcaption{position:absolute;left:0;top:20px;color:#a0a494;font:9px monospace;letter-spacing:1.5px}.pw-piece{cursor:grab;outline:none;touch-action:none}.pw-piece:active{cursor:grabbing}.pw-piece.core,.pw-piece.locked{cursor:default}.pw-piece .pw-shape{transition:filter .2s,stroke .2s}.pw-piece:hover .pw-shape{filter:url(#pw-hover)}.pw-piece.selected .pw-shape{stroke:#b6bcaa;stroke-width:1.7}.pw-piece.core.selected .pw-shape{stroke:#dc683f}.pw-piece text{pointer-events:none}.pw-label{font-weight:600;font-size:20px;letter-spacing:-.5px}.pw-sub{font-size:11px;opacity:.6}.pw-icon{font-size:28px;font-weight:400}.pw-tag{font:8px monospace;letter-spacing:1px}.pw-ghost{fill:#e0e3d8;stroke:#c6cbbd;stroke-width:1;stroke-dasharray:3 5}.pw-traytitle{font-size:11px;fill:#737b69}.pw-trayhint{font-size:10px;fill:#979f8f}
.pw-side{border-top:1px solid #daddd0}.pw-detail{display:grid;grid-template-columns:1fr auto;column-gap:20px;align-items:center;padding:19px 0;min-height:90px}.pw-detailicon,.pw-note{display:none}.pw-detail h2{font-size:17px;font-weight:550;margin:3px 0;grid-column:1;grid-row:2}.pw-detail p{font-size:11px;color:#8a8f81;margin:4px 0;max-width:620px;grid-column:1}.pw-status{font:9px monospace;letter-spacing:1px;color:#6e8758;grid-column:1;grid-row:1}.pw-status.demo{color:#9a9f91}.pw-detail .pw-btn{grid-column:2;grid-row:1 / span 4;align-self:center}.pw-detail .pw-btn + .pw-btn{grid-row:5}.pw-detail dl{display:flex;gap:10px;font-size:10px;margin:4px 0;grid-column:1}.pw-detail dd{margin:0 12px 0 0}.pw-detail dt{color:#959b8c}
.pw-savebar{display:flex;align-items:center;justify-content:space-between;gap:14px;border-top:1px solid #daddd0;padding-top:18px}.pw-savebar strong{font-size:12px;font-weight:500}.pw-savebar small{display:block;color:#989e8f;font-size:10px;margin-top:3px}.pw-actions{display:flex;gap:8px;flex-shrink:0}.pw-toast{border-left:2px solid #9ea98f;padding:8px 12px;margin-top:14px;color:#758166;font-size:11px;white-space:pre-wrap}.pw-toast.error{border-color:#d5785b;color:#a55035}.pw-pendinglist{font-size:10px;color:#777e6b;margin-top:5px}.pw-foot{margin-top:20px;font:9px monospace;letter-spacing:2px;color:#a2a895;display:flex;justify-content:space-between}.pw-refresh{margin-top:8px}.pw-empty{padding:80px;text-align:center;color:#969d89}
@container(max-width:500px){.pw-head h1{font-size:25px}.pw-headmark{display:none}.pw-detail p{max-width:260px}.pw-legend{font-size:9px}.pw-boardcaption{display:none}.pw-savebar{flex-wrap:wrap}.pw-actions{margin-left:auto}.pw-app{padding:22px}.pw-foot{font-size:8px;letter-spacing:1px}}
@media(prefers-reduced-motion:reduce){.pw-app *{animation:none!important;transition:none!important}}
`;
  function node(tag, attrs={}, text) {
    const el = document.createElement(tag);
    for (const [k,v] of Object.entries(attrs)) if(v!==undefined) el.setAttribute(k, v);
    if(text!==undefined) el.textContent=text;
    return el;
  }
  function svg(tag, attrs={}, text) {
    const el=document.createElementNS(NS,tag);
    for(const [k,v] of Object.entries(attrs)) el.setAttribute(k,v);
    if(text!==undefined) el.textContent=text;
    return el;
  }
  function shape(row,col,rows,cols) {
    return `M0 0 ${row===0?"H180":"H64 C64 0 64 18 82 18 C100 18 100 0 100 0 H180"} ${col===cols-1?"V140":"V48 C198 48 198 80 180 80 V140"} ${row===rows-1?"H0":"H100 C100 140 100 158 82 158 C64 158 64 140 64 140 H0"} ${col===0?"V0":"V80 C18 80 18 48 0 48 V0"} Z`;
  }
  async function api(path, options={}) {
    const token=host.getApiToken?.();
    const response=await fetch(host.getApiUrl("/puzzle-workshop"+path), {
      ...options, credentials:"same-origin",
      headers:{...(token?{Authorization:"Bearer "+token}:{}),...(options.body?{"Content-Type":"application/json"}:{}),...options.headers},
    });
    const data=await response.json();
    if(!response.ok) { const err=new Error(typeof data.detail==="string"?data.detail:(data.detail?.message||"请求失败"));err.detail=data.detail;throw err; }
    return data;
  }
  function mount(root) {
    const state={snapshot:null,draft:{},demo:new Set(),scene:"main",selected:"core",busy:false,message:"",error:false,applied:false};
    let alive=true, dragged=false, drag=null;
    root.className="pw-app";
    root.innerHTML=`<style>${css}</style><header class="pw-head"><div><div class="pw-eyebrow">QWENPAW — ASSEMBLY STUDIO</div><h1>自由组合，自成一体。</h1><p>拖动拆装 · 点击探索 · 保存生效</p></div><div class="pw-headmark" aria-hidden="true">↗</div></header><div class="pw-toolbar"><nav class="pw-breadcrumb" aria-label="拼图层级"></nav><div class="pw-legend"><span><i class="pw-dot"></i>真实插件 · 保存后生效</span><span><i class="pw-dot demo"></i>概念模块 · 仅动画</span></div></div><div class="pw-layout"><section class="pw-board" aria-label="可交互拼图"></section><aside class="pw-side"><section class="pw-detail"></section><section class="pw-note"><strong>小小的拆装说明书</strong><ol><li>点拼图查看，拖开就能拆下。</li><li>Channels 和 Plugins 可以展开。</li><li>拆下的拼图，随时可以拼回。</li><li>只有保存，才改变真实插件。</li></ol></section></aside></div><footer class="pw-savebar"><div class="pw-summary" aria-live="polite"></div><div class="pw-actions"><button class="pw-btn" data-action="reset">还原草稿</button><button class="pw-btn primary" data-action="save">保存更改</button></div></footer><div class="pw-message" aria-live="polite"></div><div class="pw-foot"><span>DESIGNED TO COME APART.</span><span>实验性拼图工坊 / 002</span></div>`;
    const $=s=>root.querySelector(s);
    const changes=()=>state.snapshot?state.snapshot.plugins.filter(p=>!p.locked && state.draft[p.id]!==p.enabled):[];
    const items=()=>state.scene==="channels"?channels:state.scene==="plugins"?(state.snapshot?.plugins||[]).map((p,i)=>({...p,real:true,sub:p.locked?"固定拼图":`v${p.version} · 已安装`,icon:p.id===ID?"✳":"✦",color:colors[i%colors.length]})):modules;
    const removed=p=>p.real?state.draft[p.id]===false:state.demo.has(p.id);
    const dirty=()=>changes().length>0;
    const tell=(text,error=false)=>{state.message=text;state.error=error;renderMessages();};
    function renderMessages(){const el=$(".pw-message");el.replaceChildren();if(state.message) el.append(node("div",{class:"pw-toast"+(state.error?" error":"")},state.message));}
    function renderSummary(){
      const rows=changes(), summary=$(".pw-summary");summary.replaceChildren();
      summary.append(node("strong",{},rows.length?`${rows.length} 块真实插件等待保存`:state.applied?"已保存到 QwenPaw":"没有待保存的更改"));
      summary.append(node("small",{},state.demo.size?`${state.demo.size} 块概念拼图已拆下 · 不会影响实际功能`:"真实插件仅在保存后生效"));
      if(rows.length) summary.append(node("div",{class:"pw-pendinglist"},rows.map(p=>(state.draft[p.id]?"接回 ":"拆下 ")+p.name).join(" · ")));
      const save=$("[data-action=save]");save.disabled=state.busy||!rows.length||state.applied;save.textContent=state.busy?"正在保存…":"保存更改";
      $("[data-action=reset]").disabled=state.busy||state.applied||(!rows.length&&!state.demo.size);
    }
    function renderDetail(){
      const p=items().find(p=>p.id===state.selected), el=$(".pw-detail");el.replaceChildren();
      if(!p){el.append(node("h2",{},"选择一块拼图"),node("p",{},"点击查看详情，拖动拆下或拼回。"));return;}
      el.append(node("div",{class:"pw-detailicon",style:`background:${p.color}`},p.core?"✳":p.icon),node("span",{class:"pw-status"+(!p.real?" demo":"")},p.core?"不可拆卸":p.real?"真实插件":"概念演示"),node("h2",{},p.name));
      const descriptions={core:"执行、上下文、工具调度。所有能力在这里连接。",channels:"一整块消息入口，也可以拆成钉钉、飞书等更小的频道拼图。现在只演示拆装，不改变频道设置。",plugins:"这里读取当前实例实际安装的插件。进入后拆下或接回拼图，点击保存才会真正启停。不会删除插件文件。",browser:"浏览、搜索、截图。这里先试试拆装动画，实际浏览能力不会受到影响。",memory:"长期记忆与检索的拆分设想；不会清理或修改你的记忆。",skills:"文档、表格和专业任务的能力包。当前只是架构示意。",schedule:"提醒、定时任务与时区管理。拆下拼图不会停掉已有任务。",models:"云端和本地模型的接入方式。当前不会修改模型配置。",agents:"多 Agent 协作与任务委派。这里仅演示可拆卸的形态。"};
      el.append(node("p",{},p.real?(p.description||"安装在当前 QwenPaw 实例中的插件。"):(descriptions[p.id]||"这是频道拆分的设想。拖动只改变页面拼图，不会断开真实频道。")));
      if(p.real){const dl=node("dl");for(const [k,v]of [["当前状态",p.enabled?"已启用":"已停用"],["保存后",state.draft[p.id]?"启用":"停用"],["版本",p.version]]) dl.append(node("dt",{},k),node("dd",{},v));el.append(dl);}
      if(p.group){const b=node("button",{class:"pw-btn", "data-action":"enter","data-id":p.id},p.id==="channels"?"展开 9 块频道拼图 ↗":`展开 ${state.snapshot?.plugins.length||0} 块插件拼图 ↗`);el.append(b);}
      if(!p.core && p.id!=="plugins"){
        const b=node("button",{class:"pw-btn primary","data-action":"toggle","data-id":p.id},removed(p)?"＋ 拼回原位":"↗ 拆下这块拼图");b.disabled=state.busy||state.applied||p.locked;el.append(b);
      }
      if(p.locked)el.append(node("p",{},p.reason));
      
    }
    function renderBoard(){
      const board=$(".pw-board"), old={};board.querySelectorAll(".pw-piece").forEach(el=>{old[el.dataset.id]=el.getAttribute("transform");});
      const list=items(),rows=Math.max(1,Math.ceil(list.length/3)), cols=3, offCount=list.filter(removed).length, trayY=rows*154+130, height=trayY+(offCount?Math.ceil(offCount/4)*112+45:10);
      const scene=svg("svg",{viewBox:`0 0 680 ${height}`,role:"group","aria-label":state.scene==="plugins"?"已安装插件拼图":state.scene==="channels"?"频道子拼图":"QwenPaw 架构拼图"});
      const defs=svg("defs");
      for(const [id,dy,blur,opacity] of [["pw-shadow",8,7,.13],["pw-hover",12,10,.23]]){const f=svg("filter",{id,x:"-40%",y:"-40%",width:"180%",height:"190%"});f.append(svg("feDropShadow",{dx:0,dy,stdDeviation:blur,"flood-color":"#515b3f","flood-opacity":opacity}));defs.append(f);}
      const grad=svg("linearGradient",{id:"pw-ceramic",x1:"0",y1:"0",x2:".3",y2:"1"});grad.append(svg("stop",{offset:"0%","stop-color":"#fffffb"}),svg("stop",{offset:"100%","stop-color":"#e8ebdf"}));defs.append(grad);
      const orange=svg("linearGradient",{id:"pw-core",x1:"0",y1:"0",x2:"1",y2:"1"});orange.append(svg("stop",{offset:"0%","stop-color":"#f99b69"}),svg("stop",{offset:"100%","stop-color":"#df653b"}));defs.append(orange);scene.append(defs);
      if(offCount)scene.append(svg("line",{x1:55,y1:trayY-15,x2:620,y2:trayY-15,stroke:"#ccd2c1","stroke-dasharray":"3 5"}),svg("text",{x:55,y:trayY+9,class:"pw-traytitle"},"已拆下 / 随时拼回"));
      let parked=0;
      for(let i=0;i<list.length;i++){
        const p=list[i],r=Math.floor(i/3),c=i%3,x=57+c*190,y=76+r*154,path=shape(r,c,rows,cols),off=removed(p);
        const placeholder=svg("g",{transform:`translate(${x} ${y})`});placeholder.append(svg("path",{d:path,class:"pw-ghost"}));if(off)placeholder.append(svg("text",{x:90,y:76,"text-anchor":"middle",fill:"#b9aec6","font-size":12},"等待拼回"));scene.append(placeholder);
        const tx=off?65+(parked%4)*148:x, ty=off?trayY+30+Math.floor(parked/4)*112:y, scale=off?.7:1;if(off)parked++;
        const transform=`translate(${tx} ${ty}) scale(${scale})`;
        const g=svg("g",{transform,class:"pw-piece"+(p.core?" core":"")+(p.locked?" locked":"")+(state.selected===p.id?" selected":""),tabindex:"0",role:"button","aria-label":`${p.name}，${p.real?"真实插件":"概念模块"}，${off?"已拆下":"已连接"}`,"aria-pressed":off?"false":"true","data-id":p.id});
        g.append(svg("path",{d:path,fill:p.core?"url(#pw-core)":"url(#pw-ceramic)",stroke:p.core?"#e88156":"#fcfff4","stroke-opacity":1,"stroke-width":1.5,filter:"url(#pw-shadow)",class:"pw-shape"}));
        if(p.core){
          const mark=svg("g",{transform:"translate(90 43) rotate(45)"});for(const [x,y] of [[-15,-15],[3,-15],[-15,3],[3,3]])mark.append(svg("rect",{x,y,width:12,height:12,rx:3,fill:"#fff5e7"}));g.append(mark);
        }else {g.append(svg("circle",{cx:90,cy:44,r:23,fill:"#edf0e6"}),svg("text",{x:90,y:54,"text-anchor":"middle",class:"pw-icon",fill:"#6b7957"},p.icon));}
        const name=p.name.length>19?p.name.slice(0,17)+"…":p.name;
        g.append(svg("text",{x:90,y:86,"text-anchor":"middle",class:"pw-label",fill:p.core?"#fff":"#363e2e",style:p.name.length>14?"font-size:14px":""},name),svg("text",{x:90,y:106,"text-anchor":"middle",class:"pw-sub",fill:p.core?"#fff1dd":"#727c66"},p.sub),svg("text",{x:154,y:26,"text-anchor":"end",class:"pw-tag",fill:p.core?"#fff4da":"#8b967e"},p.core?"CORE":p.real?"LIVE":p.group?"OPEN ↗":"DEMO"));
        scene.append(g);
        if(old[p.id]&&old[p.id]!==transform&&!window.matchMedia("(prefers-reduced-motion: reduce)").matches){
          // SVG transform interpolation via CSS animation, without rebuilding host UI.
          const asCSS=t=>t.replace(/translate\(([-.\d]+) ([-.\d]+)\)/,"translate($1px, $2px)");
          g.animate([{transform:asCSS(old[p.id]),opacity:.7},{transform:asCSS(transform),opacity:1}],{duration:620,easing:"cubic-bezier(.2,1.2,.3,1)"});
        }
      }
      if(!list.length)scene.append(svg("text",{x:340,y:170,"text-anchor":"middle",class:"pw-trayhint"},state.snapshot?"暂无已安装插件，请先从插件管理安装。":"正在读取插件…"));
      board.replaceChildren(node("span",{class:"pw-boardcaption"},state.scene==="main"?"01 / THE WHOLE PICTURE":state.scene==="channels"?"02 / CHANNELS":"03 / YOUR PLUGINS"),scene);
    }
    function renderNav(){const nav=$(".pw-breadcrumb");nav.replaceChildren(node("button",{class:"pw-btn plain","data-action":"home"},"整幅拼图"));if(state.scene!=="main")nav.append(node("span",{},"/"),node("span",{},state.scene==="channels"?"Channels · 频道":"Plugins · 已安装插件"));else nav.append(node("span",{style:"color:#aaa1b7;font-size:11px;font-weight:400"},"总览"));}
    function render(){if(!alive)return;renderNav();renderBoard();renderDetail();renderSummary();renderMessages();}
    function toggle(id){if(state.busy||state.applied)return;const p=items().find(x=>x.id===id);if(!p||p.core||p.locked||p.id==="plugins")return;state.selected=id;if(p.real)state.draft[id]=!state.draft[id];else if(state.demo.has(id))state.demo.delete(id);else state.demo.add(id);tell(p.real?"草稿已调整，保存后才会改变插件状态。":"只是拆装动画，实际功能保持原样。");render();}
    function enter(id){state.scene=id;state.selected=null;render();}
    async function load(){state.busy=true;renderSummary();try{const data=await api("/state");if(!alive)return;state.snapshot=data;state.draft=Object.fromEntries(data.plugins.map(p=>[p.id,p.enabled]));if(data.warnings.length)tell(data.warnings.join("\n"),true);}catch(e){if(alive)tell("读取失败："+e.message+"。请刷新页面重试。",true);}finally{state.busy=false;render();}}
    async function save(){const rows=changes();if(!rows.length||state.busy||state.applied)return;state.busy=true;renderDetail();renderSummary();try{const data=await api("/save",{method:"POST",body:JSON.stringify({revision:state.snapshot.revision,changes:Object.fromEntries(rows.map(p=>[p.id,state.draft[p.id]]))})});if(!alive)return;state.snapshot=data;state.draft=Object.fromEntries(data.plugins.map(p=>[p.id,p.enabled]));state.applied=true;tell("保存成功。正在刷新页面，应用插件界面的变化…");render();window.location.reload();}catch(e){if(!alive)return;let msg=e.message;if(e.detail?.rollback_errors?.length)msg+="\n部分回滚失败："+e.detail.rollback_errors.join("；");tell(msg+"\n请先刷新状态再调整，避免覆盖其他变更。",true);const box=$(".pw-message");const b=node("button",{class:"pw-btn pw-refresh","data-action":"reload"},"重新读取状态（丢弃草稿）");box.append(b);}finally{state.busy=false;if(alive){renderDetail();renderSummary();}}}
    const click=e=>{if(dragged){dragged=false;return;}const action=e.target.closest("[data-action]");if(action){const a=action.dataset.action;if(a==="save")save();if(a==="reset"&&!state.busy&&!state.applied){state.demo.clear();state.draft=Object.fromEntries((state.snapshot?.plugins||[]).map(p=>[p.id,p.enabled]));tell("已还原，未修改真实插件。");render();}if(a==="home"){state.scene="main";state.selected="core";render();}if(a==="enter")enter(action.dataset.id);if(a==="toggle")toggle(action.dataset.id);if(a==="reload")load();return;}const p=e.target.closest(".pw-piece");if(p){const item=items().find(x=>x.id===p.dataset.id);if(item?.group){enter(item.id);}else{state.selected=p.dataset.id;renderDetail();root.querySelectorAll(".pw-piece").forEach(el=>el.classList.toggle("selected",el===p));}}};
    const key=e=>{if(e.target.closest(".pw-piece")&&(e.key==="Enter"||e.key===" ")){e.preventDefault();e.target.dispatchEvent(new MouseEvent("click",{bubbles:true}));}};
    const down=e=>{if(e.button!==0||state.busy||state.applied)return;const el=e.target.closest(".pw-piece"),p=items().find(x=>x.id===el?.dataset.id);if(!p||p.core||p.locked||p.id==="plugins")return;drag={el,id:p.id,x:e.clientX,y:e.clientY,original:el.getAttribute("transform"),moved:false};el.setPointerCapture(e.pointerId);};
    const move=e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)<7&&!drag.moved)return;drag.moved=true;const scale=1/(drag.el.ownerSVGElement.getScreenCTM()?.a||1);drag.el.setAttribute("transform",`translate(${dx*scale} ${dy*scale}) ${drag.original}`);};
    const up=e=>{if(!drag)return;const d=drag;drag=null;try{d.el.releasePointerCapture(e.pointerId);}catch{}if(d.moved){d.el.setAttribute("transform",d.original);dragged=true;if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>35)toggle(d.id);else render();setTimeout(()=>{dragged=false;},0);}};
    const cancel=()=>{if(drag){drag.el.setAttribute("transform",drag.original);drag=null;}};
    const unload=e=>{if(dirty()){e.preventDefault();e.returnValue="";}};
    root.addEventListener("click",click);root.addEventListener("keydown",key);root.addEventListener("pointerdown",down);root.addEventListener("pointermove",move);root.addEventListener("pointerup",up);root.addEventListener("pointercancel",cancel);window.addEventListener("beforeunload",unload);
    render();load();
    return()=>{alive=false;root.removeEventListener("click",click);root.removeEventListener("keydown",key);root.removeEventListener("pointerdown",down);root.removeEventListener("pointermove",move);root.removeEventListener("pointerup",up);root.removeEventListener("pointercancel",cancel);window.removeEventListener("beforeunload",unload);};
  }
  function Page(){const ref=R.useRef(null);R.useEffect(()=>mount(ref.current),[]);return R.createElement("div",{ref});}
  window.QwenPaw.registerRoutes(ID,[{path:"/plugin/puzzle-workshop",component:Page,label:"拼图工坊",icon:"🧩",priority:45}]);
})();
