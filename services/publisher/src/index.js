const express = require("express");
const Busboy = require("busboy");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");
const yaml = require("js-yaml");
const mime = require("mime-types");

const app = express();

const PORT = Number(process.env.PORT || 4000);
const API_KEY = process.env.API_KEY || "";
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 30);
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 104857600);
const MAX_FILE_COUNT = Number(process.env.MAX_FILE_COUNT || 200);
const DEFAULT_EXPIRATION = process.env.DEFAULT_EXPIRATION || "30d";
const AI_ENABLED = String(process.env.AI_ENABLED || "").toLowerCase() === "true";

const rateLimits = new Map();

function rateLimit(req, res, next) {
  const ip =
    req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "unknown";
  const now = Date.now();
  const existing = rateLimits.get(ip);

  if (!existing || existing.resetAt <= now) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  if (existing.count >= RATE_LIMIT_MAX) {
    return res.status(429).json({ error: "Rate limit exceeded." });
  }

  existing.count += 1;
  rateLimits.set(ip, existing);
  next();
}

function requireApiKey(req, res, next) {
  const key = req.headers["x-api-key"];
  if (!API_KEY || key !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized." });
  }
  next();
}

function sanitizeFilename(filename) {
  const base = path.basename(filename || "file");
  return base.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function normalizePrefix(prefix) {
  const trimmed = prefix.trim().replace(/^\/+/, "");
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

async function fileExists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureUniquePath(targetPath) {
  if (!(await fileExists(targetPath))) {
    return targetPath;
  }

  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const base = path.basename(targetPath, ext);
  let index = 1;
  let candidate = path.join(dir, `${base}-${index}${ext}`);
  while (await fileExists(candidate)) {
    index += 1;
    candidate = path.join(dir, `${base}-${index}${ext}`);
  }
  return candidate;
}

function resolveDate(metaValue) {
  if (!metaValue) {
    return new Date();
  }
  const date = new Date(Number(metaValue));
  if (Number.isNaN(date.getTime())) {
    return new Date();
  }
  return date;
}

function stubGenerateCaptionTags(originalName, mimeType) {
  const base = path.basename(originalName || "photo");
  const words = base
    .replace(/\.[^/.]+$/, "")
    .split(/[_\-\s]+/)
    .map((word) => word.trim())
    .filter(Boolean);
  const tags = Array.from(new Set(words.map((word) => word.toLowerCase()))).slice(
    0,
    6
  );
  const caption = words.length
    ? `Photo of ${words.join(" ")}`
    : "Photo";
  if (mimeType && !tags.includes(mimeType)) {
    tags.push(mimeType);
  }
  return { caption, tags };
}

async function buildAlbum(distDir, files, metaMap, title, albumId) {
  const photos = [];
  for (const file of files) {
    const date = resolveDate(metaMap[file.originalName]);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");

    const safeName = file.safeName || sanitizeFilename(file.originalName);
    const ext =
      path.extname(safeName) ||
      (file.mimeType ? `.${mime.extension(file.mimeType)}` : "");
    const baseName = ext ? safeName.replace(ext, "") : safeName;
    const finalName = `${baseName}${ext}`;
    const relDir = path.join("photos", String(year), month, day);
    const absoluteDir = path.join(distDir, relDir);
    await fsp.mkdir(absoluteDir, { recursive: true });

    const targetPath = await ensureUniquePath(
      path.join(absoluteDir, finalName)
    );
    await fsp.rename(file.tempPath, targetPath);

    const relPath = path
      .relative(distDir, targetPath)
      .split(path.sep)
      .join("/");

    const ai = AI_ENABLED
      ? stubGenerateCaptionTags(file.originalName, file.mimeType)
      : null;

    photos.push({
      path: relPath,
      date: date.toISOString(),
      name: path.basename(targetPath),
      size: file.size,
      mimeType: file.mimeType || null,
      ai
    });
  }

  const indexJson = {
    albumId,
    title,
    generatedAt: new Date().toISOString(),
    photoCount: photos.length,
    photos
  };

  await fsp.writeFile(
    path.join(distDir, "index.json"),
    JSON.stringify(indexJson, null, 2)
  );

  const htmlPhotos = photos
    .map(
      (photo) =>
        `<figure><img src="${photo.path}" alt="${photo.name}" />` +
        `<figcaption>${photo.name}</figcaption></figure>`
    )
    .join("");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 24px; background: #0b0b0f; color: #e8e8f0; }
      header { margin-bottom: 24px; }
      h1 { margin: 0 0 8px; }
      section { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
      figure { margin: 0; background: #161622; padding: 12px; border-radius: 12px; }
      img { width: 100%; height: auto; display: block; border-radius: 8px; }
      figcaption { margin-top: 8px; font-size: 12px; color: #c4c4d6; word-break: break-word; }
    </style>
  </head>
  <body>
    <header>
      <h1>${title}</h1>
      <p>Album ID: ${albumId}</p>
      <p>Photos: ${photos.length}</p>
    </header>
    <section>${htmlPhotos}</section>
  </body>
</html>`;

  await fsp.writeFile(path.join(distDir, "index.html"), html);
}

function readShelbyAccount(configDir) {
  if (!configDir) {
    throw new Error("SHELBY_CONFIG_DIR is not configured.");
  }
  // Custodial wallet risk: the server controls the Shelby wallet credentials.
  // Protect this host and config path; compromise exposes all uploaded content.
  const configPath = path.join(configDir, ".shelby", "config.yaml");
  const raw = fs.readFileSync(configPath, "utf8");
  const data = yaml.load(raw) || {};
  const account =
    data.account ||
    data.address ||
    data.default_account ||
    data.wallet?.address ||
    data.wallet_address;
  if (!account) {
    throw new Error("Shelby account address not found in config.yaml.");
  }
  return account;
}

function runShelbyUpload(distDir, prefix, expiration) {
  return new Promise((resolve, reject) => {
    const args = [
      "upload",
      "-r",
      distDir,
      prefix,
      "-e",
      expiration,
      "--assume-yes"
    ];
    const child = spawn("shelby", args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Shelby upload failed with code ${code}.`));
      }
    });
  });
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/publish", requireApiKey, rateLimit, async (req, res) => {
  if (!req.headers["content-type"]?.includes("multipart/form-data")) {
    return res.status(400).json({ error: "Expected multipart/form-data." });
  }

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "timealbum-"));
  const uploadsDir = path.join(tempRoot, "uploads");
  const distDir = path.join(tempRoot, "dist");
  await fsp.mkdir(uploadsDir, { recursive: true });
  await fsp.mkdir(distDir, { recursive: true });

  const uploadedFiles = [];
  let fileCount = 0;
  let totalBytes = 0;
  let uploadError = null;

  const fields = {
    title: "",
    expiration: "",
    prefix: "",
    meta: {}
  };

  const cleanup = async () => {
    try {
      await fsp.rm(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  };

  const busboy = Busboy({
    headers: req.headers,
    limits: {
      files: MAX_FILE_COUNT
    }
  });

  busboy.on("field", (name, value) => {
    if (uploadError) {
      return;
    }
    if (name === "meta") {
      try {
        fields.meta = value ? JSON.parse(value) : {};
      } catch {
        uploadError = { status: 400, message: "Invalid meta JSON." };
      }
      return;
    }
    if (name === "title") {
      fields.title = value;
    } else if (name === "expiration") {
      fields.expiration = value;
    } else if (name === "prefix") {
      fields.prefix = value;
    }
  });

  busboy.on("file", (name, file, info) => {
    if (uploadError) {
      file.resume();
      return;
    }

    if (name !== "photos") {
      file.resume();
      return;
    }

    fileCount += 1;
    if (fileCount > MAX_FILE_COUNT) {
      uploadError = { status: 400, message: "Max file count exceeded." };
      file.resume();
      return;
    }

    const safeName = sanitizeFilename(info.filename);
    const tempPath = path.join(uploadsDir, `${Date.now()}-${safeName}`);
    const writeStream = fs.createWriteStream(tempPath);
    let fileBytes = 0;

    file.on("data", (data) => {
      fileBytes += data.length;
      totalBytes += data.length;
      if (!uploadError && totalBytes > MAX_UPLOAD_BYTES) {
        uploadError = { status: 413, message: "Max upload bytes exceeded." };
        file.resume();
      }
    });

    file.on("limit", () => {
      if (!uploadError) {
        uploadError = { status: 413, message: "File too large." };
      }
    });

    file.on("end", () => {
      if (uploadError) {
        return;
      }
      uploadedFiles.push({
        originalName: info.filename,
        safeName,
        tempPath,
        size: fileBytes,
        mimeType: info.mimeType
      });
    });

    file.pipe(writeStream);
  });

  busboy.on("filesLimit", () => {
    if (!uploadError) {
      uploadError = { status: 400, message: "Max file count exceeded." };
    }
  });

  busboy.on("finish", async () => {
    try {
      if (uploadError) {
        await cleanup();
        return res
          .status(uploadError.status || 400)
          .json({ error: uploadError.message });
      }

      if (uploadedFiles.length === 0) {
        await cleanup();
        return res.status(400).json({ error: "No photos uploaded." });
      }

      const albumId = crypto.randomUUID();
      const title = fields.title?.trim() || "Untitled album";
      const expiration = fields.expiration?.trim() || DEFAULT_EXPIRATION;
      const prefix = normalizePrefix(
        fields.prefix?.trim() || `time-album/${albumId}/`
      );

      await buildAlbum(distDir, uploadedFiles, fields.meta || {}, title, albumId);

      await runShelbyUpload(distDir, prefix, expiration);

      const account = readShelbyAccount(process.env.SHELBY_CONFIG_DIR);
      const restBase = process.env.SHELBY_REST_BASE;
      if (!restBase) {
        await cleanup();
        return res.status(500).json({ error: "SHELBY_REST_BASE missing." });
      }

      const base = restBase.replace(/\/$/, "");
      // Custodial wallet risk: public URLs are derived from the server-held wallet.
      // Ensure API access is tightly controlled and keys are not shared.
      const indexHtml = `${base}/shelby/v1/blobs/${account}/${prefix}index.html`;
      const indexJson = `${base}/shelby/v1/blobs/${account}/${prefix}index.json`;

      await cleanup();
      return res.json({
        albumId,
        prefix,
        account,
        photoCount: uploadedFiles.length,
        urls: {
          indexHtml,
          indexJson
        }
      });
    } catch (err) {
      await cleanup();
      const message = err instanceof Error ? err.message : "Unknown error.";
      return res.status(500).json({ error: message });
    }
  });

  req.pipe(busboy);
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Publisher listening on :${PORT}`);
});
