import { ImapFlow } from "imapflow";

export const runtime = "nodejs";

export async function GET() {
  const user = process.env.SPACEMAIL_USER;
  const password = process.env.SPACEMAIL_PASSWORD;
  const host = process.env.SPACEMAIL_IMAP_HOST;
  const port = Number(process.env.SPACEMAIL_IMAP_PORT || "993");

  if (!user || !password || !host) {
    return Response.json(
      { ok: false, error: "SpaceMail environment variables are missing." },
      { status: 500 }
    );
  }

  const client = new ImapFlow({
    host,
    port,
    secure: true,
    auth: {
      user,
      pass: password
    }
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
      throw new Error("SpaceMail Drafts mailbox was not found.");
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

    await client.append(
      drafts.path,
      message,
      ["\\Draft"]
    );

    return Response.json({
      ok: true,
      created: 1,
      mailbox: drafts.path
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 });
  } finally {
    try {
      await client.logout();
    } catch {}
  }
}