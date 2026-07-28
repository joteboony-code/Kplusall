# Kplusall

Cloudflare Worker เดียวสำหรับ LINE OA 5 ภูมิภาค: `north`, `central`, `isan`, `south`, `bangkok`.

## ทรัพยากรที่สร้างแล้ว

- Worker: `kplusall`
- D1: `kplusall-db` (APAC)
- R2: `kplusall-slips` (รูปสลิปเป็น private bucket)
- Queue: `kplusall-ocr-jobs`
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
- One TID accepts at most 13 images.
- Images larger than 5 MiB are rejected before OCR and Workers AI.
- OCR.space errors are retried once, for two attempts total.

ตรวจสอบกฎที่ใช้งานจริง:

```bash
npx wrangler r2 bucket lifecycle list kplusall-slips
```

## กฎ OCR ปัจจุบัน

1. รับเลขงาน 8 หลัก แยกตาม `region + ห้อง LINE + LINE user ID + Tid` และเก็บเลขงานล่าสุดไว้ 30 นาที.
2. รับรูปทุกใบที่ส่งต่อจากเลขงานเดียวกัน รวมถึงชุดรูปที่มี `message.imageSet`.
3. รูปแต่ละใบถูกส่งเข้าคิว แล้ว Worker ดาวน์โหลดจาก LINE และบันทึก private ใน R2 ก่อนตรวจ.
4. ใช้ OCR.space ของ region นั้นเป็นด่านแรก.
   ระบบจองโควตาใน D1 ก่อนเรียก OCR และหยุดอัตโนมัติที่ 500 รูปต่อภูมิภาคต่อวัน.
5. หลักฐาน `KPLUS`, `K+`, `THAIQR`, `Thai QR Payment` หรือ `QR PAYMENT` พร้อม `SETTLEMENT` และยอด `1.22` หรือ `-1.22` => `passed`.
6. หาก OCR.space ตัดสินไม่ได้แต่พบ KPLUS/K+ หรือ `SETTLEMENT` อย่างน้อยหนึ่งอย่าง ระบบส่งรูปนั้นให้ Workers AI Vision ตรวจซ้ำ; รูปที่ไม่มีหลักฐานทั้งสองอย่างไม่ใช้ AI.
7. Workers AI Vision ถอดเฉพาะข้อความที่มองเห็นเหมือนระบบ Kplus122 เดิม แล้วกฎ deterministic รวมหลักฐานกับ OCR.space; AI ไม่มีสิทธิ์ลบผลที่ OCR.space ยืนยันแล้ว. ยอด `1.22`/`-1.22` => `passed`, ยอดอื่นที่อ่านชัด => `failed`, หลักฐานไม่ครบ => `needs_fallback`.
8. ระหว่างรับเลขงานและรับรูป ระบบไม่ส่งข้อความตอบรับ.
9. ระบบส่งผลผ่านหรือไม่ผ่านด้วย LINE Reply API เท่านั้น และใช้ D1 claim เพื่อไม่ตอบซ้ำแม้หลายรูปจบพร้อมกัน.
10. รูปที่เริ่มประมวลผลหลังงานแจ้งผลแล้วจะหยุดตรวจเพื่อประหยัดโควตา แต่ยังมีรายการใน Log.

## Log ในหน้า Control

- เลือกดูแยก 5 ภูมิภาค และแสดง 50 รายการล่าสุด.
- แสดงเวลา เลขงาน ลำดับรูปในชุด ผลการตรวจ ผลแยกของ OCR.space/Workers AI Vision ยอดที่พบ ความมั่นใจ เหตุผล และคำตอบบางส่วน.
- แสดงตัวนับ OCR.space และ Workers AI Vision ของวันปัจจุบันครบทั้ง 5 ภูมิภาค พร้อมยอดเรียก สำเร็จ และผิดพลาด.
- หน้าเว็บโหลด Log เมื่อเปิดหน้า เปลี่ยนภูมิภาค หรือกดปุ่มรีเฟรชเท่านั้น เพื่อไม่รบกวนระหว่างอ่านข้อมูล.
- เก็บ Log และข้อมูลงานย้อนหลัง 30 วัน แล้วลบอัตโนมัติทุกวันเวลา 01:17 น. ตามเวลาไทย.
- หน้า Log ใช้สิทธิ์ Admin เดียวกับหน้าตั้งค่า และไม่แสดง LINE User ID หรือ Secret.

## Deploy ครั้งแรก

```bash
npm install
npx wrangler d1 migrations apply kplusall-db --remote
npx wrangler deploy
```

ตั้ง Secrets สองตัวก่อนเปิดหน้า Control (อย่า commit ค่าเหล่านี้):

```bash
# สร้างค่า base64 random 32 bytes สำหรับเข้ารหัส config
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npx wrangler secret put CONFIG_ENCRYPTION_KEY
npx wrangler secret put ADMIN_PASSWORD
```

จากนั้นเปิด `https://kplusall.<your-subdomain>.workers.dev/admin` แล้ว login เพื่อกรอก LINE Channel Secret, Channel Access Token และ OCR.space API Key ของแต่ละภาค ระบบเก็บค่าที่เข้ารหัสใน D1 และไม่แสดงค่าเดิมกลับบนหน้าเว็บ

Webhook URL:

```text
/webhook/north
/webhook/central
/webhook/isan
/webhook/south
/webhook/bangkok
```

ระบบไม่ตอบรับตอนรับเลขงานหรือรูป และใช้ Reply API เท่านั้นสำหรับผลตรวจผ่านหรือไม่ผ่านหลัง Queue ประมวลผลเสร็จ.
