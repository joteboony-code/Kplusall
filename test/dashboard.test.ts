import { describe, expect, it } from "vitest";
import { dashboardHtml } from "../src/index";

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
});
