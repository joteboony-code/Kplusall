import { describe, expect, it } from "vitest";
import { dashboardHtml, encryptionKeyBytes, loginHtml } from "../src/index";

describe("control dashboard", () => {
  it("ships syntactically valid client JavaScript", () => {
    const html = dashboardHtml();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
  });

  it("binds save actions without inline JavaScript quoting", () => {
    const html = dashboardHtml();

    expect(html).toContain('class="save-region"');
    expect(html).not.toContain("onclick=");
  });

  it("shows copyable webhook URLs for all five public areas", () => {
    const html = dashboardHtml();

    for (const path of ["north", "isan", "south", "phitsanulok", "korat"]) {
      expect(html).toContain(`path:'${path}'`);
    }
    expect(html).toContain('class="copy-webhook"');
    expect(html).toContain("navigator.clipboard.writeText");
    expect(html).toContain("location.origin+'/webhook/'");
  });

  it("renders the five-region summary and responsive themed controls", () => {
    const html = dashboardHtml();

    expect(html).toContain("ศูนย์จัดการ LINE OA, PaddleOCR, OCR.space และ Workers AI");
    expect(html).toContain('id="active-count"');
    expect(html).toContain("ภาคเหนือ");
    expect(html).toContain("พิษณุโลก");
    expect(html).toContain("โคราช");
    expect(html).not.toContain("ภาคกลาง");
    expect(html).not.toContain("กรุงเทพฯ");
    expect(html).toContain("@media(max-width:760px)");
  });

  it("renders regional OCR logs with result details and refresh controls", () => {
    const html = dashboardHtml();

    expect(html).toContain("ประวัติการตรวจ OCR");
    expect(html).toContain('id="log-tabs"');
    expect(html).toContain('id="refresh-logs"');
    expect(html).toContain('id="requeue-stuck"');
    expect(html).toContain("/admin/api/requeue-stuck");
    expect(html).toContain("/admin/api/logs?region=");
    expect(html).toContain("/admin/api/usage?region=");
    expect(html).toContain("/admin/api/usage-summary");
    expect(html).toContain('id="usage-summary"');
    expect(html).toContain('id="ocr-usage-grid"');
    expect(html).toContain("การใช้งาน OCR วันนี้");
    expect(html).toContain("PaddleOCR เป็นตัวหลัก · OCR.space เป็นระบบสำรอง");
    expect(html).toContain("Workers AI Vision");
    expect(html).toContain("ตรวจด้วย:");
    expect(html).toContain("provider.split('+')");
    expect(html).toContain("paddleocr:'PaddleOCR'");
    expect(html).toContain("AI มั่นใจ:");
    expect(html).toContain("ผลสุดท้าย ยอด:");
    expect(html).toContain("รูปในชุด:");
    expect(html).toContain("KPLUS/K+");
    expect(html).toContain("กดรีเฟรชเมื่อต้องการข้อมูลล่าสุด");
    expect(html).not.toContain("setInterval");
  });

  it("uses the matching themed login page", () => {
    const html = loginHtml();

    expect(html).toContain("เข้าสู่ศูนย์จัดการระบบทั้ง 5 ภูมิภาค");
    expect(html).toContain("linear-gradient");
  });

  it("validates the encryption key before saving control secrets", () => {
    const valid = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

    expect(encryptionKeyBytes(valid)).toHaveLength(32);
    expect(() => encryptionKeyBytes("not valid base64!")).toThrow("valid base64");
    expect(() => encryptionKeyBytes(btoa("too short"))).toThrow("32 bytes");
  });

  it("shows a short API error instead of dumping a Cloudflare HTML page", () => {
    const html = dashboardHtml();

    expect(html).toContain("บันทึกไม่สำเร็จ (HTTP ");
    expect(html).toContain("response.json()");
    expect(html).not.toContain("notify(await response.text(),true)");
  });
});
