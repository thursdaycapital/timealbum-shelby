import { NextResponse } from "next/server";

export const runtime = "nodejs";

function resolvePublisherUrl() {
  const base = process.env.PUBLISHER_URL;
  if (!base) {
    throw new Error("PUBLISHER_URL is not configured.");
  }

  if (base.endsWith("/publish")) {
    return base;
  }

  return `${base.replace(/\/$/, "")}/publish`;
}

export async function POST(request: Request) {
  const apiKey = process.env.PUBLISHER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "PUBLISHER_API_KEY is not configured." },
      { status: 500 }
    );
  }

  try {
    const formData = await request.formData();
    const response = await fetch(resolvePublisherUrl(), {
      method: "POST",
      headers: {
        "x-api-key": apiKey
      },
      body: formData
    });

    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
