// 임시 디버그 엔드포인트 — 실제 업종 중/소분류 명칭 확인용. 확인 후 삭제할 것.
const BASE = "https://apis.data.go.kr/B553077/api/open/sdsc2";

export default async function handler(req, res) {
  try {
    const { contains = "", group = "" } = req.query;
    const serviceKey = process.env.SBIZ_API_KEY;
    if (!serviceKey) {
      return res.status(500).json({ error: "SBIZ_API_KEY 없음" });
    }

    const smallRes = await fetch(`${BASE}/smallUpjongList?serviceKey=${serviceKey}&type=json`);
    const smallData = await smallRes.json();
    const smallItems = smallData?.body?.items ?? [];

    if (group) {
      // 전체 소분류를 중분류(indsMclsNm)별로 묶어서 반환 — 우리 세부업종 목록 다시 짜는 데 씀
      const grouped = {};
      for (const it of smallItems) {
        const key = it.indsMclsNm || "(미상)";
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(it.indsSclsNm);
      }
      return res.status(200).json({ totalSmall: smallItems.length, grouped });
    }

    const filterFn = (it) =>
      !contains || Object.values(it).some((v) => String(v).includes(contains));

    return res.status(200).json({
      smallCount: smallItems.length,
      smallSample: smallItems.filter(filterFn).slice(0, 30),
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
