import { NextRequest, NextResponse } from "next/server";

// Proxy for Shortcut REST API v3
// Keeps actual external API calls server-side so they don't appear
// in the browser's outbound network requests to external hosts.

export async function POST(req: NextRequest) {
  const { token: bodyToken, method, path, params, body } = await req.json();

  // Prefer token from request body; fall back to env var (set in .env.local)
  const token = bodyToken || process.env.SHORTCUT_API_TOKEN;

  if (!token) {
    return NextResponse.json({ error: "Missing Shortcut token — set SHORTCUT_API_TOKEN in .env.local or enter it on the Connect screen." }, { status: 400 });
  }

  let url = `https://api.app.shortcut.com/api/v3/${path}`;
  if (params && Object.keys(params).length > 0) {
    url += "?" + new URLSearchParams(params).toString();
  }

  console.log(`[shortcut] ${method} ${url}`);

  const upstream = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Shortcut-Token": token,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  console.log(`[shortcut] → ${upstream.status}`);
  if (!upstream.ok) {
    const text = await upstream.text();
    console.log(`[shortcut] response body: ${text}`);
    return NextResponse.json({ error: text }, { status: upstream.status });
  }

  const data = await upstream.json().catch(() => null);
  return NextResponse.json(data, { status: upstream.status });
}
