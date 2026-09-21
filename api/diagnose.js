import { findUpjongCode, countStoresInDong } from "./_lib.js";

// 프론트 드롭다운 값 → 검색용 키워드 매핑
const BIZ_KEYWORD = {
  "한식": "한식",
  "중식": "중식",
  "일식": "일식",
  "카페/디저트": "카페",
  "치킨/주점": "치킨",
  "분식": "분식",
  "양식": "양식",
};

export default async function handler(req, res) {
  try {
    const { adongCd = "", biz = "" } = req.query;
    const serviceKey = process.env.SBIZ_API_KEY;
    if (!serviceKey) {
      return res.status(500).json({ error: "SBIZ_API_KEY 환경변수가 설정되지 않았습니다." });
    }
    if (!adongCd) {
      return res.status(400).json({ error: "adongCd가 필요합니다. 먼저 /api/geo로 지역을 확인하세요." });
    }

    const keyword = BIZ_KEYWORD[biz] || biz;

    // 중분류에서 먼저 찾고, 없으면 소분류까지 확장
    let codes = await findUpjongCode(serviceKey, "middle", keyword);
    let codeField = "indsMclsCd";
    if (codes.length === 0) {
      codes = await findUpjongCode(serviceKey, "small", keyword);
      codeField = "indsSclsCd";
    }

    if (codes.length === 0) {
      return res.status(404).json({ error: `"${biz}"에 해당하는 업종 코드를 찾지 못했습니다.` });
    }

    // 여러 개 걸리면(예: "한식"이 여러 세부 업종에 걸칠 수 있음) 모두 합산
    let total = 0;
    for (const c of codes) {
      const codeValue = c[codeField] || c.indsMclsCd || c.indsSclsCd;
      if (!codeValue) continue;
      const count = await countStoresInDong(serviceKey, adongCd, { [codeField]: codeValue });
      total += count;
    }

    return res.status(200).json({
      adongCd,
      biz,
      matchedUpjong: codes.map((c) => c.indsMclsNm || c.indsSclsNm || c.indsLclsNm).filter(Boolean),
      storeCount: total, // 실제 동일업종 매장 수 — "업종 밀집도"의 진짜 데이터
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
