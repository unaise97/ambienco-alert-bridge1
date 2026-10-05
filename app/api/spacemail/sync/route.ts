import { ImapFlow } from "imapflow";

export const runtime = "nodejs";

const DATA_SOURCE_ID = "20525e96-77ee-4b60-a9bd-188c87572ffb";
const MARKER = "[SPACE-MAIL-DRAFT-CREATED]";

function encodeSubject(subject: string) {
  if (/^[\x00-\x7F]*$/.test(subject)) {
    return subject;
  }

  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString(
    "base64"
  )}?=`;
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

async function notionRequest(
  path: string,
  options: RequestInit = {}
) {
  const token = process.env.NOTION_API_KEY;

  if (!token) {
    throw new Error("NOTION_API_KEY is missing.");
  }

  const response = await fetch(
    `https://api.notion.com/v1${path}`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2025-09-03",
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Notion API ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}

function getText(property: any): string {
  if (!property) {
    return "";
  }

  if (property.type === "title") {
    return (property.title || [])
      .map((x: any) => x.plain_text || "")
      .join("");
  }

  if (property.type === "rich_text") {
    return (property.rich_text || [])
      .map((x: any) => x.plain_text || "")
      .join("");
  }

  if (property.type === "email") {
    return property.email || "";
  }

  if (property.type === "url") {
    return property.url || "";
  }

  if (property.type === "select") {
    return property.select?.name || "";
  }

  return "";
}

function getTitle(properties: any): string {
  for (const property of Object.values(
    properties || {}
  ) as any[]) {
    if (property.type === "title") {
      return getText(property);
    }
  }

  return "";
}

async function getDraftLeads() {
  const result = await notionRequest(
    `/data_sources/${DATA_SOURCE_ID}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        page_size: 100,
        filter: {
          property: "Email Status",
          select: {
            equals: "Draft ready"
          }
        }
      })
    }
  );

  return result.results || [];
}

async function updateNotionPage(
  pageId: string,
  activityHistory: string,
  nextAction: string
) {
  await notionRequest(`/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        "Activity History": {
          rich_text: [
            {
              type: "text",
              text: {
                content: activityHistory
              }
            }
          ]
        },
        "Next Action": {
          rich_text: [
            {
              type: "text",
              text: {
                content: nextAction
              }
            }
          ]
        }
      }
    })
  });
}

async function findDraftsMailbox(client: ImapFlow) {
  const boxes = await client.list();

  const exact = boxes.find(
    (box: any) =>
      box.path.toLowerCase() === "drafts" ||
      box.name?.toLowerCase() === "drafts"
  );

  if (exact) {
    return exact.path;
  }

  const candidate = boxes.find((box: any) => {
    const name =
      `${box.path} ${box.name || ""}`.toLowerCase();

    return name.includes("draft");
  });

  return candidate?.path || "Drafts";
}

export async function GET(request: Request) {
  const secret = process.env.BRIDGE_SYNC_SECRET;

  if (!secret) {
    return Response.json(
      {
        ok: false,
        error: "BRIDGE_SYNC_SECRET is missing."
      },
      { status: 500 }
    );
  }

  const provided =
    request.headers.get("x-sync-secret") ||
    new URL(request.url).searchParams.get("secret");

  if (provided !== secret) {
    return Response.json(
      {
        ok: false,
        error: "Unauthorized."
      },
      { status: 401 }
    );
  }

  return Response.json({
    ok: true,
    service: "SpaceMail Draft Sync"
  });
}

export async function POST(request: Request) {
  const secret = process.env.BRIDGE_SYNC_SECRET;

  if (!secret) {
    return Response.json(
      {
        ok: false,
        error: "BRIDGE_SYNC_SECRET is missing."
      },
      { status: 500 }
    );
  }

  const provided = request.headers.get("x-sync-secret");

  if (provided !== secret) {
    return Response.json(
      {
        ok: false,
        error: "Unauthorized."
      },
      { status: 401 }
    );
  }

  const leads = await getDraftLeads();

  if (!leads.length) {
    return Response.json({
      ok: true,
      created: 0,
      message:
        "No Notion leads with Email Status = Draft ready."
    });
  }

  const user = process.env.SPACEMAIL_USER;
  const password = process.env.SPACEMAIL_PASSWORD;
  const host =
    process.env.SPACEMAIL_IMAP_HOST ||
    "mail.spacemail.com";
  const port = Number(
    process.env.SPACEMAIL_IMAP_PORT || "993"
  );

  if (!user || !password) {
    return Response.json(
      {
        ok: false,
        error: "SpaceMail credentials are missing."
      },
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

  const created: string[] = [];
  const skipped: string[] = [];

  try {
    await client.connect();

    const draftsMailbox =
      await findDraftsMailbox(client);

    for (const lead of leads) {
      const properties = lead.properties || {};

      const email = getText(properties["Email"]);
      const subject = getText(
        properties["Email Subject"]
      );
      const body = getText(
        properties["Email Body"]
      );

      if (!email || !subject || !body) {
        skipped.push(lead.id);
        continue;
      }

      const activityHistory = getText(
        properties["Activity History"]
      );

      if (activityHistory.includes(MARKER)) {
        skipped.push(lead.id);
        continue;
      }

      const message = buildMessage(
        user,
        email,
        subject,
        body
      );

      await client.mailboxOpen(draftsMailbox);

      await client.append(
        draftsMailbox,
        message,
        ["\\Draft"]
      );

      const timestamp =
        new Date().toISOString();

      const updatedHistory =
        `${activityHistory}\n${MARKER} ${timestamp} — Draft created in SpaceMail Drafts.`
          .trim();

      await updateNotionPage(
        lead.id,
        updatedHistory,
        "Review and send the draft in Outlook."
      );

      created.push(
        getTitle(properties) || lead.id
      );
    }

    return Response.json({
      ok: true,
      created: created.length,
      skipped: skipped.length,
      createdLeads: created,
      skippedLeads: skipped,
      mailbox: draftsMailbox
    });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error?.message || String(error)
      },
      { status: 500 }
    );
  } finally {
    try {
      await client.logout();
    } catch {}
  }
}