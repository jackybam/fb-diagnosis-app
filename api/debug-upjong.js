// 임시 디버그 엔드포인트 — 실제 업종 중/소분류 명칭 확인용. 확인 후 삭제할 것.
const BASE = "https://apis.data.go.kr/B553077/api/open/sdsc2";

export default async function handler(req, res) {
  try {
    const { contains = "" } = req.query;
    const serviceKey = process.env.SBIZ_API_KEY;
    if (!serviceKey) {
      return res.status(500).json({ error: "SBIZ_API_KEY 없음" });
    }

    const [middleRes, smallRes] = await Promise.all([
      fetch(`${BASE}/middleUpjongList?serviceKey=${serviceKey}&type=json`),
      fetch(`${BASE}/smallUpjongList?serviceKey=${serviceKey}&type=json`),
    ]);
    const middleData = await middleRes.json();
    const smallData = await smallRes.json();

    const middleItems = middleData?.body?.items ?? [];
    const smallItems = smallData?.body?.items ?? [];

    const filterFn = (it) =>
      !contains || Object.values(it).some((v) => String(v).includes(contains));

    return res.status(200).json({
      middleCount: middleItems.length,
      smallCount: smallItems.length,
      middleSample: middleItems.filter(filterFn).slice(0, 30),
      smallSample: smallItems.filter(filterFn).slice(0, 30),
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
