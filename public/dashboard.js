const $ = s => document.querySelector(s);
let settings = null;

function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400)}
async function json(url,opts={}){const headers={...(opts.headers||{})};if(!(opts.body instanceof FormData))headers['Content-Type']='application/json';const r=await fetch(url,{...opts,headers});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'حدث خطأ');return d}
function updateRanges(){
  $('#durationLabel').textContent=(Number($('#durationMs').value)/1000).toFixed(1)+' ثانية';
  $('#volumeLabel').textContent=Math.round(Number($('#volume').value)*100)+'%';
  $('#fullscreenDimLabel').textContent=Math.round(Number($('#fullscreenDim').value)*100)+'%';
}
function chooseTheme(name){document.querySelectorAll('.theme-card').forEach(x=>x.classList.toggle('active',x.dataset.theme===name));settings.theme=name}
function chooseLayout(name){
  document.querySelectorAll('.layout-card').forEach(x=>x.classList.toggle('active',x.dataset.layout===name));
  settings.layoutMode=name;
  $('#positionField').style.opacity=name==='fullscreen'?'.45':'1';
  $('#position').disabled=name==='fullscreen';
  $('#fullscreenOptions').style.opacity=name==='fullscreen'?'1':'.72';
}
function fmtTime(v){if(!v)return 'لم يصل شيء';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString('ar-SA')}
function fillDiagnostics(s){
  $('#diagWebhookUrl').textContent=s.webhookUrl||s.appUrl+'/webhooks/kick';
  $('#diagPublic').textContent=s.publicHttpsReady?'جاهز':'غير جاهز';
  $('#diagPublic').className=s.publicHttpsReady?'good':'bad';
  $('#diagSubscription').textContent=s.webhook?.subscribed?'موجود':'غير موجود';
  $('#diagSubscription').className=s.webhook?.subscribed?'good':'bad';
  $('#diagDelivery').textContent=fmtTime(s.webhook?.lastDeliveryAt);
  $('#diagEvent').textContent=s.webhook?.lastEventType||'لم يصل شيء';
  $('#diagAccepted').textContent=fmtTime(s.webhook?.lastEventAt);
  const h=$('#diagHint');
  h.className='diag-hint';
  if(!s.publicHttpsReady){h.textContent='المشكلة الأساسية: APP_URL ليس HTTPS عام. localhost يعمل لزر Test فقط، لكن Kick لا يستطيع إرسال Webhook لجهازك مباشرة.';h.classList.add('bad')}
  else if(!s.webhook?.subscribed){h.textContent='الرابط عام، لكن اشتراك moderation.banned غير مؤكد. اضغط إعادة الاشتراك ثم فحص الآن.';h.classList.add('bad')}
  else if(s.webhook?.lastRejectedReason){h.textContent='آخر ملاحظة من السيرفر: '+s.webhook.lastRejectedReason;h.classList.add('bad')}
  else if(s.webhook?.lastDeliveryAt){h.textContent='وصل طلب من Kick للسيرفر. إذا لم يظهر في OBS تأكد أن Browser Source مفتوح على نفس رابط الأوفرلاي الجديد.';h.classList.add('good')}
  else {h.textContent='الاشتراك موجود، لكن ما وصل أي Webhook للسيرفر حتى الآن. جرّب Timeout جديد بعد التأكد أن Webhook URL محفوظ في تطبيق Kick.'}
}
function fill(s){
  settings=s;
  $('#overlayUrl').value=s.overlayUrl;
  $('#titleTemplate').value=s.titleTemplate;
  $('#subtitleTemplate').value=s.subtitleTemplate;
  $('#accent').value=s.accent;
  $('#position').value=s.position;
  $('#durationMs').value=s.durationMs;
  $('#volume').value=s.volume;
  $('#showAvatar').checked=s.showAvatar;
  $('#showModerator').checked=s.showModerator;
  $('#showReason').checked=s.showReason;
  $('#showDuration').checked=s.showDuration;
  $('#customLogoUrl').value=s.customLogoUrl||'';
  $('#customSoundUrl').value=s.customSoundUrl||'';
  $('#fullscreenBackgroundUrl').value=s.fullscreenBackgroundUrl||'';
  $('#fullscreenDim').value=s.fullscreenDim??.68;
  chooseTheme(s.theme);
  chooseLayout(s.layoutMode||'card');
  updateRanges();
  $('#ownerName').textContent=s.owner?.name||'Kick User';
  $('#ownerId').textContent='User ID: '+(s.owner?.user_id||'');
  $('#ownerAvatar').src=s.owner?.profile_picture||'https://kick.com/img/default-profile-pictures/default2.jpeg';
  $('#webhookText').textContent=s.webhook?.subscriptionMessage||'غير معروف';
  $('#webhookStatus').classList.toggle('ok',!!s.webhook?.subscribed);
  $('#localWarning').classList.toggle('hidden',!!s.publicHttpsReady);
  fillDiagnostics(s);
}
function collect(){return{
  theme:settings.theme,
  layoutMode:settings.layoutMode||'card',
  titleTemplate:$('#titleTemplate').value,
  subtitleTemplate:$('#subtitleTemplate').value,
  accent:$('#accent').value,
  position:$('#position').value,
  durationMs:Number($('#durationMs').value),
  volume:Number($('#volume').value),
  showAvatar:$('#showAvatar').checked,
  showModerator:$('#showModerator').checked,
  showReason:$('#showReason').checked,
  showDuration:$('#showDuration').checked,
  customLogoUrl:$('#customLogoUrl').value.trim(),
  customSoundUrl:$('#customSoundUrl').value.trim(),
  fullscreenBackgroundUrl:$('#fullscreenBackgroundUrl').value.trim(),
  fullscreenDim:Number($('#fullscreenDim').value)
}}
async function load(){
  const st=await json('/api/status');
  $('#connectionPill').textContent=st.connected?'Kick مربوط':'غير مربوط';
  $('#connectionPill').classList.toggle('online',st.connected);
  $('#connectionPill').classList.toggle('offline',!st.connected);
  if(!st.configured)$('#connectText').textContent='بيانات تطبيق Kick غير موجودة في .env. راجع README أولاً.';
  if(st.authenticated){$('#connectCard').classList.add('hidden');$('#app').classList.remove('hidden');fill(await json('/api/settings'))}
  else if(st.connected){$('#connectText').textContent='القناة مربوطة على السيرفر. اضغط دخول Kick لفتح لوحة التحكم.';$('#connectBtn').textContent='دخول Kick'}
}

