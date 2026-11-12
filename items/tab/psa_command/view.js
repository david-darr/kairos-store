import { api as kairosApi, el, toast, confirmDialog, emptyState } from "/static/js/api.js";
import { mountSessionChat } from "/static/js/sessionChat.js";

const BASE = "/api/tab-psa-command";
const LABEL = { psa: "PSA Sales", taskbar: "Taskbar" };

function statusLabel(value) {
  return ({awaiting:'Needs your review',approved:'Approved',scheduled:'Approved and scheduled',running:'Sending',queued:'Waiting to send',sending:'Sending',done:'Finished',completed:'Finished',paused:'Paused',cancelled:'Stopped',expired:'Approval ended',revoked:'Access removed',unconfirmed:'Check your Sent folder',waiting:'Not sent yet'})[value] || String(value||'Not available').replaceAll('_',' ');
}
function reasonLabel(value) {
  return ({choose_school_context:'Choose which school this shared email address represents.',unsubscribed:'This contact must not receive outreach.',closed:'This school is a current/former client or no longer eligible.',replied:'This school has already replied.',in_flight:'An email to this address is already waiting or being sent.',not_due:'This follow-up is not due yet.',no_mailbox:'Connect your work email before sending.',campaign_already_contacted:'This contact is already part of this campaign.',recently_contacted:'This contact was emailed recently.'})[value] || String(value).replaceAll('_',' ');
}
function when(value) {
  if (!value) return "No due date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString([], { month: "short", day: "numeric" });
}
function field(label, control) {
  if (!control.id) control.id = "psa-field-" + Math.random().toString(36).slice(2);
  return el("div", { class: "field" }, [el("label", { text: label, for: control.id }), control]);
}
function options(select, rows, placeholder) {
  select.replaceChildren(el("option", { value: "", text: placeholder }),
    ...rows.map(([value, text]) => el("option", { value: String(value), text })));
}
function isoFromDate(value) {
  // A date input gives a local calendar day; send end of that day with its offset.
  if (!value) return null;
  return new Date(value + "T17:00:00").toISOString();
}

