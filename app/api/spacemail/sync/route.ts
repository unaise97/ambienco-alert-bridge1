import { ImapFlow } from "imapflow";

export const runtime = "nodejs";

const DATA_SOURCE_ID = "20525e96-77ee-4b60-a9bd-188c87572ffb";
const MARKER = "[SPACE-MAIL-DRAFT-CREATED]";

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

async function notionRequest(
  path: string,
  options: RequestInit = {}
) {
  const token = process.env.NOTION_API_KEY;

  if (!token) {
    throw new Error("NOTION_API_KEY is missing.");
  }

  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2025-09-03",
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Notion API ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}

function getText(property: any): string {
  if (!property) return "";

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
  for (const property of Object.values(properties || {}) as any[]) {
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
           