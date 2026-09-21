import { findUpjongCode, countStoresInDong } from "./_lib.js";

export default async function handler(req, res) {
  try {
    const { adongCd = "", biz = "", bizMajor = "" } = req.query;
    const serviceKey = process.env.SBIZ_API_KEY;
    if (!serviceKey) {
      return res.status(500).json({ error: "SBIZ_API_KEY 환경변수가 설정되지 않았습니다." });
    }
    if (!adongCd) {
      return res.status(400).json({ error: "adongCd가 필요합니다." });
    }

    // 1차: 세부 업종(예: "치즈탕수육"이 속한 "기타 중식")으로 시도
    // 2차: 안 잡히면 대분류(예: "중식")로 넓혀서 시도 — 가짜 추정치보다 넓은 범위의 진짜 데이터가 낫다는 판단
    async function tryMatch(keyword) {
      if (!keyword) return { codes: [], codeField: null };
      let codes = await findUpjongCode(serviceKey, "middle", keyword);
      let codeField = "indsMclsCd";
      if (codes.length === 0) {
        codes = await findUpjongCode(serviceKey, "small", keyword);
        codeField = "indsSclsCd";
      }
      return { codes, codeField };
    }

    let { codes, codeField } = await tryMatch(biz);
    let matchLevel = "sub"; // 세부업종 기준으로 잡힘

    if (codes.length === 0 && bizMajor) {
      ({ codes, codeField } = await tryMatch(bizMajor));
      matchLevel = "major"; // 대분류로 넓혀서 잡힘
    }

    if (codes.length === 0) {
      return res.status(404).json({ error: `"${biz}"/"${bizMajor}"에 해당하는 업종 코드를 찾지 못했습니다.` });
    }

    // 여러 개 걸리면(예: "중식"이 여러 세부 업종에 걸칠 수 있음) 모두 합산
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
      matchLevel, // "sub" | "major" — 프론트에서 태그 문구 다르게 표시
      matchedUpjong: codes.map((c) => c.indsMclsNm || c.indsSclsNm || c.indsLclsNm).filter(Boolean),
      storeCount: total,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}

