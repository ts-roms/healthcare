import { createServer, type Server } from "node:net";
import { SmtpEmailSender } from "./channel-senders";

/** A minimal SMTP responder that records the envelope and the message it receives. */
function smtpServer() {
  const received: { commands: string[]; data: string } = { commands: [], data: "" };
  const server: Server = createServer((socket) => {
    let inData = false;
    let buffer = "";
    socket.write("220 test ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let end: number;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            socket.write("250 2.0.0 queued as TEST123\r\n");
          } else {
            received.data += `${line}\n`;
          }
          continue;
        }
        received.commands.push(line);
        const verb = line.split(" ")[0]!.toUpperCase();
        if (verb === "EHLO") socket.write("250-test\r\n250 8BITMIME\r\n");
        else if (verb === "DATA") {
          inData = true;
          socket.write("354 go ahead\r\n");
        } else if (verb === "QUIT") socket.end("221 bye\r\n");
        else socket.write("250 OK\r\n");
      }
    });
  });
  return { server, received };
}

describe("SmtpEmailSender", () => {
  it("delivers the rendered message over SMTP and reports the message id", async () => {
    const { server, received } = smtpServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    try {
      const sender = new SmtpEmailSender(`smtp://127.0.0.1:${port}?ignoreTLS=true`, "MyHealth <no-reply@clinic.example.ph>");
      const result = await sender.send("juan@example.ph", { subject: "Your results are ready", text: "Sign in to MyHealth to read them." });
      expect(result.provider).toBe("smtp");
      expect(result.providerMessageId).toMatch(/^<.+>$/);
      expect(received.commands).toEqual(expect.arrayContaining(["MAIL FROM:<no-reply@clinic.example.ph>", "RCPT TO:<juan@example.ph>"]));
      expect(received.data).toContain("Subject: Your results are ready");
      expect(received.data).toContain("Sign in to MyHealth to read them.");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
