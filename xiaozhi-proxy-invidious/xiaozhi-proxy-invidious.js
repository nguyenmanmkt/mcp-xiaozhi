import express from "express";
import axios from "axios";
import { LRUCache } from "lru-cache";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5006;
const INVIDIOUS_BASE = process.env.INVIDIOUS_BASE || "https://invidious.thanhtan.net";

// === Cache bộ nhớ ===
const metaCache = new LRUCache({ max: 100, ttl: 1000 * 60 * 10 });
const audioCache = new LRUCache({ max: 10 });

// === Helper: Gọi Invidious API có cache ===
async function invidiousGet(pathUrl) {
  if (metaCache.has(pathUrl)) return metaCache.get(pathUrl);
  const fullUrl = `${INVIDIOUS_BASE}${pathUrl}`;
  const { data } = await axios.get(fullUrl, { timeout: 15000 });
  metaCache.set(pathUrl, data);
  return data;
}

// === Helper: Convert sang PCM ===
async function convertToPCM(buffer, ext = "webm") {
  const tmpInput = path.join(__dirname, `tmp_in.${ext}`);
  const tmpOutput = path.join(__dirname, `tmp_out.pcm`);
  fs.writeFileSync(tmpInput, buffer);

  return new Promise((resolve, reject) => {
    exec(
      `ffmpeg -y -i "${tmpInput}" -f s16le -acodec pcm_s16le -ar 44100 -ac 2 "${tmpOutput}"`,
      (err) => {
        fs.unlinkSync(tmpInput);
        if (err) return reject(err);
        const pcmBuffer = fs.readFileSync(tmpOutput);
        fs.unlinkSync(tmpOutput);
        resolve(pcmBuffer);
      }
    );
  });
}

// === /search?q=... ===
app.get("/search", async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: "Missing query" });
  try {
    const data = await invidiousGet(`/api/v1/search?q=${encodeURIComponent(q)}`);
    const result = data.map((v) => ({
      title: v.title,
      author: v.author,
      videoId: v.videoId,
      video_info: `/video_info?id=${v.videoId}`,
      thumbnail: v.videoThumbnails?.[0]?.url || "",
      lengthSeconds: v.lengthSeconds,
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Search failed", message: err.message });
  }
});

// === /video_info?id=... ===
app.get("/video_info", async (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: "Missing id" });
  try {
    const data = await invidiousGet(`/api/v1/videos/${encodeURIComponent(id)}`);
    const audio = (data.adaptiveFormats || data.formatStreams || []).find((f) =>
      /audio/i.test(f.type || f.mimeType || "")
    );
    res.json({
      title: data.title,
      author: data.author,
      videoId: id,
      description: data.description,
      duration: data.lengthSeconds,
      thumbnail: data.videoThumbnails?.[0]?.url || "",
      audio_url: audio ? `/proxy_audio?id=${id}` : null,
      mp3_url: `/proxy_mp3?id=${id}`,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch video info", message: err.message });
  }
});

// === /playlist?id=... ===
app.get("/playlist", async (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: "Missing id" });
  try {
    const data = await invidiousGet(`/api/v1/playlists/${encodeURIComponent(id)}`);
    const videos = data.videos?.map((v) => ({
      title: v.title,
      videoId: v.videoId,
      author: v.author,
      video_info: `/video_info?id=${v.videoId}`,
      thumbnail: v.videoThumbnails?.[0]?.url || "",
      lengthSeconds: v.lengthSeconds,
    }));
    res.json({ title: data.title, videoCount: data.videoCount, videos });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch playlist", message: err.message });
  }
});

// === /latest ===
app.get("/latest", async (req, res) => {
  try {
    const data = await invidiousGet(`/latest`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch latest", message: err.message });
  }
});

// === /trending ===
app.get("/trending", async (req, res) => {
  try {
    const data = await invidiousGet(`/api/v1/trending`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch trending", message: err.message });
  }
});

// === /annotation?id=... ===
app.get("/annotation", async (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: "Missing id" });
  try {
    const data = await invidiousGet(`/api/v1/annotations/${encodeURIComponent(id)}`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch annotation", message: err.message });
  }
});

// === /proxy_audio?id=... ===
app.get("/proxy_audio", async (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).send("Missing id");

  try {
    const info = await invidiousGet(`/api/v1/videos/${encodeURIComponent(id)}`);
    const formats =
      info.adaptiveFormats || info.formatStreams || info.formats || [];
    const firstAudio = formats.find((f) => /audio/i.test(f.type || f.mimeType || ""));
    if (!firstAudio?.url) return res.status(404).send("Audio not found");

    const range = req.headers.range;
    const config = {
      method: "GET",
      url: firstAudio.url,
      responseType: "stream",
      headers: { "User-Agent": "Xiaozhi-Invidious-Proxy/1.0" },
      timeout: 120000,
    };
    if (range) config.headers.Range = range;

    const upstreamResp = await axios(config);
    const headersToCopy = ["content-type", "content-length", "accept-ranges", "content-range"];
    headersToCopy.forEach((h) => {
      if (upstreamResp.headers[h]) res.setHeader(h, upstreamResp.headers[h]);
    });
    res.setHeader("Cache-Control", "public, max-age=86400");
    upstreamResp.data.pipe(res);
  } catch (err) {
    console.error("proxy_audio error:", err.message);
    res.status(500).send("Proxy audio failed");
  }
});

