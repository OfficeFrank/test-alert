const $ = s => document.querySelector(s);
let payload = null;
let allSettings = { timeout: {}, banned: {} };
let selectedEvent = 'timeout';

const DEFAULT_APPEARANCE = {
  accent:'#53FC18',background:'#080A09',glow:'#163019',panel:'#111512',panel2:'#151B16',border:'#263127',text:'#F4F7F4',muted:'#8F9B91',danger:'#FF4057',
  radius:22,panelOpacity:93,glowStrength:100,gridOpacity:16,showGrid:true
};
let appearance={...DEFAULT_APPEARANCE};
const THEME_PRESETS={
  kick:{...DEFAULT_APPEARANCE},
  purple:{accent:'#8B5CF6',background:'#07050D',glow:'#24103D',panel:'#120D1C',panel2:'#1A1227',border:'#34254A',text:'#F7F3FF',muted:'#9B8FAA',danger:'#F43F5E'},
  gold:{accent:'#D4AF37',background:'#090806',glow:'#3B2B08',panel:'#17140C',panel2:'#211B0D',border:'#493A16',text:'#FFF9E8',muted:'#B8A878',danger:'#E5484D'},
  blue:{accent:'#3B82F6',background:'#05080F',glow:'#0A2550',panel:'#0D1421',panel2:'#111D30',border:'#233B5D',text:'#F1F7FF',muted:'#8EA1B8',danger:'#F43F5E'},
  red:{accent:'#EF4444',background:'#0B0606',glow:'#401010',panel:'#180D0D',panel2:'#221010',border:'#4A2424',text:'#FFF4F4',muted:'#B49393',danger:'#FB7185'}
};

function contrast(hex){
  const h=String(hex||'#000000').replace('#','');
  const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
  return ((r*299+g*587+b*114)/1000)>150?'#071006':'#FFFFFF';
}
function applyAppearance(a={}){
  appearance={...DEFAULT_APPEARANCE,...a};
  const r=document.documentElement.style;
  r.setProperty('--kick',appearance.accent);
  r.setProperty('--kick-contrast',contrast(appearance.accent));
  r.setProperty('--bg',appearance.background);
  r.setProperty('--glow',appearance.glow);
  r.setProperty('--panel',appearance.panel);
  r.setProperty('--panel2',appearance.panel2);
  r.setProperty('--line',appearance.border);
  r.setProperty('--text',appearance.text);
  r.setProperty('--muted',appearance.muted);
  r.setProperty('--danger',appearance.danger);
  r.setProperty('--danger-contrast',contrast(appearance.danger));
  r.setProperty('--radius',Math.round(Number(appearance.radius||22))+'px');
  r.setProperty('--panel-opacity',Math.round(Number(appearance.panelOpacity??93))+'%');
  r.setProperty('--glow-strength',Math.round(Number(appearance.glowStrength??100))+'%');
  r.setProperty('--grid-opacity',appearance.showGrid===false?'0':(Number(appearance.gridOpacity??16)/100).toFixed(2));
}
function fillAppearance(a={}){
  appearance={...DEFAULT_APPEARANCE,...a};
  const ids={themeAccent:'accent',themeBackground:'background',themeGlow:'glow',themePanel:'panel',themePanel2:'panel2',themeBorder:'border',themeText:'text',themeMuted:'muted',themeDanger:'danger',themeRadius:'radius',themePanelOpacity:'panelOpacity',themeGlowStrength:'glowStrength',themeGridOpacity:'gridOpacity'};
  for(const [id,key] of Object.entries(ids)){const el=$('#'+id);if(el)el.value=appearance[key]}
  $('#themeShowGrid').checked=appearance.showGrid!==false;
  updateAppearanceLabels();
  applyAppearance(appearance);
}
function collectAppearance(){
  return {accent:$('#themeAccent').value,background:$('#themeBackground').value,glow:$('#themeGlow').value,panel:$('#themePanel').value,panel2:$('#themePanel2').value,border:$('#themeBorder').value,text:$('#themeText').value,muted:$('#themeMuted').value,danger:$('#themeDanger').value,radius:Number($('#themeRadius').value),panelOpacity:Number($('#themePanelOpacity').value),glowStrength:Number($('#themeGlowStrength').value),gridOpacity:Number($('#themeGridOpacity').value),showGrid:$('#themeShowGrid').checked};
}
function updateAppearanceLabels(){
  $('#themeRadiusLabel').textContent=$('#themeRadius').value+'px';
  $('#themePanelOpacityLabel').textContent=$('#themePanelOpacity').value+'%';
  $('#themeGlowStrengthLabel').textContent=$('#themeGlowStrength').value+'%';
  $('#themeGridOpacityLabel').textContent=$('#themeGridOpacity').value+'%';
}
function previewAppearance(){updateAppearanceLabels();applyAppearance(collectAppearance())}

