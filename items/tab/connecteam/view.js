import { api, el, confirmDialog, openPanelDialog } from "/static/js/api.js";
import { mountSessionChat } from "/static/js/sessionChat.js";

const ROOT = "/api/tab-connecteam";
const TABS = [["overview","Overview"],["schedule","Schedule"],["clock","Time clock"],["tasks","Tasks"],["people","People"],["forms","Forms"],["jobs","Jobs"],["settings","Settings"]];
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const eid = value => encodeURIComponent(String(value));
const name = value => [value.firstName, value.lastName].filter(Boolean).join(" ") || value.name || value.title || String(value.userId || value.id || "Unnamed");
const ident = value => value.id ?? value.userId ?? value.schedulerId ?? value.timeClockId ?? value.taskBoardId ?? value.conversationId ?? value.formId;
const dataOf = value => value?.data ?? value ?? {};
function rows(value, ...keys) {
  const data = dataOf(value);
  if (Array.isArray(data)) return data;
  for (const key of keys) if (Array.isArray(data[key])) return data[key];
  return [];
}
function dateKey(value, tz = zone) {
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(value);
  const pick = type => parts.find(p => p.type === type).value;
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}
function addDays(value, days) { const d = new Date(value+"T12:00:00Z"); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }
function epoch(value, tz) {
  const [d,t] = value.split("T"); if (!d || !t) throw new Error("Choose a date and time.");
  const [y,m,day] = d.split("-").map(Number), [h,min] = t.split(":").map(Number);
  const desired = Date.UTC(y,m-1,day,h,min); let guess = desired;
  const fmt = new Intl.DateTimeFormat("en-CA", {timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
  for (let i=0;i<4;i++) {
    const p = Object.fromEntries(fmt.formatToParts(guess).map(v => [v.type,v.value]));
    const diff = desired-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);
    if (!diff) return Math.floor(guess/1000);
    guess += diff;
  }
  throw new Error("This local time does not exist because of a daylight-saving change.");
}
function stamp(value) { return typeof value === "object" && value ? value.timestamp : value; }
function when(value, tz = zone) {
  const t=stamp(value); if (!t) return "In progress";
  const d = typeof t === "number" ? new Date(t*1000) : new Date(t);
  return Number.isNaN(+d) ? "Time unavailable" : d.toLocaleString([], {timeZone:tz,dateStyle:"medium",timeStyle:"short"});
}
function localTime(value,tz) {
  const p=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(value*1000).map(v=>[v.type,v.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function textValue(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(", ");
  if (typeof value === "object") return value.label || value.name || value.text || value.content || Object.entries(value).slice(0,8).map(([k,v])=>`${k}: ${textValue(v)}`).join(" · ");
  return String(value).replace(/<[^>]*>/g," ").trim();
}
function input(type="text",value="",attrs={}) { const x=el(type === "textarea" ? "textarea" : "input",{...(type==="textarea"?{rows:"4"}:{type}),...attrs});x.value=value??"";return x; }
function select(options,value,attrs={}) { const s=el("select",attrs); for (const [v,l] of options) s.append(el("option",{value:String(v),text:String(l)})); if(value!=null)s.value=String(value);return s; }
const field = (label,control,hint) => el("label",{class:"ce-field"},[el("span",{text:label}),control,...(hint?[el("small",{class:"meta",text:hint})]:[])]);
const badge = (text,tone="") => el("span",{class:`ce-badge ${tone}`,text});

export async function render(container) {
  let disposed=false, active="overview", generation=0, assistantGeneration=0, peopleCache=null, chatCleanup=null, sessionId=null, binding=null, integration=null, assistantOpen=true;
  const dialogs=new Set();
  container.replaceChildren();
  const root=el("div",{class:"view-constrained ce-view"});
  const notice=el("div",{class:"ce-notice meta",role:"status"});
  const nav=el("nav",{class:"ce-tabs segmented-tabs","aria-label":"Connecteam sections"});
  const content=el("section",{class:"ce-content"});
  const assistantBody=el("div",{class:"ce-assistant-chat"});
  const assistantState=el("div",{class:"meta ce-assistant-state"});
  const assistant=el("aside",{class:"card ce-assistant"},[
    el("div",{class:"ce-section-head"},[el("div",{},[el("h3",{text:"Connecteam assistant"}),el("div",{class:"meta",text:"Ask Kairos to work in Connecteam"})])]),assistantState,assistantBody]);
  const layout=el("div",{class:"ce-layout"},[content,assistant]);
  const assistantToggle=el("button",{class:"btn",text:"Hide assistant","aria-expanded":"true"});
  const refresh=el("button",{class:"btn quiet",text:"Refresh",onclick:()=>loadPage()});
  root.append(el("div",{class:"view-header"},[el("div",{},[el("h2",{text:"Connecteam"}),el("div",{class:"sub meta",text:"Your people, schedule and daily operations"})]),el("div",{class:"ce-actions"},[refresh,assistantToggle])]),nav,notice,layout);
  container.append(root);
  let settings;
  const live=page=>!disposed && page.isConnected;
  const report=err=>{if(!disposed)notice.textContent=err.message||String(err);};
  const guard=fn=>async event=>{try{await fn(event);}catch(error){report(error);}};
  const button=(text,fn,cls="btn")=>el("button",{type:"button",class:cls,text,onclick:guard(fn)});
  const read=async(path,query={})=>api(ROOT+"/request",{method:"POST",toast:false,body:JSON.stringify({method:"GET",path,query})});
  const write=async(method,path,body)=>api(ROOT+"/request",{method:"POST",toast:false,body:JSON.stringify({method,path,body,confirmed:true,delete_confirmation:method==="DELETE"?"DELETE":null})});
  const person=id=>{const p=(peopleCache||[]).find(x=>String(x.userId??x.id)===String(id));return p?name(p):`User ${id}`;};
  const people=async()=>{if(!peopleCache)peopleCache=rows(await read("/users/v1/users",{limit:500,offset:0}),"users");return peopleCache;};
  const userPicker=(list,chosen=[],multiple=true)=>{
    const s=select(multiple?list.map(x=>[x.userId??x.id,name(x)]):[["","Choose a person"],...list.map(x=>[x.userId??x.id,name(x)])],multiple?null:chosen[0],multiple?{multiple:true,size:"5"}:{});
    if(multiple)for(const o of s.options)o.selected=chosen.map(String).includes(o.value);
    return s;
  };
  const empty=(host,title,message)=>host.append(el("div",{class:"ce-empty"},[el("div",{class:"title",text:title}),el("p",{class:"meta",text:message})]));
  const fail=(host,error,retry)=>{if(!live(host))return;host.replaceChildren(el("div",{class:"ce-error",role:"alert"},[el("strong",{text:"Couldn't load this section"}),el("p",{text:error.message||String(error)}),button("Try again",retry)]));};
  const toolbar=(...nodes)=>el("div",{class:"ce-toolbar"},nodes);
  const table=(heads,items)=>el("div",{class:"ce-table-scroll"},[el("table",{class:"ce-table"},[el("thead",{},[el("tr",{},heads.map(text=>el("th",{scope:"col",text})))]),el("tbody",{},items.map(cells=>el("tr",{},cells.map(v=>el("td",{},[typeof v==="object"?v:String(v??"—")])))))])]);
  function form(title,controls,save,label="Save") {
    const body=el("form",{class:"ce-form"},controls), status=el("div",{class:"meta",role:"status"});body.append(status);
    let dialog;
    const submit=el("button",{class:"btn primary",text:label,type:"button",onclick:()=>body.requestSubmit()});
    dialog=openPanelDialog({title,body,footer:el("div",{class:"ce-actions"},[button("Cancel",()=>dialog.close(),"btn quiet"),submit]),onClose:()=>dialogs.delete(dialog)});
    dialogs.add(dialog);
    body.onsubmit=async e=>{e.preventDefault();submit.disabled=true;status.textContent="Saving…";try{await save();if(!disposed)dialog.close();}catch(error){status.textContent=error.message||String(error);}finally{submit.disabled=false;}};
  }
  function showDetails(title,item) {
    const dl=el("dl",{class:"ce-details"});
    Object.entries(item).filter(([k,v])=>v!=null&&v!==""&&!/^(color|image|avatar|url)/i.test(k)).forEach(([k,v])=>dl.append(el("dt",{text:k.replace(/([A-Z])/g," $1")}),el("dd",{text:textValue(v)})));
    let dialog;dialog=openPanelDialog({title,body:dl,onClose:()=>dialogs.delete(dialog)});dialogs.add(dialog);
  }
  async function remove(label,path,refreshFn) {
    if(!await confirmDialog({title:`Delete ${label}?`,message:"This removes the record from Connecteam. Review the selected record before confirming.",confirmLabel:"Delete"}))return;
    await write("DELETE",path);await refreshFn();
  }
  function drawNav(){nav.replaceChildren(...TABS.map(([id,label])=>{const b=button(label,()=>{active=id;drawNav();return loadPage();},`btn ${active===id?"primary":"quiet"}`);b.setAttribute("aria-current",active===id?"page":"false");return b;}));}
  assistantToggle.onclick=()=>{assistantOpen=!assistantOpen;assistant.hidden=!assistantOpen;layout.classList.toggle("ce-single",!assistantOpen);assistantToggle.textContent=assistantOpen?"Hide assistant":"Show assistant";assistantToggle.setAttribute("aria-expanded",String(assistantOpen));};

  async function mountAssistant() {
    const ticket=++assistantGeneration;
    chatCleanup?.();chatCleanup=null;
    assistantBody.replaceChildren();assistantState.textContent="Checking Connecteam tools…";
    try {
      binding=await api(ROOT+"/assistant/setup");
      const connections=await api("/api/integrations");
      if(disposed||ticket!==assistantGeneration)return;
      integration=connections.find(i=>i.id===binding.integration_id&&i.kind==="mcp_server");
      if(!binding.binding_current||!integration||integration.status?.state!=="working"||integration.held_tools?.length) {
        assistantState.textContent=integration?.held_tools?.length?"Connecteam tools need review in Tool Store → Tools.":"Connect the assistant in Settings to enable Connecteam actions.";
        assistantBody.append(button("Set up Connecteam assistant",()=>{active="settings";drawNav();return loadPage();},"btn primary"));return;
      }
      const chat=await api(ROOT+"/assistant",{method:"POST",body:"{}",toast:false});sessionId=chat.session_id;
      const session=await api(`/api/sessions/${sessionId}`);
      if(JSON.stringify(session.enabled_integration_ids)!==JSON.stringify([integration.id]))await api(`/api/sessions/${sessionId}/integrations`,{method:"POST",body:JSON.stringify({enabled_integration_ids:[integration.id]}),toast:false});
      if(disposed||ticket!==assistantGeneration)return;
      assistantState.textContent=`Connected · ${integration.name}`;
      const cleanup=await mountSessionChat(assistantBody,{sessionId,modelPicker:true,openInChats:true,title:"Connecteam assistant",placeholder:"Ask Kairos to manage Connecteam…",emptyTitle:"Work with Connecteam",emptyText:"Try: show my shifts this week, create a draft shift, or check time-off requests.",onTurnEnd:()=>{if(!disposed)notice.replaceChildren(el("span",{text:"Assistant finished. "}),button("Refresh Connecteam data",loadPage,"btn quiet"));}});
      if(disposed||ticket!==assistantGeneration)cleanup?.();else chatCleanup=cleanup;
    }catch(error){if(!disposed){assistantState.textContent=error.message;assistantBody.append(button("Retry assistant",mountAssistant));}}
  }

  async function overview(page) {
    const defs=[["Account","/me",null],["People loaded","/users/v1/users","users"],["Schedules","/scheduler/v1/schedulers","schedulers"],["Time clocks","/time-clock/v1/time-clocks","timeClocks"]];
    const results=await Promise.allSettled(defs.map(x=>read(x[1],x[2]==="users"?{limit:100,offset:0}:{})));if(!live(page))return;
    page.replaceChildren(el("div",{class:"ce-stats"},defs.map(([label,,key],i)=>{
      const result=results[i];const d=result.status==="fulfilled"?dataOf(result.value):null;
      return el("div",{class:"card ce-stat"},[el("span",{class:"meta",text:label}),el("strong",{text:d?(key?String(rows(d,key).length):d.companyName||d.name||"Connected"):"Unavailable"}),el("small",{class:"meta",text:result.status==="rejected"?result.reason.message:key==="users"?"First 100 users · browse People for more":"Live Connecteam data"})]);
    })));
    const shortcuts=el("div",{class:"ce-shortcuts"});
    for(const [id,label,desc] of [["schedule","Plan your week","View, create and edit shifts"],["clock","Track attendance","Review time activities and clocking"],["tasks","Keep work moving","Assign tasks and update completion"]]) {
      const shortcut=button("",()=>{active=id;drawNav();return loadPage();},"card ce-shortcut");
      shortcut.append(el("strong",{text:label}),el("span",{class:"meta",text:desc}));shortcuts.append(shortcut);
    }
    page.append(el("h3",{text:"Your workspace"}),shortcuts);
  }

  async function schedule(page) {
    const schedulers=rows(await read("/scheduler/v1/schedulers"),"schedulers").filter(x=>!x.isArchived);if(!live(page))return;
    page.replaceChildren();if(!schedulers.length){empty(page,"No schedules available","Create a schedule in Connecteam or check this API key's permissions.");return;}
    try{await people();}catch{page.append(el("p",{class:"meta",text:"User names could not load; shifts will show assigned user IDs."}));}
    const choose=select(schedulers.map(x=>[x.schedulerId??x.id,x.name]));
    const today=dateKey(new Date());const dow=new Date(today+"T12:00Z").getUTCDay();const day=input("date",addDays(today,-((dow+6)%7)),{"aria-label":"Week starting"});
    const calendar=el("div",{class:"ce-week-scroll"});let sequence=0;
    const selected=()=>schedulers.find(x=>String(x.schedulerId??x.id)===choose.value);
    async function editShift(shift=null) {
      let users;try{users=await people();}catch(error){throw new Error("Load the People list before assigning shifts. "+error.message);}
      const tz=selected().timezone||zone;
      const title=input("text",shift?.title||"",{required:true,maxlength:128});
      const start=input("datetime-local",shift?localTime(shift.startTime,tz):`${day.value}T09:00`,{required:true});
      const end=input("datetime-local",shift?localTime(shift.endTime,tz):`${day.value}T17:00`,{required:true});
      const assigned=userPicker(users,shift?.assignedUserIds||[]);
      const publish=input("checkbox");publish.checked=shift?.isPublished||false;
      const open=input("checkbox");open.checked=shift?.isOpenShift||false;
      const job=input("text",shift?.jobId||"");
      form(shift?"Edit shift":"Create shift",[field("Title",title),el("div",{class:"ce-pair"},[field(`Starts (${tz})`,start),field(`Ends (${tz})`,end)]),field("Assigned people",assigned,"Select multiple people with Ctrl/Command. Open shifts have no assignees."),field("Job ID (optional)",job),field("Open shift",open),field("Publish to employees",publish)],async()=>{
        const startTime=epoch(start.value,tz),endTime=epoch(end.value,tz);if(endTime<=startTime)throw new Error("The shift must end after it starts.");
        const payload={title:title.value.trim(),startTime,endTime,timezone:tz,assignedUserIds:open.checked?[]:[...assigned.selectedOptions].map(x=>Number(x.value)),isOpenShift:open.checked,isPublished:publish.checked};
        if(job.value.trim())payload.jobId=job.value.trim();if(shift)payload.id=shift.id;
        await write(shift?"PUT":"POST",`/scheduler/v1/schedulers/${eid(choose.value)}/shifts`,[payload]);await load();
      },shift?"Save shift":"Create shift");
    }
    const controls=toolbar(field("Schedule",choose),button("Previous week",async()=>{day.value=addDays(day.value,-7);await load();},"btn quiet"),field("Week starting",day),button("Next week",async()=>{day.value=addDays(day.value,7);await load();},"btn quiet"),button("Create shift",()=>editShift(),"btn primary"));
    page.append(controls,calendar);
    const load=async()=>{
      const ticket=++sequence;calendar.replaceChildren(el("p",{class:"meta",text:"Loading shifts…"}));
      try{
        const tz=selected().timezone||zone;
        const shifts=rows(await read(`/scheduler/v1/schedulers/${eid(choose.value)}/shifts`,{startTime:epoch(day.value+"T00:00",tz),endTime:epoch(addDays(day.value,7)+"T00:00",tz)-1,limit:100,offset:0}),"shifts");
        if(!live(page)||ticket!==sequence)return;
        const week=el("div",{class:"ce-week"});
        for(let i=0;i<7;i++){
          const key=addDays(day.value,i);const col=el("section",{class:`ce-day ${key===today?"ce-today":""}`},[el("h4",{text:new Date(key+"T12:00Z").toLocaleDateString([],{timeZone:"UTC",weekday:"short",month:"short",day:"numeric"})})]);
          const onDay=shifts.filter(s=>s.startTime&&s.endTime&&s.startTime<epoch(addDays(key,1)+"T00:00",tz)&&s.endTime>epoch(key+"T00:00",tz));
          for(const s of onDay){const row=el("article",{class:"ce-shift"},[button(s.title||"Shift",()=>editShift(s),"btn quiet ce-shift-title"),el("div",{class:"meta",text:`${when(s.startTime,tz)} – ${when(s.endTime,tz)}`}),el("p",{text:s.isOpenShift?"Open shift":(s.assignedUserIds||[]).map(person).join(", ")||"Unassigned"}),badge(s.isPublished?"Published":"Draft"),button("Delete",()=>remove(s.title||"shift",`/scheduler/v1/schedulers/${eid(choose.value)}/shifts/${eid(s.id)}`,load),"btn quiet ce-danger")]);col.append(row);}
          if(!onDay.length)col.append(el("span",{class:"meta ce-day-empty",text:"No shifts"}));week.append(col);
        }
        calendar.replaceChildren(el("div",{class:"meta ce-section-meta",text:`Times shown in ${tz}. ${shifts.length} shifts loaded${shifts.length===100?"; narrow the date range to see fewer records":""}.`}),week);
      }catch(error){if(ticket===sequence)fail(calendar,error,load);}
    };choose.onchange=guard(load);day.onchange=guard(load);await load();
  }

  async function clock(page) {
    const clocks=rows(await read("/time-clock/v1/time-clocks"),"timeClocks").filter(x=>!x.isArchived);if(!live(page))return;page.replaceChildren();
    if(!clocks.length){empty(page,"No time clocks available","Check Connecteam time-clock access for this key.");return;}
    try{await people();}catch{/* IDs remain useful when directory access is denied. */}
    const choose=select(clocks.map(x=>[x.id??x.timeClockId,x.name]));const start=input("date",dateKey(new Date()));const end=input("date",dateKey(new Date()));const records=el("div");let sequence=0;
    async function punch(action){
      const list=await people(),user=userPicker(list,[],false),job=input("text",""),tz=input("text",zone,{required:true});
      form(action==="clock-in"?"Clock in a person":"Clock out a person",[field("Person",user),...(action==="clock-in"?[field("Job ID",job,"Required when this time clock enforces job assignments.")]:[]),field("Timezone",tz),el("p",{class:"meta",text:"This records a live attendance event in Connecteam."})],async()=>{
        if(!user.value)throw new Error("Choose a person.");const payload={userId:Number(user.value),timezone:tz.value};if(action==="clock-in"&&job.value.trim())payload.jobId=job.value.trim();
        await write("POST",`/time-clock/v1/time-clocks/${eid(choose.value)}/${action}`,payload);await load();
      },action==="clock-in"?"Clock in":"Clock out");
    }
    const load=async()=>{
      const ticket=++sequence;records.replaceChildren(el("p",{class:"meta",text:"Loading time activities…"}));
      try{if(!start.value||!end.value||end.value<start.value)throw new Error("Choose a valid date range.");
        const groups=rows(await read(`/time-clock/v1/time-clocks/${eid(choose.value)}/time-activities`,{startDate:start.value,endDate:end.value}),"timeActivitiesByUsers","timeActivities","users","activities");
        if(!live(page)||ticket!==sequence)return;const flattened=[];
        for(const g of groups){let found=false;for(const [key,label] of [["shifts","Work"],["manualBreaks","Break"],["timeOffs","Time off"]])for(const activity of g[key]||[]){found=true;flattened.push([person(g.userId),label,when(activity.start??activity.startTime),when(activity.end??activity.endTime),activity.jobId||"—"]);}if(!found)flattened.push([person(g.userId),g.type||"Activity",when(g.start??g.startTime),when(g.end??g.endTime),g.jobId||"—"]);}
        records.replaceChildren();if(!flattened.length)empty(records,"No time activities","Choose another time clock or date range.");else records.append(table(["Person","Activity","Started","Ended","Job"],flattened));
      }catch(error){if(ticket===sequence)fail(records,error,load);}
    };
    page.append(toolbar(field("Time clock",choose),field("From",start),field("Through",end),button("Clock in",()=>punch("clock-in"),"btn primary"),button("Clock out",()=>punch("clock-out"))),records);choose.onchange=guard(load);start.onchange=guard(load);end.onchange=guard(load);await load();
  }

  async function tasks(page){
    const boards=rows(await read("/tasks/v1/taskboards"),"taskBoards","taskboards");if(!live(page))return;page.replaceChildren();if(!boards.length){empty(page,"No task boards","Create a board in Connecteam or check task permissions.");return;}
    const choose=select(boards.map(x=>[x.id??x.taskBoardId,x.name||x.title]));const host=el("div");let sequence=0;
    async function createTask(){const list=await people(),title=input("text","",{required:true,maxlength:200}),assigned=userPicker(list),status=select([["draft","Draft"],["published","Published"]],"draft"),due=input("datetime-local",""),description=input("textarea");
      form("Create task",[field("Title",title),field("Assign people",assigned),field("Status",status),field(`Due (${zone})`,due),field("Description",description)],async()=>{
        const userIds=[...assigned.selectedOptions].map(o=>Number(o.value));if(status.value==="published"&&!userIds.length)throw new Error("Published tasks need at least one assignee.");
        const payload={title:title.value.trim(),userIds,status:status.value};if(due.value)payload.dueDate=epoch(due.value,zone);if(description.value.trim())payload.description={content:description.value.trim()};
        await write("POST",`/tasks/v1/taskboards/${eid(choose.value)}/tasks`,payload);await load();
      },"Create task");}
    const load=async()=>{const ticket=++sequence;host.replaceChildren(el("p",{class:"meta",text:"Loading tasks…"}));try{
      const items=rows(await read(`/tasks/v1/taskboards/${eid(choose.value)}/tasks`,{limit:100,offset:0}),"tasks");if(!live(page)||ticket!==sequence)return;host.replaceChildren();if(!items.length){empty(host,"No tasks on this board","Create a task to get started.");return;}
      const grid=el("div",{class:"ce-task-board"});for(const [state,label]of [["draft","Drafts"],["published","To do"],["completed","Completed"]]){
        const group=items.filter(t=>t.status===state);const col=el("section",{class:"ce-task-column"},[el("h4",{text:`${label} · ${group.length}`})]);
        for(const task of group){const actions=el("div",{class:"ce-actions"},[button("Details",()=>showDetails(task.title,task),"btn quiet"),button("Delete",()=>remove(task.title,`/tasks/v1/taskboards/${eid(choose.value)}/tasks/${eid(task.id)}`,load),"btn quiet ce-danger")]);if(state!=="completed")actions.prepend(button("Mark complete",async()=>{await write("PUT",`/tasks/v1/taskboards/${eid(choose.value)}/tasks/${eid(task.id)}`,{title:task.title,userIds:task.userIds||[],status:"completed"});await load();},"btn quiet"));col.append(el("article",{class:"card ce-task"},[el("strong",{text:task.title}),el("p",{class:"meta",text:(task.userIds||[]).map(person).join(", ")||"Unassigned"}),el("p",{class:"meta",text:task.dueDate?`Due ${when(task.dueDate)}`:"No due date"}),actions]));}grid.append(col);
      }host.append(grid);
    }catch(error){if(ticket===sequence)fail(host,error,load);}};
    page.append(toolbar(field("Task board",choose),button("Create task",createTask,"btn primary")),host);choose.onchange=guard(load);await load();
  }

  async function directory(page){
    const search=input("search","",{placeholder:"Search people in this list…","aria-label":"Search people"}),status=select([["active","Active"],["archived","Archived"]],"active"),host=el("div");let all=[],offset=0,sequence=0;
    const more=button("Load more people",()=>load(false));
    function paint(){host.replaceChildren();const q=search.value.toLowerCase(),filtered=all.filter(p=>(name(p)+" "+(p.phoneNumber||"")+" "+(p.email||"")).toLowerCase().includes(q));if(!filtered.length)empty(host,"No matching people","Try another search or change the user status.");else host.append(table(["Person","Phone","Email","Role",""],filtered.map(p=>[name(p),p.phoneNumber,p.email,p.isAdmin?"Admin":"Employee",button("Details",()=>showDetails(name(p),p),"btn quiet")])));}
    const load=async(reset=true)=>{const ticket=++sequence;more.disabled=true;try{if(reset){offset=0;all=[];host.replaceChildren(el("p",{class:"meta",text:"Loading people…"}));}const batch=rows(await read("/users/v1/users",{limit:100,offset,userStatus:status.value}),"users");if(!live(page)||ticket!==sequence)return;all.push(...batch);offset+=batch.length;if(status.value==="active")peopleCache=all;paint();more.hidden=batch.length<100;}catch(error){if(ticket===sequence)fail(host,error,()=>load(true));}finally{more.disabled=false;}};
    page.replaceChildren(toolbar(search,field("Status",status)),host,more);search.oninput=paint;status.onchange=guard(()=>load(true));await load();
  }

  async function forms(page){
    const list=rows(await read("/forms/v1/forms",{limit:100,offset:0}),"forms");if(!live(page))return;page.replaceChildren();if(!list.length){empty(page,"No forms available","Check form permissions or create a form in Connecteam.");return;}
    const choose=select(list.map(x=>[ident(x),x.name||x.title||`Form ${ident(x)}`]));const start=input("date",addDays(dateKey(new Date()),-30)),end=input("date",dateKey(new Date()));const host=el("div");let sequence=0;
    const load=async()=>{const ticket=++sequence;host.replaceChildren(el("p",{class:"meta",text:"Loading submissions…"}));try{const items=rows(await read(`/forms/v1/forms/${eid(choose.value)}/form-submissions`,{submittingStartTimestamp:epoch(start.value+"T00:00",zone),submittingEndTime:epoch(addDays(end.value,1)+"T00:00",zone)-1,limit:100,offset:0}),"formSubmissions","submissions");if(!live(page)||ticket!==sequence)return;host.replaceChildren();if(!items.length)empty(host,"No submissions in this range","Choose another form or date range.");else host.append(table(["Submission","Employee","Submitted",""],items.map(x=>[x.id??x.formSubmissionId,person(x.submittingUserId??x.userId),when(x.createdAt??x.submissionTimestamp??x.submittedAt),button("View answers",()=>showDetails("Form submission",x),"btn quiet")])));}catch(error){if(ticket===sequence)fail(host,error,load);}};
    page.append(toolbar(field("Form",choose),field("From",start),field("Through",end),button("Form definition",async()=>showDetails("Form definition",dataOf(await read(`/forms/v1/forms/${eid(choose.value)}`))),"btn quiet")),host);choose.onchange=guard(load);start.onchange=guard(load);end.onchange=guard(load);await load();
  }

  async function jobs(page){const items=rows(await read("/jobs/v1/jobs",{limit:100,offset:0,includeDeleted:false}),"jobs");if(!live(page))return;page.replaceChildren();if(!items.length)empty(page,"No jobs available","Jobs can be managed using the assistant or in Connecteam.");else page.append(table(["Job","Code","Description",""],items.map(j=>[j.title||j.name,j.code,textValue(j.description),button("Details",()=>showDetails(j.title||"Job",j),"btn quiet")])));}

  async function connection(page){
    settings=await api(ROOT+"/settings");const setup=await api(ROOT+"/assistant/setup");const connections=await api("/api/integrations");if(!live(page))return;page.replaceChildren();
    const key=input("password","",{autocomplete:"new-password",placeholder:settings.configured?"Saved; leave blank to keep":"Enter Connecteam API key"}),region=select([["global","Global"],["au","Australia"]],settings.region),status=el("div",{class:"meta",role:"status"});
    const candidates=connections.filter(x=>x.kind==="mcp_server");const current=select([["","Select a connected MCP"],...candidates.map(x=>[x.id,x.name])],setup.integration_id);
    const save=button("Save connection",async()=>{save.disabled=true;try{settings=await api(ROOT+"/settings",{method:"PUT",toast:false,body:JSON.stringify({api_key:key.value,region:region.value})});key.value="";status.textContent="Connection saved. Refresh a section to load Connecteam data.";await mountAssistant();}finally{save.disabled=false;}},"btn primary");
    const enable=button("Save & enable assistant",async()=>{
      if(!key.value.trim())throw new Error("Enter your API key once to give the Connecteam MCP its own encrypted connection. The saved tab key is never returned to the browser.");
      enable.disabled=true;status.textContent="Saving connection and checking MCP tools…";
      try{
        const secret=key.value.trim();settings=await api(ROOT+"/settings",{method:"PUT",toast:false,body:JSON.stringify({api_key:secret,region:region.value})});
        const config=await api(ROOT+"/assistant/setup");
        const item=await api("/api/integrations/mcp-server",{method:"POST",toast:false,body:JSON.stringify({name:config.name,mcp_type:"stdio",command:config.command,args:config.args,api_key:secret})});
        if(item.status?.state!=="working"){
          await api(`/api/integrations/${eid(item.id)}`,{method:"DELETE",toast:false});
          throw new Error(`Connecteam MCP could not start: ${item.status?.detail||item.status?.message||item.status?.state||"check failed"}`);
        }
        await api(ROOT+"/assistant/binding",{method:"PUT",toast:false,body:JSON.stringify({integration_id:item.id,managed:true})});key.value="";
        const previous=connections.find(x=>x.id===setup.integration_id);
        if(setup.managed&&previous?.args?.[0]===config.args[0]&&previous.id!==item.id)await api(`/api/integrations/${eid(previous.id)}`,{method:"DELETE",toast:false});
        status.textContent=item.status?.state==="working"?"Connecteam MCP connected. Choose a model in the assistant panel.":`MCP saved. Check Tool Store → Tools: ${item.status?.detail||item.status?.message||item.status?.state||"connection check pending"}`;
        await mountAssistant();notice.textContent="Connecteam assistant connected.";await loadPage();
      }catch(error){await mountAssistant();throw error;}finally{enable.disabled=false;}
    },"btn primary");
    const bind=button("Use selected MCP",async()=>{if(!current.value)throw new Error("Choose a Connecteam MCP connection.");await api(`/api/integrations/${eid(current.value)}/check`,{method:"POST",body:"{}",toast:false});await api(ROOT+"/assistant/binding",{method:"PUT",toast:false,body:JSON.stringify({integration_id:current.value,managed:current.value===setup.integration_id&&setup.managed})});await mountAssistant();status.textContent="Assistant connection selected. Held tools must be reviewed in Tool Store.";});
    const disconnect=button("Disconnect",async()=>{if(!await confirmDialog({title:"Disconnect Connecteam?",message:"Remove this tab's key and its managed MCP connection. Connecteam account data is kept.",confirmLabel:"Disconnect"}))return;
      if(setup.managed&&setup.integration_id)await api(`/api/integrations/${eid(setup.integration_id)}`,{method:"DELETE",toast:false});
      if(sessionId)await api(`/api/sessions/${eid(sessionId)}/integrations`,{method:"POST",body:JSON.stringify({enabled_integration_ids:[]}),toast:false});
      settings=await api(ROOT+"/settings",{method:"DELETE",toast:false});key.value="";await mountAssistant();await loadPage();},"btn quiet ce-danger");
    page.append(el("section",{class:"card ce-settings"},[el("h3",{text:"Connecteam connection"}),el("p",{class:"meta",text:"API credentials are encrypted. Choose the region where your Connecteam company is hosted."}),field("API key",key),field("Region",region),toolbar(save,button("Test connection",async()=>{const account=dataOf(await api(ROOT+"/account"));status.textContent=`Connected${account.companyName?` to ${account.companyName}`:""}.`;}),...(settings.configured?[disconnect]:[])),status]),el("section",{class:"card ce-settings"},[el("h3",{text:"Assistant tools"}),el("p",{class:"meta",text:"Enable the bundled Connecteam MCP using the key above, or select an existing Connecteam MCP. This chat uses only the selected connection. Models and permissions use Kairos's normal chat controls."}),enable,field("Existing Connecteam MCP",current),bind]));
    const advanced=el("details",{class:"disclosure-panel ce-advanced"},[el("summary",{text:"Advanced API access"})]);
    const method=select(["GET","POST","PUT","PATCH","DELETE"].map(v=>[v,v])),path=input("text","/me"),query=input("textarea","{}"),body=input("textarea",""),output=el("pre",{class:"ce-api-result"});
    advanced.append(field("Method",method),field("API path",path),field("Query JSON",query),field("Body JSON",body),button("Run request",async()=>{
      const q=JSON.parse(query.value||"{}");let result;if(method.value==="GET")result=await read(path.value.trim(),q);else{if(!await confirmDialog({title:`Run ${method.value} request?`,message:`${path.value}\n${body.value}`,confirmLabel:"Run request",danger:method.value==="DELETE"}))return;result=await api(ROOT+"/request",{method:"POST",toast:false,body:JSON.stringify({method:method.value,path:path.value.trim(),query:q,body:body.value.trim()?JSON.parse(body.value):null,confirmed:true,delete_confirmation:method.value==="DELETE"?"DELETE":null})});}output.textContent=JSON.stringify(result,null,2);
    }),output);page.append(advanced);
  }

  const renderers={overview,schedule,clock,tasks,people:directory,forms,jobs,settings:connection};
  async function loadPage(){const ticket=++generation;const page=el("div",{class:"ce-page"},[el("p",{class:"meta",text:"Loading Connecteam…"})]);content.replaceChildren(page);refresh.disabled=true;notice.textContent="";try{if(!settings.configured&&active!=="settings"){page.replaceChildren(el("div",{class:"card ce-feature-note"},[el("h3",{text:"Connect your team"}),el("p",{class:"meta",text:"Save a Connecteam API key to load your company's data and enable the assistant."}),button("Connect Connecteam",()=>{active="settings";drawNav();return loadPage();},"btn primary")]));}else await renderers[active](page);}catch(error){if(ticket===generation)fail(page,error,loadPage);}finally{if(ticket===generation)refresh.disabled=false;}}
  try{settings=await api(ROOT+"/settings");if(disposed)return;drawNav();await Promise.all([loadPage(),mountAssistant()]);}catch(error){report(error);content.replaceChildren(el("div",{class:"card ce-error",text:error.message}));}
  return ()=>{disposed=true;generation++;chatCleanup?.();for(const dialog of dialogs)dialog.close();dialogs.clear();};
}
