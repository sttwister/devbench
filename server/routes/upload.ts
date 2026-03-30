import type http from "http";
import { Router } from "../router.ts";
import { sendJson } from "../http-utils.ts";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

const UPLOAD_DIR = path.join(os.tmpdir(), "devbench-uploads");

/** Guess a file extension from a MIME content type. */
function guessExtension(contentType: string): string {
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/bmp": ".bmp",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "application/octet-stream": "",
  };
  return map[contentType] || "";
}

/** Read the raw body as a Buffer (with size limit). */
function readRawBody(req: http.IncomingMessage, maxSize = 50 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxSize) {
        reject(new Error("Request body too large (max 50 MB)"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function registerUploadRoutes(api: Router): void {
  /**
   * POST /api/upload
   *
   * Accepts a raw binary body with optional headers:
   *   - Content-Type: the MIME type (used to guess extension)
   *   - X-Filename: the original filename (used for extension & readability)
   *
   * Saves the file to a tmp directory and returns { path: "/tmp/devbench-uploads/..." }.
   */
  api.post("/api/upload", async (req, res) => {
    try {
      // Ensure upload directory exists
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });

      const contentType = (req.headers["content-type"] || "application/octet-stream").split(";")[0].trim();
      const origFilename = req.headers["x-filename"] as string | undefined;

      const data = await readRawBody(req);
      if (data.length === 0) {
        return sendJson(res, { error: "Empty body" }, 400);
      }

      // Determine file extension
      const ext = origFilename
        ? path.extname(origFilename)
        : guessExtension(contentType);

      const uniqueName = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
      const filePath = path.join(UPLOAD_DIR, uniqueName);

      fs.writeFileSync(filePath, data);
      console.log(`[upload] Saved ${data.length} bytes → ${filePath}`);

      sendJson(res, { path: filePath }, 201);
    } catch (e: any) {
      console.error("[upload]", e);
      sendJson(res, { error: e.message }, 500);
    }
  });
}
