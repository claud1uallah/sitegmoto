import { createHash } from "node:crypto";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { adminRequired, ApiError, fail, limitedBody, rateLimit, safeWrite, uid, run, now } from "@/lib/server/core";
export async function POST(request: Request) { try {
    safeWrite(request);
    adminRequired(await getChatGPTUser(), request);
    await rateLimit(request, "upload", 20);
    const body = await limitedBody(request, 5100000);
    const form = await new Response(body as BodyInit, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData(), file = form.get("file");
    if (!(file instanceof File) || file.size > 5000000 || file.size < 12)
        throw new ApiError("Alege o imagine validă de maximum 5 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let extension = "";
    let mime = "";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        extension = "jpg";
        mime = "image/jpeg";
    }
    else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        extension = "png";
        mime = "image/png";
    }
    else if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
        extension = "webp";
        mime = "image/webp";
    }
    else
        throw new ApiError("Sunt acceptate imagini JPEG, PNG și WebP.");
    const key = `products/${uid()}.${extension}`;
    await run("INSERT INTO media(key,content,mime,etag,created_at) VALUES(?,?,?,?,?)",key,Buffer.from(bytes),mime,createHash("sha256").update(bytes).digest("hex"),now());
    return Response.json({ data: { key, url: `/api/media/${key}` } });
}
catch (error) {
    return fail(error);
} }