document.querySelectorAll('.theme-card').forEach(b=>b.addEventListener('click',()=>chooseTheme(b.dataset.theme)));
document.querySelectorAll('.layout-card').forEach(b=>b.addEventListener('click',()=>chooseLayout(b.dataset.layout)));
$('#durationMs').addEventListener('input',updateRanges);$('#volume').addEventListener('input',updateRanges);$('#fullscreenDim').addEventListener('input',updateRanges);
$('#copyBtn').addEventListener('click',async()=>{await navigator.clipboard.writeText($('#overlayUrl').value);toast('تم نسخ رابط OBS')});
$('#saveBtn').addEventListener('click',async()=>{try{fill(await json('/api/settings',{method:'POST',body:JSON.stringify(collect())}));toast('تم الحفظ')}catch(e){toast(e.message)}});
$('#testBtn').addEventListener('click',async()=>{try{await json('/api/test-alert',{method:'POST',body:JSON.stringify({})});toast('تم إرسال أليرت تجريبي')}catch(e){toast(e.message)}});
$('#subscribeBtn').addEventListener('click',async()=>{try{const r=await json('/api/subscribe',{method:'POST',body:'{}'});$('#webhookText').textContent=r.webhook.subscriptionMessage;$('#webhookStatus').classList.toggle('ok',!!r.webhook.subscribed);settings.webhook=r.webhook;fillDiagnostics(settings);toast('تم تحديث الاشتراك')}catch(e){toast(e.message)}});
$('#diagnosticsBtn').addEventListener('click',async()=>{try{const r=await json('/api/diagnostics',{method:'POST',body:'{}'});settings={...settings,...r,webhook:r.webhook};fillDiagnostics(settings);$('#webhookText').textContent=r.webhook?.subscriptionMessage||'غير معروف';$('#webhookStatus').classList.toggle('ok',!!r.webhook?.subscribed);toast(r.error?'الفحص تم مع ملاحظة':'تم الفحص')}catch(e){toast(e.message)}});
$('#regenerateBtn').addEventListener('click',async()=>{if(!confirm('الرابط القديم سيتوقف. متأكد؟'))return;try{const r=await json('/api/regenerate-overlay-token',{method:'POST',body:'{}'});$('#overlayUrl').value=r.overlayUrl;toast('تم إنشاء رابط جديد')}catch(e){toast(e.message)}});

document.querySelectorAll('[data-upload]').forEach(btn=>btn.addEventListener('click',async()=>{
  const kind=btn.dataset.upload;
  const map={logo:$('#logoFile'),sound:$('#soundFile'),background:$('#backgroundFile')};
  const input=map[kind];
  if(!input?.files[0])return toast('اختر ملف أولاً');
  const fd=new FormData();fd.append('file',input.files[0]);
  const r=await fetch('/api/upload',{method:'POST',body:fd});const d=await r.json();
  if(!r.ok)return toast(d.error||'فشل الرفع');
  if(kind==='logo')$('#customLogoUrl').value=d.url;
  if(kind==='sound')$('#customSoundUrl').value=d.url;
  if(kind==='background')$('#fullscreenBackgroundUrl').value=d.url;
  toast('تم رفع الملف — اضغط حفظ');
}));
load().catch(e=>toast(e.message));
