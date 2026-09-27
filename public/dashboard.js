const $ = s => document.querySelector(s);
let payload = null;
let allSettings = { timeout: {}, banned: {} };
let selectedEvent = 'timeout';

function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}
async function json(url,opts={}){const headers={...(opts.headers||{})};if(!(opts.body instanceof FormData))headers['Content-Type']='application/json';const r=await fetch(url,{...opts,headers});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'حدث خطأ');return d}
function eventLabel(){return selectedEvent==='banned'?'BANNED':'TIME OUT'}
function current(){return allSettings[selectedEvent]||{}}

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
  document.querySelectorAll('.event-tab').forEach(x=>x.classList.toggle('active',x.dataset.event===selectedEvent));
}

function fill(s){
  payload=s;
  allSettings=s.settings||allSettings;
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

$('#regenerateBtn').addEventListener('click',async()=>{
  if(!confirm('الرابط القديم سيتوقف. متأكد؟'))return;
  try{
    const r=await json('/api/regenerate-overlay-token',{method:'POST',body:'{}'});
    $('#overlayUrl').value=r.overlayUrl;
    toast('تم إنشاء رابط جديد');
  }catch(e){toast(e.message)}
});

document.querySelectorAll('[data-upload]').forEach(btn=>btn.addEventListener('click',async()=>{
  const kind=btn.dataset.upload;
  const map={logo:$('#logoFile'),sound:$('#soundFile'),fullscreenMedia:$('#fullscreenMediaFile')};
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
    if(kind==='fullscreenMedia')$('#fullscreenMediaUrl').value=d.url;
    toast('تم رفع الملف — اضغط حفظ');
  }catch(e){toast(e.message)}
  finally{btn.disabled=false;btn.textContent=old}
}));

load().catch(e=>toast(e.message));
