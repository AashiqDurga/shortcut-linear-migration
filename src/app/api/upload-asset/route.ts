import { NextRequest, NextResponse } from "next/server";

// Downloads a file from Shortcut's CDN (private, needs token) and re-uploads
// it to Linear's own storage via the fileUpload mutation.
// Files end up at uploads.linear.app — no external infra needed.

export async function POST(req: NextRequest) {
  const { shortcutToken, linearToken, fileUrl, filename, contentType, size } =
    await req.json();

  if (!shortcutToken || !linearToken || !fileUrl || !filename || !contentType) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // 1. Download from Shortcut CDN — private files require the token
  console.log(`[upload-asset] downloading ${filename} from Shortcut…`);
  const download = await fetch(fileUrl, {
    headers: { "Shortcut-Token": shortcutToken },
  });
  if (!download.ok) {
    const text = await download.text();
    console.log(`[upload-asset] download failed ${download.status}: ${text}`);
    return NextResponse.json(
      { error: `Shortcut download failed (${download.status}): ${text}` },
      { status: 502 }
    );
  }
  const fileBytes = await download.arrayBuffer();
  const actualSize = fileBytes.byteLength;

  // 2. Ask Linear for a presigned upload URL
  console.log(`[upload-asset] requesting Linear upload URL for ${filename} (${actualSize} bytes)…`);
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
      variables: {
        size: size ?? actualSize,
        contentType,
        filename,
      },
    }),
  });

  const linearJson = await linearRes.json();
  if (linearJson.errors?.length) {
    console.log(`[upload-asset] Linear fileUpload error: ${JSON.stringify(linearJson.errors)}`);
    return NextResponse.json({ error: linearJson.errors[0].message }, { status: 502 });
  }

  const { uploadUrl, assetUrl, headers: uploadHeaders } =
    linearJson.data.fileUpload.uploadFile;

  // 3. PUT the file bytes to the presigned URL
  console.log(`[upload-asset] uploading to Linear storage…`);
  const extraHeaders: Record<string, string> = {};
  for (const h of uploadHeaders ?? []) {
    extraHeaders[h.key] = h.value;
  }

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(actualSize),
      ...extraHeaders,
    },
    body: fileBytes,
  });

  if (!putRes.ok) {
    const text = await putRes.text();
    console.log(`[upload-asset] PUT failed ${putRes.status}: ${text}`);
    return NextResponse.json(
      { error: `Linear storage upload failed (${putRes.status}): ${text}` },
      { status: 502 }
    );
  }

  console.log(`[upload-asset] ✓ ${filename} → ${assetUrl}`);
  return NextResponse.json({ assetUrl });
}
