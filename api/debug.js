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
    const data = await r.json();

    return res.status(200).json({
      httpStatus: r.status,
      resultCode: data?.response?.header?.resultCode ?? "없음",
      resultMsg: data?.response?.header?.resultMsg ?? "없음",
      hasBody: !!data?.response?.body,
      itemsType: Array.isArray(data?.response?.body?.items) ? "array" : typeof data?.response?.body?.items,
      itemsLength: Array.isArray(data?.response?.body?.items) ? data.response.body.items.length : null,
      fullResponseKeys: data ? Object.keys(data) : null,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
