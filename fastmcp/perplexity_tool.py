from fastmcp import FastMCP
from perplexity import Perplexity

mcp = FastMCP("Perplexity Query Tool")

@mcp.tool(
    name="perplexity_query",
    description="""
    Công cụ tra cứu và tổng hợp thông tin từ Internet qua Perplexity AI.
    Có 2 chế độ:
    - Chế độ 'search': tìm kiếm nhiều nguồn/ngữ liệu, trả về danh sách kết quả (title, url, snippet). Phù hợp khi cần crawl link, tìm nguồn, kiểm chứng, lấy reference cho các chủ đề kỹ thuật, tài chính, công nghệ, v.v.
    - Chế độ 'chat': tổng hợp, phân tích chuyên sâu, giải thích, tóm tắt sự kiện, hoặc lấy dữ liệu dạng bảng/JSON (dùng được schema nếu cần). Phù hợp cho truy vấn tư vấn, tóm tắt, AI tổng hợp hoặc trả lời trực tiếp cho người dùng.
    Tuỳ nhu cầu, agent có thể truyền mode phù hợp để nhận đúng dạng dữ liệu cho automation, UI, hoặc báo cáo.
    """
)
def perplexity_query(input: dict) -> dict:
    """
    Args:
        input: dict chứa query và mode; ví dụ:
            {
                "mode": "search" hoặc "chat",
                "query": ...    # query string, hoặc list query (cho search)
                "schema": ...   # optional: schema cho chat khi cần output dạng bảng
            }
    Returns:
        dict kết quả chuẩn hoá, tuỳ mode (list kết quả search, tổng hợp hoặc bảng/data cho chat)
    """
    client = Perplexity()
    mode = input.get("mode", "chat")
    query = input.get("query", "")
    schema = input.get("schema")

    try:
        if mode == "search":
            # Nếu truyền vào là list hoặc string đều xử lý được
            result = client.search.create(query=query if isinstance(query, list) else [query])
            out = [{"title": r.title, "url": r.url, "snippet": getattr(r, "snippet", "")} for r in result.results]
            return {"success": True, "mode": "search", "results": out}

        elif mode == "chat":
            params = {
                "messages": [{"role": "user", "content": query}],
                "model": "sonar"
            }
            if schema:
                params["response_format"] = {"type": "json_schema", "json_schema": {"schema": schema}}
            completion = client.chat.completions.create(**params)
            return {"success": True, "mode": "chat", "result": completion.choices[0].message.content}
        else:
            return {"success": False, "error": "Chưa hỗ trợ chế độ này"}
    except Exception as e:
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    mcp.run(transport="stdio")
