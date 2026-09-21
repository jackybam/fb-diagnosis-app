import { fetchDongList, suggestDong } from "./_lib.js";

export default async function handler(req, res) {
  try {
    const { q = "" } = req.query;
    const serviceKey = process.env.SBIZ_API_KEY;
    if (!serviceKey) {
      return res.status(500).json({ error: "SBIZ_API_KEY 환경변수가 설정되지 않았습니다." });
    }
    if (!q || q.trim().length < 2) {
      return res.status(200).json({ results: [] }); // 너무 짧으면 빈 목록
    }

    const list = await fetchDongList(serviceKey);
    const results = suggestDong(list, q, 8);
    return res.status(200).json({ results });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
