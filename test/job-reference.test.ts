import { describe, expect, it } from "vitest";
import { extractJobNumber } from "../src/index";

describe("job number extraction from LINE text", () => {
  it("keeps accepting a message that contains only an 8-digit job number", () => {
    expect(extractJobNumber("28256885")).toBe("28256885");
  });

  it("finds an 8-digit job number inside a multi-line technician message", () => {
    expect(extractJobNumber(`ปิดงาน Service เปลี่ยนเครื่อง
28256885
ร้านค้าทำแบบสอบถาม
ดำเนินการเรียบร้อยครับ`)).toBe("28256885");
  });

  it("finds a job number next to labels and punctuation", () => {
    expect(extractJobNumber("เลขงาน: 12345678, ดำเนินการเรียบร้อย")).toBe("12345678");
  });

  it("does not cut an 8-digit job number out of a longer number", () => {
    expect(extractJobNumber("เลขอ้างอิง 0123456789")).toBeNull();
  });

  it("uses the first complete 8-digit job number when a message has several", () => {
    expect(extractJobNumber("งานเดิม 11112222 เปลี่ยนเป็น 33334444")).toBe("11112222");
  });
});