export async function render(container) {
  container.replaceChildren();
  let salesArea=sessionStorage.getItem('psa-command-sales-area')==='business'?'business':'school';
  function api(path,options={}) {
    if(path.startsWith(BASE+'/overview')||path===BASE+'/chat')path+=(path.includes('?')?'&':'?')+'workspace='+salesArea;
    if(options.body && (path===BASE+'/action'||path===BASE+'/human-request'||path===BASE+'/human-upload')) {
      const body=JSON.parse(options.body);
      if(path===BASE+'/action'&&body.tool?.startsWith('psa_'))body.arguments={...body.arguments,workspace:salesArea};
      if(path===BASE+'/human-upload')body.workspace=salesArea;
      if(path===BASE+'/human-request')body.params={...body.params,workspace:salesArea};
      options={...options,body:JSON.stringify(body)};
    }
    return kairosApi(path,options);
  }
  let disposed = false, mode = "overview", data = null, settings = null, closeChat = () => {}, loadToken = 0;
  let nativePane='guide',nativeToken=0,nativePage=1;
  const wrap = el("div", { class: "view-constrained psa-view" });
  const actions = el("div", { class: "psa-actions" });
  const heading = el("div", { class: "view-header" }, [
    el("div", {}, [el("h2", { text: "PSA Command" }),
      el("div", { class: "sub", text: "Your sales relationships, outreach and daily work. Review changes here without opening another app." })]),
    actions,
  ]);
  const tabs = el("nav", { class: "psa-tabs", "aria-label": "PSA Command sections" });
    const mobileSection = el("select", {class:"psa-mobile-section", "aria-label":"PSA Command section"});
    for (const [value,text] of [["overview","My work"],["outreach","Email outreach"],["actions","Tasks & relationship updates"],["connections","Account & setup"]]) mobileSection.append(el("option",{value,text}));
    mobileSection.addEventListener("change",()=>{mode=mobileSection.value;draw();mobileSection.focus();});
  const content = el("div");
  const chatHost = el("div", { class: "psa-chat card", hidden: true });
    wrap.append(heading, tabs, mobileSection, content, chatHost);
  container.append(wrap);
  const areaSelect=el('select',{class:'psa-sales-area','aria-label':'Sales workspace'});
  areaSelect.append(el('option',{value:'school',text:'School Sales'}),el('option',{value:'business',text:'Business Sales'}));
  areaSelect.value=salesArea;
  areaSelect.addEventListener('change',async()=>{
    salesArea=areaSelect.value;sessionStorage.setItem('psa-command-sales-area',salesArea);
    data=null;nativeToken++;nativePage=1;nativePane='guide';
    closeChat();closeChat=()=>{};chatHost.hidden=true;chatHost.replaceChildren();
    await load(true);
  });
  actions.prepend(areaSelect);

  function button(text, action, kind = "") {
    const node = el("button", { class: "btn " + kind, text, type: "button" });
    node.addEventListener("click", async () => {
      if (node.disabled) return;
      node.disabled = true;
      try { await action(); }
      catch (error) { toast(error.message || "Something went wrong", "error"); }
      finally { node.disabled = false; }
    });
    return node;
  }

  const human=(method,path,body=null,params=null)=>api(BASE+'/human-request',{method:'POST',body:JSON.stringify({method,path,body,params})});
  const confirmedTool=async(tool,args)=> (await api(BASE+'/action',{method:'POST',body:JSON.stringify({tool,arguments:args,confirmed:true})})).result;
  function nativeConnectionCard() {
    const card=el('section',{class:'card psa-native-connect'},[el('h3',{text:'Connect your PSA account'}),el('p',{class:'meta',text:'Use your PSA sign-in here. You do not need to open the PSA website. Your password is not saved; you may need to sign in again after 12 hours.'})]);
    const form=el('form',{class:'psa-native-form'});
    const url=el('input',{value:settings?.psa?.url||'https://psa-sales-backend.onrender.com/api/agent/v1',type:'url',required:true});
    const email=el('input',{type:'email',autocomplete:'username',required:true});
    const password=el('input',{type:'password',autocomplete:'current-password',required:true});
    const create=el('input',{type:'checkbox',checked:true});
    const scope=el('select');options(scope,[['full','Full access for my PSA role (recommended)'],['write','Custom read and write access'],['read','Custom read-only access']],'Choose school access');scope.value='full';
    const duration=el('select');options(duration,[[7,'7 days'],[30,'30 days'],[90,'90 days']],'Choose delegation expiry');duration.value='30';
    const caps=[];
    form.append(field('PSA email',email),field('PSA password',password),el('details',{},[el('summary',{text:'Advanced: connection address'}),field('PSA API address',url)]));
    const grants=el('fieldset',{},[el('legend',{text:'AI access to PSA'}),field('Access level',scope),field('How long may Kairos use this connection?',duration)]);
    for(const [cap,label] of Object.entries({'schools:import':'Import reviewed schools and contacts','outreach:read':'Read templates, PDFs, my replies and follow-up status','outreach:prepare':'Prepare outreach and check my inbox','outreach:send':'Run only batches or campaigns I explicitly approve','library:manage':'Manage team templates, PDFs and follow-up definitions (PSA admins only)','commissions:manage':'Create and correct seasonal commissions (PSA admins only)','team:manage':'Manage team access and invitations (PSA admins only)'})){
      const box=el('input',{type:'checkbox'});caps.push([cap,box]);grants.append(el('label',{},[box,document.createTextNode(' '+label)]));
    }
    const delegate=el('input',{type:'checkbox'});
    grants.append(el('label',{},[delegate,document.createTextNode(' I explicitly delegate execution of my approved batches and campaigns. My agent cannot approve itself.')]));
    const alert=el('div',{'role':'status'}),submit=el('button',{class:'btn primary',type:'submit',text:'Connect PSA account'});
    form.append(el('label',{},[create,document.createTextNode(' Create a separate connection (leave off to keep and upgrade this connection)')]),grants,alert,submit);
    const applyAccess=()=>{
      const full=scope.value==='full';
      for(const [,box] of caps){box.checked=full;box.disabled=full;}
      delegate.checked=full;delegate.disabled=full;
    };
    scope.onchange=applyAccess;applyAccess();
    grants.prepend(el('p',{class:'meta',text:'Full access grants reading and editing, imports, outreach preparation and execution of approved messages, plus management tools allowed by your PSA role. It cannot grant administrator rights or approve sending on your behalf. Connecting with full access also upgrades this connection in your existing chats.'}));
    create.onchange=()=>{grants.disabled=!create.checked && scope.value!=='full';};
    form.addEventListener('submit',async(event)=>{
      event.preventDefault();submit.disabled=true;alert.textContent='Connecting...';
      try{
        const result=await api(BASE+'/human-session',{method:'POST',body:JSON.stringify({url:url.value,email:email.value,password:password.value,capabilities:caps.filter(([,box])=>box.checked).map(([cap])=>cap),scope:scope.value,days:Number(duration.value),confirm_send:delegate.checked,create_key:create.checked})});
        if(disposed||!card.isConnected)return;
        password.value='';alert.replaceChildren(el('p',{text:'Connected as '+result.employee.name+'. Password discarded.'}));
        if(result.one_time_key){
          const secret=el('input',{type:'password',value:result.one_time_key,readOnly:true,'aria-label':'New PSA key shown once'});
          alert.append(el('p',{class:'meta',text:'Copy this new key into “Use these tools in Kairos chats” below. It is shown only now. Your tab connection is already saved.'}),secret,
            button('Copy new key',()=>navigator.clipboard.writeText(secret.value),'quiet'),button('Hide key',()=>{secret.value='';alert.replaceChildren(el('p',{text:'Connection saved. Key hidden.'}));},'quiet'));
        }
        settings=await api(BASE+'/settings');submit.textContent='Connected';submit.disabled=true;
      }catch(error){password.value='';alert.textContent=error.message;submit.disabled=false;}
    });
    card.append(form);
    api(BASE+'/human-session').then(status=>{
      if(disposed||!card.isConnected)return;
      if(status.key_id){create.checked=false;grants.disabled=false;email.value=status.employee.email;}
      if(status.connected){
        card.prepend(el('p',{class:'meta',text:'Human session: '+status.employee.name+' · expires '+new Date(status.expires_at).toLocaleString()}));
        card.append(button('Sign out of PSA here',async()=>{await api(BASE+'/human-session',{method:'DELETE'});draw();},'quiet'),el('p',{class:'meta',text:'Signing out stops local approvals. The separate agent key remains delegated until revoked or expired.'}));
        card.append(button('Remove Kairos access to PSA',async()=>{
          const ok=await confirmDialog({title:'Revoke delegated access?',message:'This connection will stop being able to run pending outreach. A message already being sent may finish. Other keys are unchanged.',confirmLabel:'Revoke connection'});
          if(!ok)return;
          await api(BASE+'/human-session/revoke',{method:'POST'});
          settings=await api(BASE+'/settings');draw();
        },'quiet'));
        const appPassword=el('input',{type:'password',autocomplete:'new-password','aria-label':'Gmail app password'});
        card.append(el('h4',{text:'Mailbox connection'}),el('p',{class:'meta',text:'Save a Gmail app password to PSA without opening its website. Kairos does not retain it.'}),field('Gmail app password',appPassword),button('Save mailbox connection',async()=>{try{await human('POST','/api/email-settings',{email_password:appPassword.value});toast('Mailbox settings saved. Check your inbox before sending.');}finally{appPassword.value='';}},'quiet'));
      }
    }).catch(error=>{if(card.isConnected)alert.textContent=error.message;});
    return card;
  }

  function plainMail(row) {
    const card=el('details',{class:'card psa-native-message'});
    card.append(el('summary',{text:(row.email||'')+' · '+(row.school_name||'')+(row.eligible===false?' · Skipped':'')}),
      el('strong',{text:row.subject||''}),el('pre',{text:row.body_text||row.body||''}),
      el('p',{class:'meta',text:'PDFs: '+((row.attachments||[]).join(', ')||'None')}));
    if(row.blockers?.length)card.append(el('p',{text:row.blockers.map(reasonLabel).join(' ')}));
    return card;
  }

  async function drawOutreach() {
    const version=++nativeToken;
    const host=el('div',{class:'psa-native-panel'});content.replaceChildren(host);
    const active=()=>!disposed&&host.isConnected&&version===nativeToken&&mode==='outreach';
    host.append(el('p',{role:'status',text:'Loading PSA workspace...'}));
    try{
      const session=await api(BASE+'/human-session');if(!active())return;
      if(!session.connected){host.replaceChildren(nativeConnectionCard());return;}
      const groups=[['guide','Start here','guide'],['sending','Review & send','campaigns'],['inbox',salesArea==='business'?'Business replies':'School replies','inbox'],['library','Templates & PDFs','library']];
      const selectedGroup=['campaigns','requests','followups','progress'].includes(nativePane)?'sending':nativePane;
      const controls=el('nav',{class:'psa-tabs','aria-label':'Email tasks'});
      controls.classList.add('psa-outreach-desktop-nav');
      const choosePane=(key)=>{nativePane=key;nativePage=1;drawOutreach().then(()=>{if(!disposed&&mode==='outreach'&&nativePane===key){const heading=content.querySelector('[data-outreach-heading]');heading?.focus({preventScroll:true});heading?.scrollIntoView({block:'nearest',behavior:'auto'});}});};
      for(const [key,label,target] of groups){const node=button(label,()=>choosePane(target),selectedGroup===key?'primary':'quiet');if(selectedGroup===key)node.setAttribute('aria-current','page');controls.append(node);}
      if(selectedGroup==='sending'){
        const secondary=el('nav',{class:'psa-tabs','aria-label':'Review and sending tools'});
        for(const [key,label] of [['campaigns','Whole campaigns'],['requests','One-time email requests'],['followups','Follow-up plans'],['progress','Sending progress']]){const node=button(label,()=>choosePane(key),nativePane===key?'primary':'quiet');if(nativePane===key)node.setAttribute('aria-current','page');secondary.append(node);}controls.append(secondary);
      }
      const body=el('div',{class:'psa-native-stack'});
      const mobileTool=el('select',{class:'psa-mobile-section','aria-label':'Email outreach action'});
      for(const [value,text] of [['guide','Start here'],['campaigns','Review a whole campaign'],['requests','Review a one-time request'],['followups','Manage follow-up plans'],['progress','Check sending progress'],['inbox','Read school replies'],['library','Templates & PDFs']])mobileTool.append(el('option',{value,text}));
      mobileTool.value=nativePane;mobileTool.addEventListener('change',()=>choosePane(mobileTool.value));
      host.replaceChildren(el('h3',{text:'Outreach as '+session.employee.name,tabindex:'-1','data-outreach-heading':''}),el('p',{class:'meta',text:'Review and manage emails here. No PSA website tab is needed.'}),controls,mobileTool,body);
      const purpose={campaigns:'Approve a fixed contact list and its emails once, including the displayed follow-up schedule. Future contacts are never added automatically.',requests:'Approve a one-time set of emails prepared by Kairos. This does not start automatic follow-ups.',followups:'Plan reminders after emails you have already sent. Review the messages, dates and approval rules before saving.',progress:'See what is waiting, finished or needs attention. You can stop the emails that have not been sent.',inbox:'Read school responses and check for new replies.',library:'Admins manage shared email templates and upload PDFs. Reps choose them when preparing outreach.'};
      if(purpose[nativePane])body.append(el('p',{class:'meta',text:purpose[nativePane]}));
      if(nativePane==='guide'){
        body.append(el('h4',{text:'Run your outreach in three steps'}),el('ol',{},[el('li',{text:'Ask Kairos to prepare emails for the schools you choose. It drafts the messages without sending.'}),el('li',{text:'Open Review & send. Check the recipients, messages, PDFs and any follow-up dates.'}),el('li',{text:'Approve only what you want sent. Track progress or stop remaining emails here.'})]),button('Ask Kairos to prepare outreach',openChat,'primary'));
        for(const [key,label,description] of [['campaigns','Review a whole campaign','Approve a fixed contact list, messages, follow-ups, daily cap and end date once.'],['requests','Review a one-time email request','Approve just the emails your assistant prepared. No automatic follow-ups are included.'],['progress','Check sending progress','See what is waiting, sent or needs your attention.'],['library','Manage templates and PDFs','Admins maintain shared messages and flyers. Reps use them when preparing emails.']])body.append(el('section',{class:'card psa-native-stack'},[el('h4',{text:label}),el('p',{class:'meta',text:description}),button(label,()=>choosePane(key),'quiet')]));
      }
      else if(nativePane==='campaigns'){await drawNativeCampaigns(body,active);}
      else if(nativePane==='requests'){
        const list=await human('GET','/api/agent-outreach-drafts',null,{page:nativePage});if(!active())return;
        body.append(el('p',{class:'meta',text:list.total+' requests'}));
        if(!list.items.length)body.append(el('p',{text:'No requests yet. Ask Kairos to prepare outreach using your saved PSA connection.'}));
        const pager=el('div',{class:'psa-actions'}),prev=button('Previous',()=>{nativePage--;drawOutreach();}),next=button('Next',()=>{nativePage++;drawOutreach();});prev.disabled=nativePage===1;next.disabled=nativePage*25>=list.total;pager.append(prev,next);body.append(pager);
        for(const item of list.items){
          const row=el('section',{class:'card'},[el('h4',{text:item.key_name+' · '+statusLabel(item.status)}),el('p',{class:'meta',text:'Expires '+new Date(item.expires_at).toLocaleString()})]);
          row.append(button('Review these emails',async()=>{
            const draft=await human('GET','/api/agent-outreach-drafts/'+item.id);if(!active())return;
            const review=el('div',{class:'psa-native-stack'}),messages=draft.preview?.previews||[];
            review.append(el('p',{text:messages.filter(r=>r.eligible).length+' eligible recipients. Campaign: '+(draft.preview?.campaign?.name||'Standard outreach')}),...messages.map(plainMail));
            const ack=el('input',{type:'checkbox'});
            const approve=button(draft.key_id===session.key_id?'Approve and start sending':'Approve for the connected assistant',async()=>{
              await human('POST','/api/agent-outreach-drafts/'+draft.id+'/approve',{revision:draft.revision});
              if(draft.key_id===session.key_id)await confirmedTool('psa_execute_approved_outreach',{draft_id:draft.id});
              toast('Approval saved. Check sending progress for queue status.');drawOutreach();
            },'primary');
            if(draft.status==='approved' && draft.key_id===session.key_id && draft.can_execute && Date.parse(draft.expires_at)>Date.now()) {
              review.append(button('Start this approved send',async()=>{
                await confirmedTool('psa_execute_approved_outreach',{draft_id:draft.id});
                toast('Approved batch queued.');drawOutreach();
              },'primary'));
            }
            approve.disabled=true;
            ack.onchange=()=>{approve.disabled=!ack.checked||draft.status!=='awaiting'||!draft.key_active||!draft.can_execute||Date.parse(draft.expires_at)<=Date.now()||!messages.some(r=>r.eligible);};
            review.append(el('label',{},[ack,document.createTextNode(' I reviewed the exact recipients, messages and PDFs and authorize this batch from my mailbox.')]),approve,
              button('Update this review',async()=>{await human('POST','/api/agent-outreach-drafts/'+draft.id+'/refresh',{revision:draft.revision});drawOutreach();},'quiet'),
              button('Stop remaining emails',async()=>{await human('POST','/api/agent-outreach-drafts/'+draft.id+'/revoke',{revision:draft.revision});drawOutreach();},'quiet'));
            row.replaceChildren(el('h4',{text:draft.key_name+' · '+statusLabel(draft.status)}),review);
          },'quiet'));body.append(row);
        }
      }else if(nativePane==='progress'){
        const [batches,worker]=await Promise.all([run('psa_outreach',{scope:'mine',limit:25}),human('GET','/api/outreach/worker')]);if(!active())return;
        body.append(el('p',{role:'status',text:worker.online?'Email sending service is available':'Sending service is unavailable. Your saved emails will wait; nothing starts from this screen alone.'}));
        if(worker.mode==='web')body.append(el('p',{class:'meta',text:'Sending uses the existing site. Host startup or service limits can delay scheduled emails; saved progress is retained.'}));
        if(!batches.items?.length)body.append(el('p',{text:'No batches yet.'}));
        for(const batch of batches.items||[]){const row=el('section',{class:'card'},[el('h4',{text:'Batch #'+batch.id+' · '+statusLabel(batch.status)})]);
          row.append(button('Read progress',async()=>{const detail=await run('psa_outreach_batch',{batch_id:batch.id});if(active())row.append(el('pre',{text:JSON.stringify(detail,null,2)}));},'quiet'),button('Stop remaining messages',()=>perform('psa_cancel_outreach',{batch_id:batch.id}),'quiet'));body.append(row);}
      }else if(nativePane==='inbox'){
        body.append(button('Check for new replies',async()=>{await confirmedTool('psa_check_replies',{});drawOutreach();},'quiet'));
        const replies=await run('psa_replies',{page:nativePage,limit:25});if(!active())return;
        if(!replies.items?.length)body.append(el('p',{text:'No replied conversations found. Use Check my inbox to sync.'}));
        for(const reply of replies.items||[])body.append(button(reply.school_name+' · '+reply.school_email,async()=>{const chain=await run('psa_reply_chain',{email_id:reply.id});if(active())body.append(el('pre',{class:'card',text:JSON.stringify(chain,null,2)}));},'quiet'));
        const more=button('Next replies',()=>{nativePage++;drawOutreach();});more.disabled=nativePage*25>=replies.total;body.append(more);
      }else if(nativePane==='library')await drawNativeLibrary(body,active,session.employee.admin);
      else await drawNativeFollowups(body,active,session.employee.admin);
    }catch(error){if(active())host.replaceChildren(el('p',{role:'alert',text:error.message}),button('Retry',drawOutreach,'quiet'),nativeConnectionCard());}
  }

  function resultsCard(result) {
    const card=el('section',{class:'card psa-native-stack'});
    const stats=el('dl',{class:'psa-result-grid'});
    for(const [key,label] of [['smtp_accepted','Accepted by email provider'],['failed','Could not send'],['unconfirmed','Check your Sent folder'],['remaining_contacts','Contacts still in progress'],['replied_cumulative','Contacts who replied'],['skipped_cumulative','Contacts skipped']])if(result[key]!==undefined)stats.append(el('div',{},[el('dt',{text:label}),el('dd',{text:String(result[key])})]));
    card.append(el('h4',{text:'Campaign results'}),el('p',{text:'Status: '+statusLabel(result.status)}),stats,el('p',{class:'meta',text:'Accepted by the email provider does not confirm arrival in an inbox. Sending counts are for today; replies and skips cover the whole campaign.'}));
    if(result.reason)card.append(el('p',{role:'status',text:result.reason}));
    card.append(el('details',{},[el('summary',{text:'Advanced details'}),el('pre',{text:JSON.stringify(result,null,2)})]));return card;
  }

  async function drawNativeCampaigns(body,active) {
    body.append(el('p',{class:'meta',text:'Ask Kairos to prepare a campaign from selected schools, a saved intro template, optional follow-up sequence, daily cap and end date. Review and authorize here once. Newly matching contacts are never added automatically.'}));
    const plans=await human('GET','/api/outreach/campaign-plans',null,{page:nativePage});if(!active())return;
    if(!plans.items.length)body.append(el('p',{text:'No campaigns yet. Ask Kairos to prepare one for review.'}));
    for(const item of plans.items){
      const card=el('section',{class:'card psa-native-stack'},[el('h4',{text:(item.name||'Campaign '+item.id.slice(0,8))+' - '+statusLabel(item.status)})]);
      card.append(button('Review campaign',async()=>{
        const plan=await human('GET','/api/outreach/campaign-plans/'+item.id);if(!active())return;
        const snap=plan.preview,review=el('div',{class:'psa-native-stack'});
        if(!plan.automation_enabled)review.append(el('p',{role:'status',text:'Campaign sending is disabled on the server. Approvals are saved, but automatic messages will not run.'}));
        const easternDate=value=>new Date(value).toLocaleString([], {timeZone:'America/New_York',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
        const hourLabel=hour=>(hour%12||12)+':00 '+(hour<12?'AM':'PM');
        review.append(el('h4',{text:snap.name}),el('p',{text:'Daily cap: '+snap.daily_cap+' emails. Sending hours: '+hourLabel(snap.start_hour)+' to '+hourLabel(snap.end_hour)+' weekdays, Eastern time. Campaign: '+easternDate(snap.starts_at)+' to '+easternDate(snap.ends_at)+'.'}),
          el('p',{text:'Sender is your signed-in mailbox. '+snap.rows.filter(r=>r.eligible).length+' eligible contacts. '+(snap.sequence?'Includes '+snap.sequence.steps.length+' follow-ups; days measured from the recorded introduction.':'Introduction only.')}));
        review.append(el('p',{class:'meta',text:'Delegated key expires '+new Date(plan.delegation_expires_at).toLocaleString()+'. Sending stops at that expiry even if the campaign end date is later.'}));
        for(const row of snap.rows){
          const mail=plainMail(row);mail.append(...row.followups.map(step=>{
            const followup=plainMail({...step,email:row.email,school_name:row.school_name});followup.append(el('p',{text:'Day '+step.day+' after introduction, adjusted to the business window.'}));return followup;
          }));review.append(mail);
        }
        const action=async(name,extra={})=>{await human('POST','/api/outreach/campaign-plans/'+plan.id+'/'+name,{revision:plan.revision,...extra});drawOutreach();};
        if(plan.status==='awaiting'){
          const ack=el('input',{type:'checkbox'}),approve=button('Approve campaign',()=>action('approve',{confirm:'AUTHORIZE_CAMPAIGN'}),'primary');
          approve.disabled=true;ack.onchange=()=>{approve.disabled=!ack.checked||Date.parse(plan.review_until)<=Date.now();};
          review.append(el('label',{},[ack,document.createTextNode(' I authorize these exact contacts, messages, PDFs, schedule, cap and end date to send from my mailbox without further batch prompts.')]),approve,
            button('Update this review',()=>action('refresh'),'quiet'));
        }
        if(['scheduled','approved','running'].includes(plan.status))review.append(button('Pause campaign',()=>action('pause'),'quiet'));
        if(plan.status==='paused')review.append(el('p',{role:'status',text:plan.reason||'Campaign paused'}),button('Resume campaign',async()=>{
          const ok=await confirmDialog({title:'Resume campaign?',message:'Resume only the existing approved scope. Current eligibility, cap and authorization are checked again. Errors or changed scope require a new campaign.',confirmLabel:'Resume campaign'});if(ok)await action('resume');
        },'quiet'));
        if(!['cancelled','completed','expired'].includes(plan.status))review.append(button('Stop campaign permanently',async()=>{
          const ok=await confirmDialog({title:'Cancel campaign?',message:'Stop remaining introductions and follow-ups permanently. A message already being sent may finish.',confirmLabel:'Cancel campaign'});if(ok)await action('cancel');
        },'quiet'));
        review.append(button('View campaign results',async()=>{
          const summary=await human('GET','/api/outreach/campaign-plans/'+plan.id+'/summary');if(active())review.append(resultsCard(summary));
        },'quiet'),el('details',{},[el('summary',{text:'Campaign activity'}),...plan.events.map(e=>el('p',{text:statusLabel(e.event)+' - revision '+e.revision+' - '+e.at}))]));
        card.replaceChildren(review);
      },'quiet'));body.append(card);
    }
    const previous=button('Previous campaigns',()=>{nativePage--;drawOutreach();}),next=button('Next campaigns',()=>{nativePage++;drawOutreach();});previous.disabled=nativePage===1;next.disabled=nativePage*25>=plans.total;body.append(el('div',{class:'psa-actions'},[previous,next]));
  }

  async function drawNativeFollowups(body,active,admin) {
    const [definitions,originals,enrollments]=await Promise.all([human('GET','/api/outreach/sequences'),human('GET','/api/outreach/sequence-originals',null,{page:nativePage,per_page:50}),human('GET','/api/outreach/sequence-enrollments',null,{page:nativePage,per_page:50})]);
    if(!active())return;
    if(admin){
      const templates=await human('GET','/api/outreach/templates');if(!active())return;
      const form=el('details',{class:'card'},[el('summary',{text:'Create a reusable follow-up schedule'})]),name=el('input',{placeholder:'Sequence name','aria-label':'Sequence name'}),audience=el('select');
      options(audience,[['all','All contacts'],['principal_ap','Principal / AP'],['pta_pto','PTA / PTO'],['enrichment','Enrichment'],['trunk_or_treat','Trunk-or-Treat']],'Choose audience');audience.value='principal_ap';
      const refs=[1,2,3].map(number=>{const select=el('select'),day=el('input',{type:'number',min:1,max:90,value:[4,10,17][number-1]});form.append(field('Step '+number+' template',select),field('Step '+number+' days from intro',day));return {select,day};});
      const update=()=>refs.forEach(({select},i)=>options(select,templates.items.filter(t=>t.kind==='followup'&&t.step===i+1&&['general',audience.value].includes(t.audience)).map(t=>[t.id,t.name+' · v'+t.revision]),'Choose template'));
      audience.onchange=update;update();form.prepend(field('Sequence name',name),field('Audience',audience));
      form.append(el('p',{class:'meta',text:'Weekdays, 9am to 5pm Eastern. Enrollment still requires a separate approval.'}),button('Save follow-up schedule',async()=>{
        const steps=refs.map(({select,day})=>{const t=templates.items.find(t=>t.id===Number(select.value));if(!t)throw new Error('Choose all three templates');return {day:Number(day.value),template_id:t.id,template_revision:t.revision};});
        await human('POST','/api/outreach/sequences',{name:name.value,audience:audience.value,start_hour:9,end_hour:17,steps});drawOutreach();
      },'primary'));body.append(form);
    }
    body.append(el('p',{class:'meta',text:'Introductions never enroll automatically. Review the contact, each message/PDF, dates and mode here. Automatic mode requires your separate acknowledgment.'}));
    const sequence=el('select');options(sequence,definitions.items.filter(s=>!s.archived).map(s=>[s.id,s.name+' · v'+s.revision]),'Choose sequence');
    const today=(days=0)=>new Date(Date.now()+days*86400000).toLocaleDateString('en-CA',{timeZone:'America/New_York'});
    const starts=el('input',{type:'date',value:today()}),ends=el('input',{type:'date',value:today(45)}),sending=el('select');
    options(sending,[['review','Review each due step'],['automatic','Authorize these scheduled steps until the end date']],'Choose mode');sending.value='review';
    const replace=el('input',{type:'checkbox'}),chosen=new Set(),pick=el('div',{class:'psa-native-stack'}),reviewHost=el('div',{class:'psa-native-stack'});
    for(const original of originals.items){const box=el('input',{type:'checkbox'});box.onchange=()=>box.checked?chosen.add(original.id):chosen.delete(original.id);pick.append(el('label',{},[box,document.createTextNode(' '+original.school_name+' · '+original.email+(original.already_managed?' · Already enrolled':''))]));}
    const search=el('input',{type:'search',placeholder:'Search school or recipient','aria-label':'Search introductions'}),searchResults=el('div');
    const searchButton=button('Search introductions',async()=>{
      const result=await human('GET','/api/outreach/sequence-originals',null,{q:search.value,page:1,per_page:100});if(!active())return;
      chosen.clear();pick.replaceChildren();
      for(const original of result.items){const box=el('input',{type:'checkbox'});box.onchange=()=>box.checked?chosen.add(original.id):chosen.delete(original.id);pick.append(el('label',{},[box,document.createTextNode(' '+original.school_name+' · '+original.email)]));}
      searchResults.textContent=result.total+' matching introductions (showing up to 100). Narrow the search for more.';
    },'quiet');
    body.append(field('Sequence',sequence),field('Start date (Eastern)',starts),field('Authorization end date (Eastern)',ends),field('Mode',sending),
      el('label',{},[replace,document.createTextNode(' Replace existing enrollments with a newly reviewed approval. Sent steps will not repeat.')]),search,searchButton,searchResults,pick,
      button('Review follow-up messages and dates',async()=>{
        const definition=definitions.items.find(s=>s.id===Number(sequence.value));
        if(!definition||!chosen.size)throw new Error('Choose a sequence and introductions');
        const settings={sequence_id:definition.id,revision:definition.revision,original_ids:[...chosen],mode:sending.value,start_date:starts.value,end_date:ends.value,replace_existing:replace.checked};
        const preview=await human('POST','/api/outreach/sequence-enrollments/preview',settings);if(!active())return;
        const acknowledgement=el('input',{type:'checkbox'}),commit=button(settings.mode==='automatic'?'Authorize these scheduled sends':'Save plan with approval before each email',async()=>{
          await human('POST','/api/outreach/sequence-enrollments/commit',{review_id:preview.review_id,settings,...(settings.mode==='automatic'?{confirm:'AUTHORIZE_AUTOMATIC_SEQUENCE'}:{})});
          toast('Enrollment saved. The sending service enforces the approved rules.');drawOutreach();
        },'primary');commit.disabled=true;acknowledgement.onchange=()=>{commit.disabled=!acknowledgement.checked;};
        reviewHost.replaceChildren(el('p',{text:'Frozen '+settings.mode+' enrollment: '+preview.starts_at+' to '+preview.ends_at}),...preview.rows.flatMap(row=>row.steps.map(step=>{
          const mail=plainMail({...step,email:row.email,school_name:row.school_name});mail.append(el('p',{class:'meta',text:step.already_sent?'Already sent; will not repeat':'Due '+new Date(step.due_at).toLocaleString()+' · day '+step.day}));return mail;
        })),el('label',{},[acknowledgement,document.createTextNode(settings.mode==='automatic'?' I authorize these exact messages, contacts, dates and business hours to send automatically from my mailbox.':' I reviewed the messages and dates. Every due step will still need my approval.')]),commit);
      },'primary'),reviewHost,el('h3',{text:'My follow-up plans'}));
    for(const enrollment of enrollments.items){
      const card=el('section',{class:'card'},[el('h4',{text:enrollment.school_name+' · '+statusLabel(enrollment.status)}),el('p',{text:enrollment.reason||enrollment.mode})]);
      for(const step of enrollment.steps){
        card.append(el('p',{text:'Step '+step.number+' · '+statusLabel(step.status)+' · '+new Date(step.due_at).toLocaleString()}));
        if(enrollment.status==='active'&&enrollment.mode==='review'&&step.status==='waiting')card.append(button('Review step '+step.number,async()=>{
          const preview=await human('POST','/api/outreach/sequence-steps/'+step.id+'/preview',{});if(!active())return;
          const mail=plainMail(preview);mail.open=true;
          mail.append(button('Approve this due message',async()=>{await human('POST','/api/outreach/sequence-steps/'+step.id+'/approve',{preview_token:preview.preview_token});toast('Step approved for 15 minutes within its business window.');drawOutreach();},'primary'));card.append(mail);
        },'quiet'));
      }
      if(enrollment.status==='active')card.append(button('Stop this follow-up plan',async()=>{await human('POST','/api/outreach/sequence-enrollments/'+enrollment.id+'/cancel',{});drawOutreach();},'quiet'));
      body.append(card);
    }
    const prev=button('Previous conversations / enrollments',()=>{nativePage--;drawOutreach();}),next=button('Next conversations / enrollments',()=>{nativePage++;drawOutreach();});prev.disabled=nativePage===1;next.disabled=nativePage*50>=Math.max(originals.total,enrollments.total);body.append(el('div',{class:'psa-actions'},[prev,next]));
  }

  async function drawNativeLibrary(body,active,admin) {
    const [templates,assets]=await Promise.all([human('GET','/api/outreach/templates'),human('GET','/api/outreach/template-assets')]);if(!active())return;
    body.append(el('h3',{text:'Shared templates and attachment catalog'}));
    for(const template of templates.items)body.append(plainMail({...template,school_name:template.name,email:template.audience,attachments:(template.attachments||[]).map(a=>a.name)}));
    body.append(el('p',{class:'meta',text:'Catalog PDFs: '+(assets.saved.map(a=>a.name).join(', ')||'None yet')}));
    if(!admin){body.append(el('p',{text:'Ask Kairos to use a saved template or choose catalog PDFs when preparing outreach.'}));return;}
    function uploadPicker(kind,label){
      const input=el('input',{type:'file',accept:kind==='pdf'?'.pdf':'.json',hidden:true}),output=el('div',{role:'status'}),pick=button(label,()=>input.click(),'quiet');
      input.addEventListener('change',async()=>{
        const file=input.files[0];if(!file)return;
        pick.disabled=true;output.textContent='Uploading '+file.name+'...';
        try{
          const cap=kind==='pdf'?10*1024*1024:1024*1024;if(file.size>cap)throw new Error('File exceeds the upload size limit');
          const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
          const result=await api(BASE+'/human-upload',{method:'POST',body:JSON.stringify({kind,filename:file.name,encoded:btoa(binary)})});if(!active())return;
          if(kind==='pdf'){toast('PDF saved in the shared catalog.');drawOutreach();}
          else output.replaceChildren(el('p',{text:result.new+' new templates; '+result.total+' rows reviewed.'}),...result.items.map(item=>el('p',{text:item.name+' · '+item.action})),button('Import reviewed templates',async()=>{await human('POST','/api/outreach/template-imports/'+result.id+'/commit',{});drawOutreach();},'primary'));
        }catch(error){if(active())output.textContent=error.message;}finally{pick.disabled=false;input.value='';}
      });return el('div',{class:'card'},[input,pick,output]);
    }
    body.append(uploadPicker('pdf','Add PDF to shared catalog'),uploadPicker('templates','Upload template JSON for review'),
      button('Import approved Winter 2027 template set',async()=>{await human('POST','/api/outreach/templates/seed-winter-2027',{});drawOutreach();},'quiet'));
    const form=el('section',{class:'card psa-native-form'},[el('h4',{text:'Create or update template'})]),choose=el('select'),name=el('input'),subject=el('input'),copy=el('textarea',{rows:10}),kind=el('select'),audience=el('select'),step=el('select'),archive=el('input',{type:'checkbox'});
    options(choose,templates.items.map(t=>[t.id,t.name+' · v'+t.revision]),'New template');options(kind,[['initial','Introduction'],['followup','Follow-up']],'Choose type');kind.value='initial';
    options(audience,[['general','General'],['principal_ap','Principal / AP'],['pta_pto','PTA / PTO'],['enrichment','Enrichment'],['trunk_or_treat','Trunk-or-Treat']],'Choose audience');audience.value='general';options(step,[[0,'Intro'],[1,'Follow-up 1'],[2,'Follow-up 2'],[3,'Follow-up 3']],'Choose step');step.value='0';
    const checks=assets.saved.map(a=>[a,el('input',{type:'checkbox'})]);let current=null;
    choose.onchange=()=>{current=templates.items.find(t=>t.id===Number(choose.value));name.value=current?.name||'';subject.value=current?.subject||'';copy.value=current?.body||'';kind.value=current?.kind||'initial';audience.value=current?.audience||'general';step.value=String(current?.step||0);archive.checked=Boolean(current?.archived);checks.forEach(([a,box])=>{box.checked=Boolean(current?.attachments?.some(t=>t.id===a.id));});};
    kind.onchange=()=>{step.value=kind.value==='initial'?'0':'1';};
    form.append(field('Edit saved template',choose),field('Name',name),field('Type',kind),field('Audience',audience),field('Step',step),field('Subject',subject),field('Message',copy),el('p',{class:'meta',text:'Fields: {school name} or {business name}, {contact name}, {my name}, {my email}. Selected PDFs will be included every time this template is used.'}));
    checks.forEach(([a,box])=>form.append(el('label',{},[box,document.createTextNode(' '+a.name)])));
    form.append(el('label',{},[archive,document.createTextNode(' Archive template')]),button('Save template version',async()=>{
      const values={name:name.value,kind:kind.value,audience:audience.value,step:Number(step.value),subject:subject.value,body:copy.value,attachment_ids:checks.filter(([,box])=>box.checked).map(([a])=>a.id),archived:archive.checked,...(current?{revision:current.revision}:{})};
      await human(current?'PUT':'POST','/api/outreach/templates'+(current?'/'+current.id:''),values);toast('Template version saved. Existing approved copy stays frozen.');drawOutreach();
    },'primary'));body.append(form);
  }

  async function run(tool, args) {
    return (await api(BASE + "/action", { method: "POST", body: JSON.stringify({ tool, arguments: args }) })).result;
  }

  // Writes: ask the server for a preview, show it, send only after the person agrees.
  async function perform(tool, args) {
    const preview = await run(tool, args);
    const summary = preview?.summary || "Send this change?";
    const ok = await confirmDialog({ title: "Confirm change in " + (preview?.system || "PSA"), message: summary,
      confirmLabel: "Send change", danger: false });
    if (!ok) return false;
    await api(BASE + "/action", { method: "POST", body: JSON.stringify({ tool, arguments: args, confirmed: true }) });
    toast("Done. " + summary);
    await load(false);
    return true;
  }

  function drawTabs() {
    mobileSection.value=mode;
    tabs.replaceChildren(...[["overview", "My work"], ["outreach", "Email outreach"], ["actions", "Tasks & relationship updates"], ["connections", "Account & setup"]].map(([key, text]) =>
      el("button", { class: "btn quiet" + (mode === key ? " active" : ""), text, type: "button",
          "aria-pressed": String(mode === key), onclick: () => {
            mode = key; draw();
            tabs.querySelector('[aria-pressed="true"]')?.focus();
          } })));
  }

  async function load(refresh) {
    const token = ++loadToken;
    content.replaceChildren(el("div", { class: "meta", text: refresh ? "Refreshing from PSA Sales and Taskbar..." : "Loading..." }));
    try {
      const [nextSettings, nextData] = await Promise.all([
        api(BASE + "/settings"), api(BASE + "/overview" + (refresh ? "?refresh=true" : "")),
      ]);
      if (disposed || token !== loadToken) return;
      settings = nextSettings; data = nextData;
      if (!settings.psa.key_saved && !settings.taskbar.key_saved && mode === "overview") mode = "connections";
      draw();
    } catch (error) {
      if (disposed || token !== loadToken) return;
      content.replaceChildren(el("div", { class: "card psa-error" }, [
        el("div", { class: "title", text: "PSA Command could not load" }),
        el("div", { class: "meta", text: (error.message || "Request failed") + ". Check your connection, then retry." }),
        button("Retry", () => load(true)),
      ]));
    }
  }

  function systemStatus(system) {
    const part = data?.[system] || {};
    if (!part.connected) return el("span", { class: "psa-pill", text: LABEL[system] + ": not connected" });
    if (part.error) return el("span", { class: "psa-pill warn", text: LABEL[system] + ": " + part.error });
    const who = [part.me?.name, part.me?.role, part.me?.workspace].filter(Boolean).join(" · ");
    return el("span", { class: "psa-pill ok", text: LABEL[system] + (who ? ": " + who : "") });
  }

  function stat(value, label) {
    return el("div", { class: "card psa-stat" }, [el("strong", { text: value ?? "–" }), el("span", { class: "meta", text: label })]);
  }

  function taskRow(system, task) {
    const meta = [when(task.due_at), task.owner, task.school, task.status].filter(Boolean).join(" · ");
    const row = el("div", { class: "psa-row" }, [
      el("div", { class: "psa-row-text" }, [el("div", { class: "title", text: task.title || "Untitled task" }),
        el("div", { class: "meta", text: meta })]),
    ]);
    const done = system === "psa"
      ? () => perform("psa_update_task", { task_id: task.id, version: task.version, status: "completed" })
      : () => perform("taskbar_update_task", { task_id: task.id, revision: task.revision, status: "Completed" });
    if (task.id && (task.version || task.revision)) row.append(button("Mark done", done, "quiet"));
    return row;
  }

  function overdueColumn(system) {
    const part = data?.[system] || {};
    const column = el("div", { class: "card psa-column" }, [
      el("div", { class: "psa-column-head" }, [el("div", { class: "title", text: LABEL[system] + " overdue" }),
        el("span", { class: "meta", text: part.connected && !part.error ? String(part.overdue_total ?? 0) : "" })]),
    ]);
    if (!part.connected) column.append(el("div", { class: "meta", text: "Connect " + LABEL[system] + " under Account & setup." }));
    else if (part.error) column.append(el("div", { class: "meta psa-warn", text: part.error }));
    else if (!(part.overdue_tasks || []).length) column.append(el("div", { class: "meta", text: "Nothing overdue." }));
    else column.append(...part.overdue_tasks.slice(0, 25).map((task) => taskRow(system, task)));
    return column;
  }

  function drawOverview() {
    const psa = data?.psa || {};
    const healthy = psa.connected && !psa.error;
    const totals = healthy ? psa.totals || {} : {};
    const navigate = (section, pane) => {
      mode = section;
      if (pane) nativePane = pane;
      draw();
    };
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const name = psa.me?.name?.trim().split(/\s+/)[0];
    const intro = el("section", {class: "psa-welcome"}, [
      el("div", {}, [el("p", {class: "psa-eyebrow", text: "YOUR SALES WORKSPACE"}),
        el("h3", {text: greeting + (name ? ", " + name : "")}),
        el("p", {class: "meta", text: "See what needs attention, then choose your next step."})]),
      el("div", {class: "psa-status"}, [systemStatus("psa"), systemStatus("taskbar"),
        el("span", {class: "meta", text: data?.generated_at ? "Updated " + new Date(data.generated_at).toLocaleTimeString([], {hour: "numeric", minute: "2-digit"}) : ""})])]);

    const portfolio = el("section", {class: "card psa-portfolio", "aria-label": (salesArea==='business'?"Sponsorship portfolio":"School portfolio")}, [
      el("div", {class: "psa-column-head"}, [el("h3", {text: (salesArea==='business'?"Sponsorship portfolio":"School portfolio")}),
        el("span", {class: "meta", text: psa.admin ? "Team overview" : "Your schools"})]),
      el("div", {class: "psa-portfolio-total"}, [el("strong", {text: totals.schools ?? "Not available"}), el("span", {class: "meta", text: salesArea==='business'?"Businesses in your workspace":"Schools in your workspace"})])]);
    if (!healthy) {
      portfolio.append(el("p", {class: "meta", text: psa.error || "Connect your PSA account to see your schools and outreach."}),
        button("Open account & setup", () => navigate("connections")));
    } else {
      const stages = [["pending", "New leads"], ["contacted", "Contacted"], ["replied", "Replied"], ["meeting", "Meeting"], ["partner", "Active clients"], ["former", "Former clients"], ["not_interested", "Not interested"]];
      const maximum = Math.max(1, ...stages.map(([key]) => Number(psa.stages?.[key]) || 0));
      const list = el("div", {class: "psa-stage-list"});
      for (const [key, label] of stages) {
        const count = Number(psa.stages?.[key]) || 0;
        const bar = el("div", {class: "psa-stage-track", "aria-hidden": "true"}, [el("span", {style: "width:" + (100 * count / maximum) + "%"})]);
        list.append(el("div", {class: "psa-stage-row"}, [el("span", {text: label}), bar, el("strong", {text: count})]));
      }
      portfolio.append(list);
    }
    const attention = el("section", {class: "card psa-attention"}, [
      el("p", {class: "psa-eyebrow", text: "NEEDS ATTENTION"}), el("h3", {text: "Keep conversations moving"}),
      el("div", {class: "psa-attention-counts"}, [
        el("div", {}, [el("strong", {text: healthy ? psa.overdue_total ?? 0 : "-"}), el("span", {class: "meta", text: "Overdue PSA tasks"})]),
        el("div", {}, [el("strong", {text: totals.due_followups ?? "-"}), el("span", {class: "meta", text: "Due follow-ups"})])]),
      el("div", {class: "psa-actions"}, [button("Review outreach", () => navigate("outreach", "guide"), "primary"), button("Create a task", () => navigate("actions"))]),
      el("p", {class: "meta", text: "Check replies before following up. Sending always follows your approval settings."})]);
    const highlights = el("div", {class: "psa-highlight-grid"}, [stat(totals.sent, "Emails sent"), stat(totals.responses, "Replies received"), stat(healthy ? psa.closes_this_month : null, "Closed this month")]);
    const dashboard = el("div", {class: "psa-dashboard"}, [portfolio, el("div", {class: "psa-dashboard-side"}, [attention, highlights])]);
    const work = el("section", {class: "psa-work-section"}, [
      el("div", {class: "psa-section-heading"}, [el("div", {}, [el("h3", {text: "Today & next up"}), el("p", {class: "meta", text: "Overdue work from your connected accounts. Mark a task done after reviewing the change."})]), button("New task", () => navigate("actions"))]),
      el("div", {class: "psa-split"}, [overdueColumn("psa"), overdueColumn("taskbar")])]);
    const nodes = [intro, dashboard, work];
    if (healthy && (psa.reps || []).length) {
      const table = el("table", {class: "psa-table"}, [
        el("caption", {text: "Schools, active clients and overdue work by sales rep"}),
        el("thead", {}, [el("tr", {}, ["Sales rep", salesArea==='business'?"Businesses":"Schools", "Pipeline", salesArea==='business'?"Active sponsors":"Active clients", "Closed this month", "Overdue"].map(h => el("th", {text: h, scope: "col"})))]),
        el("tbody", {}, psa.reps.map(rep => el("tr", {}, [rep.name, rep.schools, rep.pipeline, rep.active_clients, rep.closes_this_month, rep.overdue_tasks].map(v => el("td", {text: String(v ?? "-")}))))) ]);
      table.classList.add("psa-team-desktop");
      const cards=el("div",{class:"psa-team-mobile"},psa.reps.map(rep=>el("section",{class:"psa-rep-summary"},[
        el("h4",{text:rep.name}),el("dl",{},[["Schools",rep.schools],["Active clients",rep.active_clients],["Closed this month",rep.closes_this_month],["Overdue tasks",rep.overdue_tasks]].map(([label,value])=>el("div",{},[el("dt",{text:label}),el("dd",{text:value??"-"})])))
      ])));
      nodes.push(el("section", {class: "card psa-scroll"}, [el("h3", {text: "Your team at a glance"}), table,cards]));
    }
    const activity = healthy ? psa.activity || [] : [];
    nodes.push(el("section", {class: "card"}, [el("h3", {text: "Recent sales activity"}),
      ...(activity.length ? activity.map(item => el("div", {class: "psa-row"}, [el("div", {class: "psa-row-text"}, [
        el("div", {text: [item.actor, String(item.kind || "").replaceAll("_", " "), item.school].filter(Boolean).join(" / ")}),
        el("div", {class: "meta", text: (item.detail || "") + (item.at ? " / " + when(item.at) : "")})])]))
        : [el("p", {class: "meta", text: !healthy ? "Activity is unavailable until PSA connects successfully." : "No recent activity."})])]));
    content.replaceChildren(...nodes);
  }

  function schoolPicker() {
    const query = el("input", { type: "search", placeholder: "Search schools by name, contact or email" });
    const select = el("select", { "aria-label": "School" });
    options(select, [], "Search first");
    const find = button("Search", async () => {
      const result = await run("psa_schools", { q: query.value.trim(), limit: 25 });
      const rows = (result.items || []).map((s) => [s.id, [s.school_name, s.owner_name, s.status].filter(Boolean).join(" · ")]);
      options(select, rows, rows.length ? "Choose a school" : "No matches");
    });
    return { select, node: el("div", { class: "psa-pair" }, [field("Find school", query), find]) };
  }

  function repOptions(select, placeholder) {
    options(select, (data?.psa?.reps || []).map((rep) => [rep.id, rep.name]), placeholder);
  }

  function drawActions() {
    const psaOn = settings?.psa?.key_saved, taskbarOn = settings?.taskbar?.key_saved;
    const panels = [];

    // Create a task in either system.
    const system = el("select", { "aria-label": "System" });
    options(system, [psaOn && ["psa", "PSA Sales"], taskbarOn && ["taskbar", "Taskbar"]].filter(Boolean), "Choose a system");
    const title = el("input", { maxlength: 240, placeholder: "Call the director about pricing" });
    const due = el("input", { type: "date" });
    const owner = el("select", { "aria-label": "Assign to" });
    const program = el("select", { "aria-label": "Program" });
    const extra = el("div");
    options(owner, [], "Me"); options(program, [], "Choose a program");
    system.addEventListener("change", async () => {
      extra.replaceChildren();
      try {
        if (system.value === "psa") {
          repOptions(owner, "Me");
          extra.append(field("Assign to", owner));
        } else if (system.value === "taskbar") {
          const [programs, members] = await Promise.all([run("taskbar_programs", {}), run("taskbar_members", {})]);
          const list = (x) => Array.isArray(x) ? x : (x?.items || []);
          options(program, list(programs).map((p) => [p.id, p.name || p.id]), "Choose a program");
          options(owner, list(members).map((m) => [m.id, m.name || m.full_name || m.display_name || m.email || m.id]), "Default assignee");
          extra.append(field("Program", program), field("Assign to", owner));
        }
      } catch (error) { if (!disposed) toast(error.message, "error"); }
    });
    panels.push(el("div", { class: "card psa-form" }, [el("div", { class: "title", text: "Create a task" }),
      field("System", system), field("Title", title), field("Due date", due), extra,
      button("Review and send", async () => {
        if (!title.value.trim()) throw new Error("Enter a task title");
        if (system.value === "psa") {
          const args = { title: title.value.trim() };
          if (due.value) args.due_at = isoFromDate(due.value);
          if (owner.value) args.user_id = Number(owner.value);
          if (await perform("psa_create_task", args)) title.value = "";
        } else if (system.value === "taskbar") {
          if (!program.value || !due.value) throw new Error("Choose a program and due date");
          const args = { title: title.value.trim().slice(0, 140), program_id: program.value, due_at: isoFromDate(due.value) };
          if (owner.value) args.assignee = owner.value;
          if (await perform("taskbar_create_task", args)) title.value = "";
        } else throw new Error("Choose a system");
      }, "primary")]));

    if (psaOn) {
      const reassign = schoolPicker(), rep = el("select", { "aria-label": "New owner" });
      repOptions(rep, data?.psa?.admin ? "Choose a rep" : "Administrator key required");
      panels.push(el("div", { class: "card psa-form" }, [el("div", { class: "title", text: "Reassign a school" }),
        reassign.node, field(salesArea==='business'?"Business":"School", reassign.select), field("New owner", rep),
        button("Review and send", async () => {
          if (!reassign.select.value || !rep.value) throw new Error("Choose a school and a rep");
          await perform("psa_assign_schools", { ids: [Number(reassign.select.value)], user_id: Number(rep.value) });
        }, "primary")]));

      const logged = schoolPicker(), kind = el("select", { "aria-label": "Activity type" });
      const detail = el("textarea", { rows: 3, maxlength: 2000, placeholder: "What happened" });
      options(kind, [["call", "Call"], ["meeting", "Meeting"], ["note", "Note"]], "Choose a type");
      kind.value = "call";
      panels.push(el("div", { class: "card psa-form" }, [el("div", { class: "title", text: "Log activity" }),
        logged.node, field(salesArea==='business'?"Business":"School", logged.select), field("Type", kind), field("Details", detail),
        button("Review and send", async () => {
          if (!logged.select.value || !detail.value.trim()) throw new Error("Choose a school and enter details");
          if (await perform("psa_log_activity", { school_id: Number(logged.select.value), kind: kind.value, detail: detail.value.trim() })) detail.value = "";
        }, "primary")]));
    }
    content.replaceChildren(panels.length && (psaOn || taskbarOn) ? el("div", { class: "psa-grid" }, panels)
      : emptyState({ title: "Nothing connected yet", hint: "Add a PSA Sales or Taskbar key under Connections.",
        actionLabel: "Open Connections", onAction: () => { mode = "connections"; draw(); } }));
  }

  function connectionCard(system) {
    const saved = settings?.[system] || {};
    const url = el("input", { type: "url", value: saved.url || "", placeholder: system === "psa"
      ? "https://psa-sales-backend.onrender.com/api/agent/v1" : "https://<project>.supabase.co/functions/v1/agent-api/v1" });
    const key = el("input", { type: "password", autocomplete: "off",
      placeholder: saved.key_saved ? "Saved; leave blank to keep" : (system === "psa" ? "psak_..." : "tbk_...") });
    const result = el("div", { class: "meta" });
    const where = system === "psa" ? "PSA Sales Settings > AI & integrations" : "Taskbar Settings > AI & integrations";
    return el("div", { class: "card psa-form" }, [
      el("div", { class: "title", text: LABEL[system] }),
      el("div", { class: "meta", text: "Create a key in " + where + ". Start read-only; use a write key to make changes from here." }),
      field("API address", url), field("API key", key),
      el("div", { class: "psa-actions" }, [
        button("Save", async () => {
          settings = await api(`${BASE}/settings/${system}`, { method: "PUT", body: JSON.stringify({ url: url.value, key: key.value || null }) });
          key.value = ""; key.placeholder = "Saved; leave blank to keep";
          toast(LABEL[system] + " saved");
        }, "primary"),
        button("Test", async () => {
          const me = await api(`${BASE}/settings/${system}/test`, { method: "POST" });
          result.textContent = "Connected as " + [me.name, me.role].filter(Boolean).join(", ");
        }),
        saved.key_saved ? button("Disconnect", async () => {
          const ok = await confirmDialog({ title: "Disconnect " + LABEL[system] + "?", message: "The saved key is removed from Kairos. Revoke it in " + LABEL[system] + " too if you no longer need it.", confirmLabel: "Disconnect" });
          if (!ok) return;
          settings = await api(`${BASE}/settings/${system}`, { method: "PUT", body: JSON.stringify({ clear: true }) });
          draw();
        }, "quiet") : null,
      ].filter(Boolean)),
      result,
    ]);
  }

  function chatToolsCard() {
    const card = el("div", { class: "card psa-form" }, [el("div", { class: "title", text: "Use these tools in Kairos chats" }),
      el("div", { class: "meta", text: "Loading..." })]);
    (async () => {
      const setup = await api(BASE + "/chat-tools").catch(() => null);
      const servers = await api("/api/integrations").catch(() => null);
      if (disposed || !setup) return;
      const existing = (servers || []).find((item) => item.kind === "mcp_server" && item.name === setup.name);
      const manual = el("details", {}, [el("summary", { text: "Set up by hand" }),
        el("div", { class: "meta", text: "Tool Store > MCP servers > add a local (stdio) server named " + setup.name + "." }),
        el("div", { class: "meta", text: "Command:" }), el("code", { class: "psa-code", text: setup.command }),
        el("div", { class: "meta", text: "Arguments, one per line:" }), el("code", { class: "psa-code", text: setup.args.join("\n") }),
        el("div", { class: "meta", text: "Key: your PSA Sales key and Taskbar key separated by a space." })]);
      const body = [el("div", { class: "title", text: "Use these tools in Kairos chats" })];
      if (!setup.systems.length) {
        body.push(el("div", { class: "meta", text: "Save PSA Sales or Taskbar above first." }));
      } else if (existing) {
        const state = existing.status?.state, count = existing.status?.tools;
        body.push(el("div", { class: "meta", text: state === "working"
          ? `Added to Kairos with ${count ?? "its"} tools. In any existing or new chat, select PSA Command in that chat's Integrations menu. Ask it to check PSA capabilities before starting.`
          : "Added to Kairos, but its last check failed: " + (existing.status?.error || "not checked yet") + "." }));
        if (setup.systems.some((system) => !existing.args?.includes(`--${system}-url`)))
          body.push(el("div", { class: "meta psa-warn", text: "It was added before every system was connected. Remove " + setup.name + " in Tool Store and add it again here." }));
        body.push(el("div", { class: "psa-actions" }, [button("Check again", async () => {
          await api(`/api/integrations/${existing.id}/check`, { method: "POST" });
          card.replaceWith(chatToolsCard());
        })]));
      } else if (servers === null) {
        body.push(el("div", { class: "meta", text: "Only a Kairos administrator can add chat tools. Ask one to add them, or follow the steps below." }));
      } else {
        const keys = Object.fromEntries(setup.systems.map((system) => [system, el("input", { type: "password", autocomplete: "off",
          placeholder: system === "psa" ? "psak_..." : "tbk_..." })]));
        body.push(el("div", { class: "meta", text: "Makes PSA tools available to any Kairos chat after you select PSA Command in that chat's Integrations menu. Paste the keys once more; Kairos stores them encrypted. School access and admin permissions follow the connected employee; final send approvals remain private human controls." }),
          ...setup.systems.map((system) => field(LABEL[system] + " key", keys[system])),
          el("div", { class: "psa-actions" }, [button("Add to Kairos chats", async () => {
            const values = setup.systems.map((system) => keys[system].value.trim());
            if (values.some((value, i) => !value.startsWith(setup.systems[i] === "psa" ? "psak_" : "tbk_")))
              return toast("Paste a PSA Sales key (psak_...) and a Taskbar key (tbk_...) for each connected system");
            const ok = await confirmDialog({ title: "Add PSA Command to Kairos chats?",
              message: "Kairos chats get the PSA Command tools for " + setup.systems.map((system) => LABEL[system]).join(" and ") + ". Every change still shows a preview and waits for your approval.",
              confirmLabel: "Add" });
            if (!ok) return;
            const added = await api("/api/integrations/mcp-server", { method: "POST", body: JSON.stringify({
              name: setup.name, mcp_type: "stdio", command: setup.command, args: setup.args, api_key: values.join(" ") }) });
            toast(added.status?.state === "working" ? "Added. Select PSA Command in the Integrations menu of the chat you want to use." : "Added, but the check failed. See Tool Store.");
            card.replaceWith(chatToolsCard());
          }, "primary")]));
      }
      body.push(manual);
      card.replaceChildren(...body);
    })();
    return card;
  }

  function drawConnections() {
    content.replaceChildren(nativeConnectionCard(),chatToolsCard(),el("details",{class:"card"},[el("summary",{text:"Advanced: manual connections and Taskbar"}),el("div",{class:"psa-grid"},[connectionCard("psa"),connectionCard("taskbar")])]));
  }

  function draw() {
    if (disposed) return;
    drawTabs();
    if (mode === "connections") drawConnections();
    else if (mode === "outreach") drawOutreach();
    else if (mode === "actions") drawActions();
    else drawOverview();
  }

  async function openChat() {
    closeChat(); closeChat = () => {};
    const { session_id } = await api(BASE + "/chat", { method: "POST" });
    if (disposed) return;
    chatHost.hidden = false;
    chatHost.replaceChildren();
    const host = el("div", { class: "psa-chat-host" });
    chatHost.append(el("div", { class: "psa-column-head" }, [el("div", { class: "title", text: "Ask Kairos" }),
      button("Close", () => { closeChat(); closeChat = () => {}; chatHost.hidden = true; }, "quiet")]), host);
    closeChat = await mountSessionChat(host, { sessionId: session_id, title: "PSA Command", modelPicker: true,
      openInChats: true, placeholder: "Ask about the pipeline, overdue work or what to do next" });
    chatHost.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "nearest" });
  }

  actions.append(button("Refresh", () => load(true)), button("Ask Kairos", openChat, "primary"));
  await load(false);
  return () => { disposed = true; closeChat(); };
}
