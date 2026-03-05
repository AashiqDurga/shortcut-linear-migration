import { NextRequest, NextResponse } from "next/server";

// Proxy for Linear GraphQL API
// Keeps actual external API calls server-side.

export async function POST(req: NextRequest) {
  const { token: bodyToken, query, variables } = await req.json();

  // Prefer token from request body; fall back to env var (set in .env.local)
  const token = bodyToken || process.env.LINEAR_API_KEY;

  if (!token) {
    return NextResponse.json({ error: "Missing Linear token — set LINEAR_API_KEY in .env.local or enter it on the Connect screen." }, { status: 400 });
  }

  const upstream = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({ query, variables }),
  });

  const data = await upstream.json().catch(() => null);
  return NextResponse.json(data, { status: upstream.status });
}
