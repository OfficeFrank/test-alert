# Kick Timeout Alert Studio v2

موقع يربط حسابك في **Kick** ويعرض أليرت تلقائي في OBS عندما يحصل شخص على **Timeout** في قناتك.

## الجديد في v2

- وضع **Alert عادي** مثل الكرت السابق.
- وضع **شاشة كاملة Fullscreen** يغطي 1920×1080 وقت التايم أوت.
- خلفية مخصصة للشاشة الكاملة + التحكم بالتعتيم.
- صفحة تشخيص داخل لوحة التحكم توضّح:
  - هل `APP_URL` رابط HTTPS عام أو localhost.
  - هل اشتراك `moderation.banned` موجود فعلاً في Kick.
  - آخر Webhook وصل للسيرفر.
  - آخر Event وصل.
  - آخر Timeout تم عرضه.
- بعد إنشاء الاشتراك، الموقع يعمل `GET /events/subscriptions` للتأكد أن Kick سجله فعلياً.

## مهم جداً: لماذا Test Alert يعمل لكن التايم أوت الحقيقي لا يظهر؟

إذا كان ملف `.env` يحتوي:

```env
APP_URL=http://localhost:3000
```

فـ **زر Test Alert سيعمل في OBS** لأن OBS والموقع على نفس جهازك، لكن **Kick لا يستطيع إرسال Webhook إلى localhost الموجود على جهازك**.

للتشغيل الحقيقي تحتاج واحداً من التالي:

1. تنشر المشروع على استضافة لها رابط HTTPS عام مثل Render/VPS.
2. أو تستخدم Tunnel عام مثل Cloudflare Tunnel / ngrok أثناء تشغيله على جهازك.

بعد أن تحصل على رابط عام مثل:

```text
https://my-timeout-alert.example.com
```

ضع في `.env`:

```env
APP_URL=https://my-timeout-alert.example.com
```

وفي تطبيق Kick Developer احفظ:

```text
Redirect URI:
https://my-timeout-alert.example.com/auth/kick/callback

Webhook URL:
https://my-timeout-alert.example.com/webhooks/kick
```

ثم أعد تشغيل الموقع، أعد ربط Kick، واضغط **إعادة الاشتراك** ثم **فحص الآن**.

## تشغيل محلي للتجربة

انسخ `.env.example` إلى `.env`:

```env
PORT=3000
APP_URL=http://localhost:3000
KICK_CLIENT_ID=YOUR_KICK_APP_CLIENT_ID
KICK_CLIENT_SECRET=YOUR_KICK_APP_CLIENT_SECRET
SESSION_SECRET=CHANGE_ME_TO_A_LONG_RANDOM_STRING
APP_ENCRYPTION_KEY=CHANGE_ME_TO_ANOTHER_LONG_RANDOM_STRING
ALLOW_UNVERIFIED_WEBHOOKS=0
```

ثم:

```bash
npm install
npm start
```

وافتح:

```text
http://localhost:3000
```

## OBS

خذ رابط الأوفرلاي من لوحة التحكم ثم:

```text
OBS → Sources → Browser
Width: 1920
Height: 1080
```

استخدم **تجربة أليرت Timeout** للتأكد أن Browser Source متصل.

## كيف يكتشف Timeout؟

المشروع يشترك رسمياً في:

```text
moderation.banned v1
```

إذا كان `metadata.expires_at` موجوداً فهو Timeout مؤقت ويظهر الأليرت. إذا كان `null` فهو Ban دائم ولا يظهر.

## التشخيص

من لوحة التحكم اضغط **فحص الآن**.

- `HTTPS عام = غير جاهز`: التايم أوت الحقيقي لن يصل من Kick.
- `اشتراك Kick = غير موجود`: اضغط إعادة الاشتراك.
- `آخر طلب من Kick = لم يصل شيء`: Kick لم يرسل أي Webhook إلى هذا السيرفر حتى الآن، أو Webhook URL في تطبيق Kick غير صحيح/غير متاح.
- إذا وصل Event ولكن لا يظهر في OBS: تأكد أن OBS يستخدم آخر رابط Overlay وأن Browser Source مفتوح.

## أمان

لا تشارك `KICK_CLIENT_SECRET` أو ملف `.env`. اترك:

```env
ALLOW_UNVERIFIED_WEBHOOKS=0
```

في الاستخدام الحقيقي.