function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}
async function json(url,opts={}){const headers={...(opts.headers||{})};if(!(opts.body instanceof FormData))headers['Content-Type']='application/json';const r=await fetch(url,{...opts,headers});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'حدث خطأ');return d}
function eventLabel(){return selectedEvent==='banned'?'BANNED':'TIME OUT'}
function current(){return allSettings[selectedEvent]||{}}

function currentLibrary(){
  const list=current().mediaLibrary;
  return Array.isArray(list)?list:[];
}
function mediaIcon(item){return item?.mediaKind==='image'?'صورة':'فيديو'}
function renderMediaLibrary(){
  const box=$('#mediaLibrary'),empty=$('#mediaLibraryEmpty'),count=$('#mediaCount');
  if(!box||!empty||!count)return;
  const list=currentLibrary();
  count.textContent=list.length+' '+(list.length===1?'ملف':'ملفات');
  empty.classList.toggle('hidden',list.length>0);
  box.innerHTML=list.map(item=>{
    const safeName=String(item.name||'media').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const safeUrl=String(item.url||'').replace(/"/g,'&quot;');
    const preview=item.mediaKind==='image'?`<img src="${safeUrl}" alt="">`:`<div class="video-thumb"><span>▶</span></div>`;
    return `<article class="media-item" data-media-id="${item.id}"><div class="media-thumb">${preview}<span class="media-kind">${mediaIcon(item)}</span></div><div class="media-info"><b title="${safeName}">${safeName}</b><small>${item.mediaKind==='image'?'سيظهر كصورة':'سيعمل كمقطع'}</small></div><button class="media-delete" type="button" data-delete-media="${item.id}" title="حذف">×</button></article>`;
  }).join('');
  box.querySelectorAll('[data-delete-media]').forEach(btn=>btn.addEventListener('click',()=>deleteMedia(btn.dataset.deleteMedia)));
}
async function deleteMedia(id){
  if(!confirm('حذف هذا الملف من مكتبة '+eventLabel()+'؟'))return;
  try{
    const r=await json('/api/media-library/'+selectedEvent+'/'+encodeURIComponent(id),{method:'DELETE'});
    allSettings=r.settings||allSettings;
    renderMediaLibrary();
    toast('تم حذف الملف');
  }catch(e){toast(e.message)}
}

function updateRanges(){
  $('#durationLabel').textContent=(Number($('#durationMs').value)/1000).toFixed(1)+' ثانية';
  $('#soundDurationLabel').textContent=(Number($('#soundDurationMs').value)/1000).toFixed(1)+' ثانية';
  $('#volumeLabel').textContent=Math.round(Number($('#volume').value)*100)+'%';
  $('#fullscreenDimLabel').textContent=Math.round(Number($('#fullscreenDim').value)*100)+'%';
}

function chooseLayout(name){
  document.querySelectorAll('.layout-card').forEach(x=>x.classList.toggle('active',x.dataset.layout===name));
  if(!allSettings[selectedEvent])allSettings[selectedEvent]={};
  allSettings[selectedEvent].layoutMode=name;
  const mediaOnly=name==='media';
  const full=name==='fullscreen'||mediaOnly;
  $('#positionField').classList.toggle('disabled-field',full);
  $('#position').disabled=full;
  $('#fullscreenOptions').classList.toggle('inactive-panel',!full);
  $('#dimField').classList.toggle('hidden',mediaOnly);
}

function fmtTime(v){if(!v)return 'لم يصل شيء';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString('ar-SA')}

function fillDiagnostics(s){
  $('#diagWebhookUrl').textContent=s.webhookUrl||((s.appUrl||'')+'/webhooks/kick');
  $('#diagPublic').textContent=s.publicHttpsReady?'جاهز':'غير جاهز';
  $('#diagPublic').className=s.publicHttpsReady?'good':'bad';
  $('#diagSubscription').textContent=s.webhook?.subscribed?'موجود':'غير موجود';
  $('#diagSubscription').className=s.webhook?.subscribed?'good':'bad';
  $('#diagDelivery').textContent=fmtTime(s.webhook?.lastDeliveryAt);
  $('#diagEvent').textContent=s.webhook?.lastEventType||'لم يصل شيء';
  $('#diagAccepted').textContent=fmtTime(s.webhook?.lastEventAt);
  const h=$('#diagHint');h.className='diag-hint';
  if(!s.publicHttpsReady){h.textContent='APP_URL ليس HTTPS عام. Kick يحتاج رابط HTTPS عام ليستقبل الـWebhook.';h.classList.add('bad')}
  else if(!s.webhook?.subscribed){h.textContent='الرابط عام، لكن اشتراك moderation.banned غير مؤكد. اضغط إعادة الاشتراك ثم فحص الآن.';h.classList.add('bad')}
  else if(s.webhook?.lastRejectedReason){h.textContent='آخر ملاحظة من السيرفر: '+s.webhook.lastRejectedReason;h.classList.add('bad')}
  else if(s.webhook?.lastDeliveryAt){h.textContent='وصل طلب من Kick للسيرفر. رابط OBS الحالي سيعرض TIME OUT وBANNED حسب إعداد كل واحد.';h.classList.add('good')}
  else {h.textContent='الاشتراك موجود، لكن لم يصل أي Webhook للسيرفر حتى الآن.'}
}

function collectCurrent(){
  return {
    eventType:selectedEvent,
    layoutMode:current().layoutMode||'card',
    titleTemplate:$('#titleTemplate').value,
    subtitleTemplate:$('#subtitleTemplate').value,
    accent:$('#accent').value,
    position:$('#position').value,
    durationMs:Number($('#durationMs').value),
    soundDurationMs:Number($('#soundDurationMs').value),
    volume:Number($('#volume').value),
    showAvatar:$('#showAvatar').checked,
    showModerator:$('#showModerator').checked,
    showReason:$('#showReason').checked,
    showDuration:selectedEvent==='timeout' ? $('#showDuration').checked : false,
    customLogoUrl:$('#customLogoUrl').value.trim(),
    customSoundUrl:$('#customSoundUrl').value.trim(),
    fullscreenMediaUrl:$('#fullscreenMediaUrl').value.trim(),
    fullscreenDim:Number($('#fullscreenDim').value),
    videoMuted:$('#videoMuted').checked
  };
}

function stashCurrent(){
  if(!payload)return;
  allSettings[selectedEvent]={...current(),...collectCurrent()};
}

function fillEvent(){
  const s=current();
  $('#titleTemplate').value=s.titleTemplate||'';
  $('#subtitleTemplate').value=s.subtitleTemplate||'';
  $('#accent').value=s.accent||'#53FC18';
  $('#position').value=s.position||'center';
  $('#durationMs').value=s.durationMs||6500;
  $('#soundDurationMs').value=s.soundDurationMs||6500;
  $('#volume').value=s.volume??.75;
  $('#showAvatar').checked=s.showAvatar!==false;
  $('#showModerator').checked=s.showModerator!==false;
  $('#showReason').checked=s.showReason!==false;
  $('#showDuration').checked=selectedEvent==='timeout' && s.showDuration!==false;
  $('#showDurationWrap').classList.toggle('hidden',selectedEvent==='banned');
  $('#customLogoUrl').value=s.customLogoUrl||'';
  $('#customSoundUrl').value=s.customSoundUrl||'';
  $('#fullscreenMediaUrl').value=s.fullscreenMediaUrl||s.fullscreenBackgroundUrl||'';
  $('#fullscreenDim').value=s.fullscreenDim??.35;
  $('#videoMuted').checked=s.videoMuted!==false;
  chooseLayout(s.layoutMode||'card');
  updateRanges();

  const label=eventLabel();
  $('#layoutHeading').textContent='طريقة ظهور '+label;
  $('#settingsHeading').textContent='إعدادات '+label;
  $('#saveBtn').textContent='حفظ إعدادات '+label;
  $('#testBtn').textContent='تجربة أليرت '+label;
  $('#mediaLibraryHeading').textContent='مكتبة مقاطع '+label;
  document.querySelectorAll('.event-tab').forEach(x=>x.classList.toggle('active',x.dataset.event===selectedEvent));
  renderMediaLibrary();
}

function fill(s){
  payload=s;
  allSettings=s.settings||allSettings;
  fillAppearance(s.appearance||appearance);
  $('#overlayUrl').value=s.overlayUrl;
  $('#ownerName').textContent=s.owner?.name||'Kick User';
  $('#ownerId').textContent='User ID: '+(s.owner?.user_id||'');
  $('#ownerAvatar').src=s.owner?.profile_picture||'https://kick.com/img/default-profile-pictures/default2.jpeg';
  $('#webhookText').textContent=s.webhook?.subscriptionMessage||'غير معروف';
  $('#webhookStatus').classList.toggle('ok',!!s.webhook?.subscribed);
  fillDiagnostics(s);
  fillEvent();
}

async function load(){
  const st=await json('/api/status');
  applyAppearance(st.appearance||appearance);
  $('#connectionPill').textContent=st.connected?'Kick مربوط':'غير مربوط';
  $('#connectionPill').classList.toggle('online',st.connected);
  $('#connectionPill').classList.toggle('offline',!st.connected);
  if(!st.configured)$('#connectText').textContent='بيانات تطبيق Kick غير موجودة في Render Environment.';
  if(st.authenticated){
    $('#connectCard').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#eventSwitcher').classList.remove('hidden');
    fill(await json('/api/settings'));
  }else if(st.connected){
    $('#connectText').textContent='القناة مربوطة على السيرفر. اضغط دخول Kick لفتح لوحة التحكم.';
    $('#connectBtn').textContent='دخول Kick';
  }
}

document.querySelectorAll('.event-tab').forEach(b=>b.addEventListener('click',()=>{
  if(b.dataset.event===selectedEvent)return;
  stashCurrent();
  selectedEvent=b.dataset.event;
  fillEvent();
}));
document.querySelectorAll('.layout-card').forEach(b=>b.addEventListener('click',()=>chooseLayout(b.dataset.layout)));

$('#durationMs').addEventListener('input',updateRanges);
$('#soundDurationMs').addEventListener('input',updateRanges);
$('#volume').addEventListener('input',updateRanges);
$('#fullscreenDim').addEventListener('input',updateRanges);

$('#copyBtn').addEventListener('click',async()=>{await navigator.clipboard.writeText($('#overlayUrl').value);toast('تم نسخ رابط OBS')});

$('#saveBtn').addEventListener('click',async()=>{
  try{
    const body=collectCurrent();
    const updated=await json('/api/settings',{method:'POST',body:JSON.stringify(body)});
    payload={...payload,...updated};
    allSettings=updated.settings||allSettings;
    fillEvent();
    toast('تم حفظ إعدادات '+eventLabel());
  }catch(e){toast(e.message)}
});

$('#testBtn').addEventListener('click',async()=>{
  try{
    await json('/api/test-alert',{method:'POST',body:JSON.stringify({type:selectedEvent})});
    toast('تم إرسال أليرت '+eventLabel()+' تجريبي');
  }catch(e){toast(e.message)}
});

$('#subscribeBtn').addEventListener('click',async()=>{
  try{
    const r=await json('/api/subscribe',{method:'POST',body:'{}'});
    $('#webhookText').textContent=r.webhook.subscriptionMessage;
    $('#webhookStatus').classList.toggle('ok',!!r.webhook.subscribed);
    payload.webhook=r.webhook;
    fillDiagnostics(payload);
    toast('تم تحديث الاشتراك');
  }catch(e){toast(e.message)}
});

$('#diagnosticsBtn').addEventListener('click',async()=>{
  try{
    const r=await json('/api/diagnostics',{method:'POST',body:'{}'});
    payload={...payload,...r,webhook:r.webhook};
    fillDiagnostics(payload);
    $('#webhookText').textContent=r.webhook?.subscriptionMessage||'غير معروف';
    $('#webhookStatus').classList.toggle('ok',!!r.webhook?.subscribed);
    toast(r.error?'الفحص تم مع ملاحظة':'تم الفحص');
  }catch(e){toast(e.message)}
});

document.querySelectorAll('[data-upload]').forEach(btn=>btn.addEventListener('click',async()=>{
  const kind=btn.dataset.upload;
  const map={logo:$('#logoFile'),sound:$('#soundFile')};
  const input=map[kind];
  if(!input?.files[0])return toast('اختر ملف أولاً');
  const fd=new FormData();
  fd.append('file',input.files[0]);
  fd.append('kind',kind);
  btn.disabled=true;
  const old=btn.textContent;
  btn.textContent='جاري الرفع...';
  try{
    const r=await fetch('/api/upload',{method:'POST',body:fd});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'فشل الرفع');
    if(kind==='logo')$('#customLogoUrl').value=d.url;
    if(kind==='sound')$('#customSoundUrl').value=d.url;
    toast('تم رفع الملف — اضغط حفظ');
  }catch(e){toast(e.message)}
  finally{btn.disabled=false;btn.textContent=old}
}));

