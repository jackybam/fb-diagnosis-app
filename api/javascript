// 임시 디버그 엔드포인트 — 문제 원인 파악 후 삭제할 것
const BASE = "https://apis.data.go.kr/B553077/api/open/sdsc2";

export default async function handler(req, res) {
  try {
    const serviceKey = process.env.SBIZ_API_KEY;
    if (!serviceKey) {
      return res.status(500).json({ error: "SBIZ_API_KEY 없음" });
    }
    const url = `${BASE}/baroApi?serviceKey=${serviceKey}&resId=dong&catId=admi&type=json`;
    const r = await fetch(url);
    const text = await r.text(); // json 파싱 전 원문 그대로 먼저 확인
    return res.status(200).json({
      httpStatus: r.status,
      rawLength: text.length,
      rawFirst2000: text.slice(0, 2000),
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
