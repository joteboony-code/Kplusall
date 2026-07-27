import { describe, expect, it } from "vitest";
import { dashboardHtml, loginHtml } from "../src/index";

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

  it("renders the five-region summary and responsive themed controls", () => {
    const html = dashboardHtml();

    expect(html).toContain("ศูนย์จัดการ LINE OA และ OCR.space");
    expect(html).toContain('id="active-count"');
    expect(html).toContain("ภาคเหนือ");
    expect(html).toContain("กรุงเทพฯ");
    expect(html).toContain("@media(max-width:760px)");
  });

  it("uses the matching themed login page", () => {
    const html = loginHtml();

    expect(html).toContain("เข้าสู่ศูนย์จัดการระบบทั้ง 5 ภูมิภาค");
    expect(html).toContain("linear-gradient");
  });
});
