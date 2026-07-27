# Kplusall

Cloudflare Worker เดียวสำหรับ LINE OA 5 ภูมิภาค: `north`, `central`, `isan`, `south`, `bangkok`.

## ทรัพยากรที่สร้างแล้ว

- Worker: `kplusall`
- D1: `kplusall-db` (APAC)
- R2: `kplusall-slips` (รูปสลิปเป็น private bucket)
- Queue: `kplusall-ocr-jobs`

## R2 retention

Bucket `kplusall-slips` uses the lifecycle rule
`kplusall-delete-slips-after-1-day`. The rule applies to every object and
expires stored LINE images after 1 day. Cloudflare may take up to approximately
24 additional hours to physically remove an expired object.

ตรวจสอบกฎที่ใช้งานจริง:

```bash
npx wrangler r2 bucket lifecycle list kplusall-slips
```

## กฎ OCR ปัจจุบัน

1. รับเลขงาน 8 หลัก แยกตาม `region + LINE user ID`.
2. รูปถูกบันทึก private ใน R2 แล้วส่งเข้าคิว.
3. ใช้ OCR.space ของ region นั้นเท่านั้น.
4. มี `KPLUS` และ `SETTLEMENT` และพบ `1.22` หรือ `-1.22` => `passed`.
5. ขาด `KPLUS` หรือ `SETTLEMENT` => `silent` (ไม่ตอบ).
6. มีทั้งสองคำแต่ยอดไม่ตรง => `needs_fallback` (ยังไม่เรียก provider อื่น).
7. ระหว่างรับเลขงานและรับรูป ระบบไม่ส่งข้อความตอบรับ.
8. ระบบส่ง LINE Push Flex Message เฉพาะเมื่อตรวจผ่าน เพื่อไม่ตอบซ้ำในงานเดียวกัน.

## Log ในหน้า Control

- เลือกดูแยก 5 ภูมิภาค และแสดง 50 รายการล่าสุด.
- แสดงเวลา เลขงาน ผลการตรวจ ผู้ให้บริการ OCR คำที่พบ ยอดที่พบ เหตุผล และข้อความ OCR บางส่วน.
- หน้าเว็บรีเฟรช Log อัตโนมัติทุก 30 วินาที.
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

ระบบไม่ตอบรับตอนรับเลขงานหรือรูป และใช้ Push API ส่งเฉพาะผลตรวจที่ผ่านหลัง Queue ประมวลผลเสร็จ.