$('#uploadMediaLibraryBtn').addEventListener('click',async()=>{
  const input=$('#fullscreenMediaFiles');
  const files=[...(input.files||[])];
  if(!files.length)return toast('اختر ملف واحد أو أكثر أولاً');
  const fd=new FormData();
  files.forEach(file=>fd.append('files',file));
  const btn=$('#uploadMediaLibraryBtn');
  const old=btn.textContent;
  btn.disabled=true;btn.textContent='جاري رفع '+files.length+' ملف...';
  try{
    const r=await fetch('/api/media-library/'+selectedEvent,{method:'POST',body:fd});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||'فشل رفع الملفات');
    allSettings=d.settings||allSettings;
    input.value='';
    renderMediaLibrary();
    toast('تمت إضافة '+files.length+' ملفات إلى '+eventLabel());
  }catch(e){toast(e.message)}
  finally{btn.disabled=false;btn.textContent=old}
});


document.querySelectorAll('#appearancePanel input').forEach(el=>el.addEventListener('input',previewAppearance));
$('#themeShowGrid').addEventListener('change',previewAppearance);
document.querySelectorAll('[data-theme-preset]').forEach(btn=>btn.addEventListener('click',()=>{
  const preset=THEME_PRESETS[btn.dataset.themePreset];
  if(!preset)return;
  fillAppearance({...appearance,...preset});
  toast('تم تطبيق القالب كمعاينة — اضغط حفظ لتثبيته');
}));
$('#saveAppearanceBtn').addEventListener('click',async()=>{
  try{
    const body=collectAppearance();
    const r=await json('/api/appearance',{method:'POST',body:JSON.stringify(body)});
    fillAppearance(r.appearance||body);
    toast('تم حفظ مظهر الموقع');
  }catch(e){toast(e.message)}
});
$('#resetAppearanceBtn').addEventListener('click',async()=>{
  if(!confirm('استرجاع ألوان وشكل الموقع الافتراضي؟'))return;
  try{
    const r=await json('/api/appearance',{method:'POST',body:JSON.stringify(DEFAULT_APPEARANCE)});
    fillAppearance(r.appearance||DEFAULT_APPEARANCE);
    toast('تم استرجاع المظهر الافتراضي');
  }catch(e){toast(e.message)}
});

load().catch(e=>toast(e.message));
