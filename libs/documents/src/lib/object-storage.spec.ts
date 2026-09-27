import { contentDisposition } from "./object-storage";

describe("contentDisposition", () => {
  it("sets an ASCII fallback and a UTF-8 file name", () => {
    expect(contentDisposition("Resulta ng CBC – Peña.pdf")).toBe(
      `attachment; filename="Resulta ng CBC _ Pe_a.pdf"; filename*=UTF-8''Resulta%20ng%20CBC%20%E2%80%93%20Pe%C3%B1a.pdf`,
    );
  });

  it("neutralizes quotes", () => {
    expect(contentDisposition('a"b.pdf')).toContain('filename="a_b.pdf"');
  });
});