// === /proxy_mp3?id=... (nghe trực tiếp trên trình duyệt) ===
app.get("/proxy_mp3", async (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).send("Missing id");

  try {
    const info = await invidiousGet(`/api/v1/videos/${encodeURIComponent(id)}`);
    const formats = info.adaptiveFormats || info.formatStreams || info.formats || [];
    const audio = formats.find((f) => /audio/i.test(f.type || f.mimeType || ""));
    if (!audio?.url) return res.status(404).send("Audio not found");

    const { data } = await axios.get(audio.url, { responseType: "arraybuffer", timeout: 60000 });
    const tmpInput = path.join(__dirname, `tmp_${id}.webm`);
    const tmpOutput = path.join(__dirname, `tmp_${id}.mp3`);
    fs.writeFileSync(tmpInput, data);

    exec(
      `ffmpeg -y -i "${tmpInput}" -codec:a libmp3lame -qscale:a 2 "${tmpOutput}"`,
      (err) => {
        fs.unlinkSync(tmpInput);
        if (err) {
          console.error("ffmpeg mp3 error:", err.message);
          return res.status(500).send("MP3 conversion failed");
        }

        const mp3Buffer = fs.readFileSync(tmpOutput);
        fs.unlinkSync(tmpOutput);

        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Content-Length", mp3Buffer.length);
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.send(mp3Buffer);
      }
    );
  } catch (err) {
    console.error("proxy_mp3 error:", err.message);
    res.status(500).send("Proxy MP3 failed");
  }
});

// === /stream_pcm?song=... ===
app.get("/stream_pcm", async (req, res) => {
  try {
    const { song, artist = "" } = req.query;
    if (!song) return res.status(400).json({ error: "Missing song parameter" });

    const query = artist ? `${song} ${artist}` : song;
    console.log(`🔍 Searching for: ${query}`);
    const searchData = await invidiousGet(`/api/v1/search?q=${encodeURIComponent(query)}`);
    const top = searchData[0];
    if (!top) return res.status(404).json({ error: "Not found" });

    const videoId = top.videoId;
    if (!audioCache.has(videoId)) {
      const video = await invidiousGet(`/api/v1/videos/${videoId}`);
      const audio = (video.adaptiveFormats || []).find((f) => /audio/i.test(f.type || f.mimeType || ""));
      if (!audio?.url) return res.status(404).json({ error: "Audio not found" });

      const audioResp = await axios.get(audio.url, { responseType: "arraybuffer", timeout: 60000 });
      const pcmBuffer = await convertToPCM(Buffer.from(audioResp.data));
      audioCache.set(videoId, pcmBuffer);
    }

    res.json({
      title: top.title,
      author: top.author,
      videoId,
      audio_url: `/proxy_audio?id=${videoId}`,
      mp3_url: `/proxy_mp3?id=${videoId}`,
      thumbnail: top.videoThumbnails?.[0]?.url || "",
      duration: top.lengthSeconds,
    });
  } catch (err) {
    console.error("stream_pcm error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// === /health ===
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    invidious: INVIDIOUS_BASE,
    cache_entries: metaCache.size,
    cached_audio: audioCache.size,
  });
});

// === Startup log ===
app.listen(PORT, () => {
  console.log("=".repeat(60));
  console.log(`Xiaozhi Invidious Proxy running on port ${PORT}`);
  console.log(`Invidious base: ${INVIDIOUS_BASE}`);
  console.log("Endpoints:");
  console.log("  GET /search?q=...           -> search results (relative video_info paths)");
  console.log("  GET /video_info?id=...      -> metadata + audio stream relative paths");
  console.log("  GET /playlist?id=...        -> playlist info");
  console.log("  GET /latest                 -> latest videos");
  console.log("  GET /trending               -> trending");
  console.log("  GET /annotation?id=...      -> annotations/subtitles");
  console.log("  GET /proxy_audio?id=...     -> proxy and stream audio (supports Range header)");
  console.log("  GET /proxy_mp3?id=...       -> proxy MP3 for browser testing");
  console.log("  GET /stream_pcm?song=...    -> convert to PCM and cache (for ESP32)");
  console.log("  GET /health                 -> health");
  console.log("=".repeat(60));
});
