import { NextResponse } from "next/server";

// Returns which tokens are pre-configured via env vars.
// Never exposes the token values themselves — only booleans.
export async function GET() {
  return NextResponse.json({
    shortcutConfigured: !!process.env.SHORTCUT_API_TOKEN,
    linearConfigured: !!process.env.LINEAR_API_KEY,
  });
}
