import { ImapFlow } from "imapflow";

export const runtime = "nodejs";

export async function GET() {
  const user = process.env.SPACEMAIL_USER;
  const password = process.env.SPACEMAIL_PASSWORD;
  const host = process.env.SPACEMAIL_IMAP_HOST;
  const port = Number(process.env.SPACEMAIL_IMAP_PORT || "993");

  if (!user || !password || !host) {
    return Response.json({
      ok: false,
      stage: "environment",
      error: "SpaceMail environment variables are missing."
    });
  }

  const client = new ImapFlow({
    host,
    port,
    secure: true,
    auth: {
      user,
      pass: password
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });

  try {
    await client.connect();

    const mailboxes = await client.list();

    const drafts = mailboxes.find(
      (mailbox) =>
        mailbox.specialUse === "\\Drafts" ||
        mailbox.path.toLowerCase() === "drafts"
    );

    if (!drafts) {
      return Response.json({
        ok: false,
        stage: "mailbox",
        error: "Connected successfully, but Drafts mailbox was not found.",
        mailboxes: mailboxes.map((m) => m.path)
      });
    }

    const message = [
      `From: ${user}`,
      `To: ${user}`,
      "Subject: AmbiEnco SpaceMail Draft Test",
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@ambi-enco.com>`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      "This is a test draft created by the AmbiEnco SpaceMail Draft Bridge. It has NOT been sent.",
      ""
    ].join("\r\n");

    await client.append(drafts.path, message, ["\\Draft"]);

    return Response.json({
      ok: true,
      stage: "complete",
      created: 1,
      mailbox: drafts.path
    });
  } catch (error) {
    return Response.json({
      ok: false,
      stage: "connection_or_authentication",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  } finally {
    try {
      await client.logout();
    } catch {}
  }
}