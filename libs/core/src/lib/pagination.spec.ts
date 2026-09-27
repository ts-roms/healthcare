import { pageOffset, pageQuerySchema, toPage } from "./pagination";

describe("pagination", () => {
  it("applies defaults and bounds", () => {
    expect(pageQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(pageQuerySchema.safeParse({ pageSize: "500" }).success).toBe(false);
  });

  it("computes offset and trims the probe row", () => {
    const query = { page: 2, pageSize: 2 };
    expect(pageOffset(query)).toBe(2);
    expect(toPage([1, 2, 3], query)).toEqual({ items: [1, 2], page: 2, pageSize: 2, hasMore: true });
    expect(toPage([1], query)).toEqual({ items: [1], page: 2, pageSize: 2, hasMore: false });
  });
});
