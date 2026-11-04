import { ConfigError, isPrivateHost, loadConfig } from "./config";

const base: NodeJS.ProcessEnv = {
  API_BASE_URL: "https://clinic.example.ph/api/v1",
  AGENT_EMAIL: "agent@clinic.example.ph",
  AGENT_PASSWORD: "a-long-agent-password",
  FACILITY_ID: "11111111-1111-4111-8111-111111111111",
  DEVICE_CODES: "front-1, Front-2",
  PRINTER_TYPE: "tcp",
  PRINTER_HOST: "192.168.1.50",
};

const refused = (env: NodeJS.ProcessEnv, readFile?: (p: string) => string) => {
  try {
    loadConfig({ ...base, ...env }, readFile);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as Error).message;
  }
  throw new Error("expected the configuration to be refused");
};

describe("isPrivateHost", () => {
  it("accepts the clinic's own network and refuses public addresses", () => {
    for (const host of [
      "10.0.0.5",
      "172.16.4.2",
      "172.31.255.1",
      "192.168.0.9",
      "127.0.0.1",
      "169.254.1.1",
      "::1",
      "fd00::5",
      "fe80::1",
      "ticket-printer",
      "front.local",
      "desk.lan",
    ]) {
      expect(isPrivateHost(host)).toBe(true);
    }
    for (const host of ["8.8.8.8", "172.32.0.1", "192.169.1.1", "11.0.0.1", "2001:db8::1", "printer.example.com"]) expect(isPrivateHost(host)).toBe(false);
  });
});

describe("loadConfig", () => {
  it("reads a complete setting, with the defaults for what is left out", () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({
      apiBaseUrl: "https://clinic.example.ph/api/v1",
      deviceCodes: ["front-1", "front-2"],
      printer: { type: "tcp", host: "192.168.1.50", port: 9100 },
      paperWidth: 80,
      timeZone: "Asia/Manila",
      pollMs: 2000,
      healthPort: 8788,
    });
  });

  it("allows plain http only for this machine", () => {
    expect(() => loadConfig({ ...base, API_BASE_URL: "http://localhost:3333/api/v1" })).not.toThrow();
    expect(() => loadConfig({ ...base, API_BASE_URL: "http://127.0.0.1:3333/api/v1" })).not.toThrow();
    expect(refused({ API_BASE_URL: "http://clinic.example.ph/api/v1" })).toMatch(/https/);
  });

  it("keeps the printer on the clinic's network", () => {
    expect(refused({ PRINTER_HOST: "203.0.113.9" })).toMatch(/own network/);
    expect(refused({ PRINTER_HOST: undefined })).toMatch(/PRINTER_HOST/);
    expect(refused({ PRINTER_TYPE: "file" })).toMatch(/PRINTER_PATH/);
    expect(loadConfig({ ...base, PRINTER_TYPE: "file", PRINTER_PATH: "\\\\localhost\\TicketPrinter" }).printer).toEqual({
      type: "file",
      path: "\\\\localhost\\TicketPrinter",
    });
    expect(loadConfig({ ...base, PRINTER_TYPE: "dryrun" }).printer).toMatchObject({ type: "dryrun" });
  });

  it("needs a password, from the environment or from a file", () => {
    expect(refused({ AGENT_PASSWORD: undefined })).toMatch(/AGENT_PASSWORD/);
    expect(loadConfig({ ...base, AGENT_PASSWORD: undefined, AGENT_PASSWORD_FILE: "/run/secrets/agent" }, () => "from-a-file\n").password).toBe("from-a-file");
  });

  it("refuses bad kiosk codes, paper widths, ports and time zones", () => {
    expect(refused({ DEVICE_CODES: "Bad Code" })).toMatch(/kiosk code/);
    expect(refused({ DEVICE_CODES: "" })).toBeTruthy();
    expect(refused({ PAPER_MM: "70" })).toBeTruthy();
    expect(loadConfig({ ...base, PAPER_MM: "58" }).paperWidth).toBe(58);
    expect(refused({ HEALTH_PORT: "80" })).toBeTruthy();
    expect(refused({ TIMEZONE: "Mars/Olympus" })).toMatch(/time zone/);
    expect(refused({ FACILITY_ID: "not-a-uuid" })).toMatch(/FACILITY_ID/);
  });
});
