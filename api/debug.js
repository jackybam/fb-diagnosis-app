// 임시 디버그 엔드포인트 — 문제 원인 파악 후 삭제할 것
import { fetchDongList, suggestDong } from "./_lib.js";

export default async function handler(req, res) {
  try {
    const serviceKey = process.env.SBIZ_API_KEY;
    if (!serviceKey) {
      return res.status(500).json({ error: "SBIZ_API_KEY 없음" });
    }
    const list = await fetchDongList(serviceKey);
    const rawMatches = list.filter((it) =>
      `${it.ctprvnNm || ""}${it.signguNm || ""}${it.adongNm || ""}`.includes("기흥구")
    );
    const suggestResult = suggestDong(list, "기흥구", 8);

    return res.status(200).json({
      totalListLength: list.length,
      sampleFirstItem: list[0] || null,
      sampleLastItem: list[list.length - 1] || null,
      rawMatchCount: rawMatches.length,
      rawMatchSample: rawMatches.slice(0, 3),
      suggestDongResult: suggestResult,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e), stack: e.stack });
  }
}
