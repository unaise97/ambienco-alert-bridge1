import { ImapFlow } from "imapflow";

export const runtime = "nodejs";

function encodeSubject(subject: string) {
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

function buildMessage(
  from: string,
  to: string,
  subject: string,
  body: string
) {
  const messageId = `<${crypto.randomUUID()}@ambi-enco.com>`;

  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
    ""
  ].join("\r\n");
}

async function findDraftsMailbox(client: ImapFlow) {
  const mailboxes = await client.list();

  const drafts = mailboxes.find(
    (mailbox) =>
      mailbox.specialUse === "\\Drafts" ||
      mailbox.path.toLowerCase() === "drafts"
  );

  if (!drafts) {
    throw new Error("SpaceMail Drafts mailbox was not found.");
  }

  return drafts.path;
}

export async function GET() {
  return Response.json({
    ok: true,
    service: "SpaceMail Draft Bridge"
  });
}

export async function POST(request: Request) {
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

  const input = await request.json();

  const drafts = Array.isArray(input) ? input : [input];

  for (const draft of drafts) {
    if (!draft?.to || !draft?.subject || !draft?.body) {
      return Response.json(
        { ok: false, error: "Each draft needs to, subject and body." },
        { status: 400 }
      );
    }
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

    const draftsMailbox = await findDraftsMailbox(client);

    for (const draft of drafts) {
      const message = buildMessage(
        user,
        draft.to,
        draft.subject,
        draft.body
      );

      await client.append(
        draftsMailbox,
        message,
        ["\\Draft"]
      );
    }

    return Response.json({
      ok: true,
      created: drafts.length,
      mailbox: draftsMailbox
    });
  } catch (error) {
    console.error("SpaceMail draft error:", error);

    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  } finally {
    try {
      await client.logout();
    } catch {}
  }
}