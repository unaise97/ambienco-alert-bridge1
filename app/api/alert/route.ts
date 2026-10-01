export async function POST(req: Request) {
  try {
    const secret = req.headers.get("x-ambienco-secret");

    if (
      !process.env.INBOUND_WEBHOOK_SECRET ||
      secret !== process.env.INBOUND_WEBHOOK_SECRET
    ) {
      return Response.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await req.json();

    const response = await fetch(process.env.XALERT_URL!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_name:
          body.event_name || "CUSTOMER NEEDS YOUR ATTENTION",
        event_description:
          body.event_description ||
          "An important Ambienco customer request needs your attention. Open ChatGPT for the customer details.",
      }),
    });

    const result = await response.text();

    return new Response(result, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error(error);

    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
