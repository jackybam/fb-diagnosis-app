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
    // "동백1동,동백2동,동백3동"처럼 콤마로 여러 개가 올 수 있음 (동백동으로 묶어서 보여준 경우)
    const adongCds = adongCd.split(",").map((s) => s.trim()).filter(Boolean);

    // 1차: 세부 업종(예: "치즈탕수육"이 속한 "기타 중식")으로 시도
    // 2차: 안 잡히면 대분류(예: "중식")로 넓혀서 시도 — 가짜 추정치보다 넓은 범위의 진짜 데이터가 낫다는 판단
    // 중분류/소분류 조회는 서로 안 기다리고 동시에 쏨 (캐시 덕분에 두 번째 호출부턴 사실상 즉시 반환됨)
    async function tryMatch(keyword) {
      if (!keyword) return { codes: [], codeField: null };
      const [middleCodes, smallCodes] = await Promise.all([
        findUpjongCode(serviceKey, "middle", keyword),
        findUpjongCode(serviceKey, "small", keyword),
      ]);
      if (middleCodes.length > 0) return { codes: middleCodes, codeField: "indsMclsCd" };
      return { codes: smallCodes, codeField: "indsSclsCd" };
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

    // 동(여러 개일 수 있음) × 업종코드(여러 개일 수 있음) 조합을 병렬로 전부 조회 후 합산
    // (순서대로 하나씩 기다리면 느려서, 한꺼번에 쏘고 다 끝나길 기다리는 방식으로 변경)
    const tasks = [];
    for (const dongCode of adongCds) {
      for (const c of codes) {
        const codeValue = c[codeField] || c.indsMclsCd || c.indsSclsCd;
        if (!codeValue) continue;
        tasks.push(countStoresInDong(serviceKey, dongCode, { [codeField]: codeValue }));
      }
    }
    const counts = await Promise.all(tasks);
    const total = counts.reduce((sum, n) => sum + n, 0);

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

