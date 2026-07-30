# Kplusall

Cloudflare Worker เดียวสำหรับ LINE OA 5 พื้นที่: `north`, `isan`, `south`, `phitsanulok`, `korat`.

## ทรัพยากรที่สร้างแล้ว

- Worker: `kplusall`
- D1: `kplusall-db` (APAC)
- R2: `kplusall-slips` (รูปสลิปเป็น private bucket)
- PaddleOCR Queue: `kplusall-ocr-jobs` (พร้อมกันสูงสุด 5 งาน)
- OCR.space fallback Queue: `kplusall-ocr-fallback` (พร้อมกันสูงสุด 2 งาน)
- PaddleOCR AI Studio: `PaddleOCR-VL-1.6` (OCR หลัก)
- Workers AI Vision: `@cf/meta/llama-3.2-11b-vision-instruct`

## R2 retention

Bucket `kplusall-slips` uses the lifecycle rule
`kplusall-delete-slips-after-1-day`. The rule applies to every object and
expires stored LINE images after 1 day. Cloudflare may take up to approximately
24 additional hours to physically remove an expired object.

Processed images are deleted from R2 immediately. The daily scheduled cleanup
removes any temporary retry image older than 24 hours, and the bucket lifecycle
rule is a final safety net.

## Operational safety

- LINE receives HTTP 200 only after D1 persistence and Queue submission succeed.
- One TID has no application-level image-count limit.
- Images larger than 8 MiB are rejected before OCR and Workers AI.
- PaddleOCR ใช้ asynchronous job และ Queue ตรวจสถานะทุก 3 วินาที สูงสุด 6 รอบ.
- หาก PaddleOCR ผิดพลาด หมดเวลารอ หรือส่งผลที่ไม่มีข้อความ ระบบส่งต่อไป Queue แยกสำหรับ OCR.space.
- PaddleOCR ทำงานพร้อมกันสูงสุด 5 งาน แต่ OCR.space fallback ถูกจำกัดไว้สูงสุด 2 งาน เพื่อป้องกันคำขอพุ่งพร้อมกันเมื่อ PaddleOCR ขัดข้อง.
- OCR.space errors are retried once, for two attempts total.
- Result delivery uses the newest unused LINE Reply Token from the same
  region, conversation, sender, and TID. Token age is stored with the result,
  and the audit log records a warning at 50 seconds.
- Integration tests run in the Cloudflare Workers runtime with real local D1
  migrations, including latest-token selection, one-reply delivery, TID
  isolation, and atomic reservation of OCR request number 500.

ตรวจสอบกฎที่ใช้งานจริง:

```bash
npx wrangler r2 bucket lifecycle list kplusall-slips
```

## กฎ OCR ปัจจุบัน

1. รับเลขงาน 8 หลัก แยกตาม `region + ห้อง LINE + LINE user ID + Tid` และเก็บเลขงานล่าสุดไว้ 30 นาที.
2. รับรูปทุกใบที่ส่งต่อจากเลขงานเดียวกัน รวมถึงชุดรูปที่มี `message.imageSet`.
3. รูปแต่ละใบถูกส่งเข้าคิว แล้ว Worker ดาวน์โหลดจาก LINE และบันทึก private ใน R2 ก่อนตรวจ.
4. ใช้ PaddleOCR-VL-1.6 เป็นด่านแรก โดยส่งงานแล้วเก็บ `jobId` ใน D1 จากนั้น Queue ตรวจสถานะแบบหน่วงเวลา โดยไม่วนรอภายใน Worker.
5. หาก PaddleOCR ใช้งานไม่ได้หรือหมดเวลารอ งานจะถูกส่งเข้า `kplusall-ocr-fallback` แล้วใช้ OCR.space ของ region นั้นเป็นระบบสำรอง โดยมี concurrency สูงสุด 2.
   ระบบจองโควตาใน D1 ก่อนเรียก OCR แบบ atomic. เมื่อ Key ของ region ต้นทางครบ 500 ครั้ง ระบบจะยืม Key ของ region ที่เปิดใช้งานและมีจำนวนการใช้น้อยที่สุดก่อน โดยงานและ LINE OA ยังอยู่กับ region ต้นทางตามเดิม. ระบบหยุดเมื่อ Key ที่พร้อมใช้ทั้งหมดครบ 500 ครั้ง.
