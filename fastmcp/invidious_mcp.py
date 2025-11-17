# invidious_mcp.py
from mcp.server.fastmcp import FastMCP
import requests
import os

# === Cấu hình ===
PROXY_BASE = os.getenv("INVIDIOUS_PROXY", "http://localhost:5006")

mcp = FastMCP("Invidious Music Player (via Proxy)")

# ==========================
# 🔍 Tìm kiếm video
# ==========================
@mcp.tool()
def search_video(query: str) -> dict:
    """Tìm kiếm video nhạc qua Invidious Proxy."""
    try:
        r = requests.get(f"{PROXY_BASE}/search", params={"q": query}, timeout=10)
        r.raise_for_status()
        data = r.json()
        if isinstance(data, list):
            results = [
                {
                    "title": v.get("title"),
                    "author": v.get("author"),
                    "videoId": v.get("videoId"),
                    "thumbnail": v.get("thumbnail"),
                    "length": v.get("lengthSeconds"),
                    "video_info_url": f"{PROXY_BASE}/video_info?id={v.get('videoId')}"
                }
                for v in data
            ]
            return {"success": True, "results": results[:10]}
        else:
            return {"success": False, "message": "Kết quả tìm kiếm không hợp lệ."}
    except Exception as e:
        return {"success": False, "message": f"Lỗi tìm kiếm: {e}"}


# ==========================
# 🎧 Lấy thông tin phát nhạc
# ==========================
@mcp.tool()
def get_video_info(videoId: str) -> dict:
    """Lấy thông tin và link phát nhạc từ proxy."""
    try:
        r = requests.get(f"{PROXY_BASE}/video_info", params={"id": videoId}, timeout=10)
        r.raise_for_status()
        data = r.json()

        return {
            "success": True,
            "title": data.get("title"),
            "author": data.get("author"),
            "duration": data.get("duration"),
            "thumbnail": data.get("thumbnail"),
            "audio_url": f"{PROXY_BASE}{data.get('audio_url')}" if data.get("audio_url") else None,
            "mp3_url": f"{PROXY_BASE}{data.get('mp3_url')}" if data.get("mp3_url") else None
        }
    except Exception as e:
        return {"success": False, "message": f"Lỗi lấy video info: {e}"}


# ==========================
# 🚀 Lấy danh sách trending
# ==========================
@mcp.tool()
def get_trending() -> dict:
    """Lấy danh sách video trending từ Invidious Proxy."""
    try:
        r = requests.get(f"{PROXY_BASE}/trending", timeout=10)
        r.raise_for_status()
        data = r.json()

        results = [
            {
                "title": v.get("title"),
                "author": v.get("author"),
                "videoId": v.get("videoId"),
                "thumbnail": (v.get("videoThumbnails") or [{}])[0].get("url", ""),
                "duration": v.get("lengthSeconds"),
                "video_info_url": f"{PROXY_BASE}/video_info?id={v.get('videoId')}"
            }
            for v in data[:10]
        ]
        return {"success": True, "results": results}
    except Exception as e:
        return {"success": False, "message": f"Lỗi trending: {e}"}


# ==========================
# 🔊 Phát nhạc dạng PCM (ESP32)
# ==========================
@mcp.tool()
def play_pcm(song: str, artist: str = "") -> dict:
    """Tìm bài hát và lấy link stream PCM (cho ESP32 phát trực tiếp)."""
    try:
        r = requests.get(f"{PROXY_BASE}/stream_pcm", params={"song": song, "artist": artist}, timeout=60)
        r.raise_for_status()
        data = r.json()
        if "audio_url" not in data:
            return {"success": False, "message": "Không tìm thấy bài hát hoặc không có luồng PCM."}

        return {
            "success": True,
            "title": data.get("title"),
            "author": data.get("author"),
            "audio_url": f"{PROXY_BASE}{data['audio_url']}",
            "thumbnail": data.get("thumbnail"),
            "duration": data.get("duration")
        }
    except Exception as e:
        return {"success": False, "message": f"Lỗi phát PCM: {e}"}


# ==========================
# 🩺 Kiểm tra tình trạng proxy
# ==========================
@mcp.tool()
def health_check() -> dict:
    """Kiểm tra tình trạng hoạt động của Invidious Proxy."""
    try:
        r = requests.get(f"{PROXY_BASE}/health", timeout=5)
        r.raise_for_status()
        data = r.json()
        return {"success": True, "proxy_status": data}
    except Exception as e:
        return {"success": False, "message": f"Lỗi khi kiểm tra: {e}"}


# === Khởi chạy server MCP ===
if __name__ == "__main__":
    mcp.run(transport="stdio")
