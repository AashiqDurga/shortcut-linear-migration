import { NextRequest, NextResponse } from "next/server";

// Downloads a file from Shortcut's CDN (private, needs token) and re-uploads
// it to Linear's own storage via the fileUpload mutation.
// Files end up at uploads.linear.app — no external infra needed.

export async function POST(req: NextRequest) {
  const { shortcutToken: bodyScToken, linearToken: bodyLinToken, fileUrl, filename, contentType } =
    await req.json();

  // Fall back to env vars — same pattern as the other proxy routes.
  // When tokens are configured server-side the client sends empty strings.
  const shortcutToken = bodyScToken || process.env.SHORTCUT_API_TOKEN;
  const linearToken = bodyLinToken || process.env.LINEAR_API_KEY;

  if (!shortcutToken || !linearToken || !fileUrl || !filename || !contentType) {
    const missing = [
      !shortcutToken && "shortcutToken",
      !linearToken && "linearToken",
      !fileUrl && "fileUrl",
      !filename && "filename",
      !contentType && "contentType",
    ].filter(Boolean);
    console.log(`[upload-asset] ✗ Missing fields: ${missing.join(", ")}`);
    return NextResponse.json({ error: `Missing required fields: ${missing.join(", ")}` }, { status: 400 });
  }

  // 1. Download from Shortcut CDN — private files require the token
  console.log(`[upload-asset] 1. Downloading "${filename}" (${contentType}) from Shortcut…`);
  console.log(`[upload-asset]    URL: ${fileUrl}`);
  const download = await fetch(fileUrl, {
    headers: { "Shortcut-Token": shortcutToken },
  });
  console.log(`[upload-asset]    Shortcut CDN → ${download.status} ${download.statusText}`);
  if (!download.ok) {
    const text = await download.text();
    console.log(`[upload-asset]    Response body: ${text.slice(0, 500)}`);
    return NextResponse.json(
      { error: `Shortcut download failed (${download.status}): ${text}` },
      { status: 502 }
    );
  }
  const fileBytes = await download.arrayBuffer();
  const actualSize = fileBytes.byteLength;
  console.log(`[upload-asset]    Downloaded ${actualSize} bytes`);
  if (actualSize === 0) {
    console.log(`[upload-asset] ✗ Downloaded file is empty — aborting`);
    return NextResponse.json({ error: "Downloaded file is empty" }, { status: 502 });
  }

  // 2. Ask Linear for a presigned upload URL
  console.log(`[upload-asset] 2. Requesting Linear fileUpload URL (${actualSize} bytes, ${contentType})…`);
  const linearRes = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: linearToken,
    },
    body: JSON.stringify({
      query: `
        mutation FileUpload($size: Int!, $contentType: String!, $filename: String!) {
          fileUpload(size: $size, contentType: $contentType, filename: $filename) {
            uploadFile {
              uploadUrl
              assetUrl
              headers {
                key
                value
              }
            }
          }
        }
      `,
      variables: { size: actualSize, contentType, filename },
    }),
  });

  console.log(`[upload-asset]    Linear API → ${linearRes.status} ${linearRes.statusText}`);
  const linearJson = await linearRes.json();
  if (linearJson.errors?.length) {
    console.log(`[upload-asset]    GraphQL errors: ${JSON.stringify(linearJson.errors)}`);
    return NextResponse.json({ error: linearJson.errors[0].message }, { status: 502 });
  }

  const { uploadUrl, assetUrl, headers: uploadHeaders } =
    linearJson.data.fileUpload.uploadFile;
  console.log(`[upload-asset]    assetUrl: ${assetUrl}`);
  console.log(`[upload-asset]    uploadUrl: ${uploadUrl.slice(0, 80)}…`);
  console.log(`[upload-asset]    extra headers from Linear: ${JSON.stringify(uploadHeaders)}`);

  // 3. PUT the file bytes to the presigned S3 URL
  console.log(`[upload-asset] 3. PUTting ${actualSize} bytes to S3…`);
  const extraHeaders: Record<string, string> = {};
  for (const h of uploadHeaders ?? []) {
    extraHeaders[h.key] = h.value;
  }

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      ...extraHeaders,
    },
    body: fileBytes,
  });

  const putBody = await putRes.text();
  console.log(`[upload-asset]    S3 PUT → ${putRes.status} ${putRes.statusText}`);
  if (putBody) console.log(`[upload-asset]    S3 response body: ${putBody.slice(0, 500)}`);

  if (!putRes.ok) {
    console.log(`[upload-asset] ✗ S3 PUT failed`);
    return NextResponse.json(
      { error: `Linear storage upload failed (${putRes.status}): ${putBody}` },
      { status: 502 }
    );
  }

  // Verify the uploaded file is actually accessible via the assetUrl
  try {
    const verify = await fetch(assetUrl, { method: "HEAD" });
    console.log(`[upload-asset] 4. Verify assetUrl → ${verify.status} ${verify.statusText}`);
    console.log(`[upload-asset]    Content-Type:        ${verify.headers.get("content-type")}`);
    console.log(`[upload-asset]    Content-Disposition: ${verify.headers.get("content-disposition")}`);
    console.log(`[upload-asset]    Content-Length:      ${verify.headers.get("content-length")}`);
    console.log(`[upload-asset]    Cache-Control:       ${verify.headers.get("cache-control")}`);
    if (!verify.ok) {
      console.log(`[upload-asset] ✗ assetUrl not accessible (${verify.status}) — file may not render`);
    }
  } catch (err) {
    console.log(`[upload-asset]    Could not verify assetUrl: ${err}`);
  }

  console.log(`[upload-asset] ✓ "${filename}" → ${assetUrl}`);
  return NextResponse.json({ assetUrl });
}