6. หลักฐาน `KPLUS`, `K+`, `THAIQR`, `Thai QR Payment` หรือ `QR PAYMENT` พร้อม `SETTLEMENT` และยอด `1.22` หรือ `-1.22` => `passed`.
7. หาก OCR หลักพบหลักฐานครบแต่ยังตัดสินไม่ได้ ระบบส่งรูปให้ Workers AI Vision ตรวจซ้ำ; รูปที่มีหลักฐานเพียงอย่างเดียวไม่ใช้ AI.
8. ระหว่างรับเลขงานและรับรูป ระบบไม่ส่งข้อความตอบรับ.
9. ระบบส่งผลผ่านหรือไม่ผ่านด้วย LINE Reply API เท่านั้น และใช้ D1 claim เพื่อไม่ตอบซ้ำแม้หลายรูปจบพร้อมกัน.
10. รูปที่เริ่มประมวลผลหลังงานแจ้งผลแล้วจะหยุดตรวจเพื่อประหยัดโควตา แต่ยังมีรายการใน Log.

## Log ในหน้า Control

- เลือกดูแยก 5 ภูมิภาค และแสดง 50 รายการล่าสุด.
- แสดงเวลา เลขงาน ลำดับรูปในชุด ผลการตรวจ ผู้ให้บริการ OCR ที่ใช้ ยอดที่พบ ความมั่นใจ เหตุผล และคำตอบบางส่วน.
- แสดงตัวนับ PaddleOCR, OCR.space และ Workers AI Vision ของวันปัจจุบันครบทั้ง 5 ภูมิภาค พร้อมยอดเรียก สำเร็จ และผิดพลาด.
- Log แสดง region เจ้าของงานและ region เจ้าของ OCR.space Key ที่ใช้จริงเมื่อมีการยืมโควต้าข้ามภูมิภาค.
- หน้าเว็บโหลด Log เมื่อเปิดหน้า เปลี่ยนภูมิภาค หรือกดปุ่มรีเฟรชเท่านั้น เพื่อไม่รบกวนระหว่างอ่านข้อมูล.
- เก็บ Log และข้อมูลงานย้อนหลัง 30 วัน แล้วลบอัตโนมัติทุกวันเวลา 01:17 น. ตามเวลาไทย.
- หน้า Log ใช้สิทธิ์ Admin เดียวกับหน้าตั้งค่า และไม่แสดง LINE User ID หรือ Secret.

## Deploy ครั้งแรก

```bash
npm install
npx wrangler d1 migrations apply kplusall-db --remote
npx wrangler deploy
```

ตั้ง Secrets ก่อนเปิดหน้า Control (อย่า commit ค่าเหล่านี้):

```bash
# สร้างค่า base64 random 32 bytes สำหรับเข้ารหัส config
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npx wrangler secret put CONFIG_ENCRYPTION_KEY
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put PADDLEOCR_TOKEN
```

สร้าง PaddleOCR token ใหม่ก่อนตั้ง Secret เพราะ token เดิมปรากฏในภาพแล้ว ระบบใช้โมเดล `PaddleOCR-VL-1.6` โดยค่าเริ่มต้น; หาก AI Studio เปลี่ยนชื่อโมเดล สามารถตั้งตัวแปร `PADDLEOCR_MODEL` ได้.

จากนั้นเปิด `https://kplusall.<your-subdomain>.workers.dev/admin` แล้ว login เพื่อกรอก LINE Channel Secret, Channel Access Token และ OCR.space API Key ของแต่ละภาค ระบบเก็บค่าที่เข้ารหัสใน D1 และไม่แสดงค่าเดิมกลับบนหน้าเว็บ

Webhook URL:

```text
/webhook/north
/webhook/isan
/webhook/south
/webhook/phitsanulok
/webhook/korat
```

ข้อมูลเดิมของ `central` ถูกใช้ต่อภายในสำหรับพิษณุโลก และข้อมูลเดิมของ `bangkok`
ถูกใช้ต่อภายในสำหรับโคราช เพื่อรักษา Secret, ประวัติ และตัวนับเดิมโดยไม่ย้ายข้อมูลเสี่ยงสูญหาย
เส้นทาง `/webhook/central` และ `/webhook/bangkok` ยังรองรับชั่วคราวระหว่างเปลี่ยนการตั้งค่า LINE OA

ระบบไม่ตอบรับตอนรับเลขงานหรือรูป และใช้ Reply API เท่านั้นสำหรับผลตรวจผ่านหรือไม่ผ่านหลัง Queue ประมวลผลเสร็จ.
