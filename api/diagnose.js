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

    // 코드 하나를 { field, value, name } 형태로 통일 (중분류/소분류가 섞여도 각자 자기 필드를 들고 다니게)
    function toEntries(codes, field) {
      return codes
        .map((c) => ({ field, value: c[field], name: c.indsMclsNm || c.indsSclsNm || c.indsLclsNm }))
        .filter((e) => e.value);
    }

    async function tryMatchOne(keyword) {
      if (!keyword) return [];
      const [middleCodes, smallCodes] = await Promise.all([
        findUpjongCode(serviceKey, "middle", keyword),
        findUpjongCode(serviceKey, "small", keyword),
      ]);
      if (middleCodes.length > 0) return toEntries(middleCodes, "indsMclsCd");
      return toEntries(smallCodes, "indsSclsCd");
    }

    // "국/탕/찌개류"처럼 실제 정부 업종명 자체에 "/"가 들어있는 경우가 많아서,
    // 1차로 문자열 그대로 정확히 시도하고, 그게 실패할 때만 토큰별로 쪼개서 재시도한다.
    async function tryMatch(keyword) {
      const exact = await tryMatchOne(keyword);
      if (exact.length > 0) return exact;

      const tokens = keyword.split(/[\/,·]/).map((s) => s.trim()).filter(Boolean);
      if (tokens.length <= 1) return exact; // 쪼갤 것도 없으면 그대로 실패

      const results = await Promise.all(tokens.map((t) => tryMatchOne(t)));
      const merged = [];
      const seen = new Set();
      for (const entries of results) {
        for (const e of entries) {
          const key = e.field + ":" + e.value;
          if (!seen.has(key)) {
            seen.add(key);
            merged.push(e);
          }
        }
      }
      return merged;
    }

    let entries = await tryMatch(biz);
    let matchLevel = "sub"; // 세부업종 기준으로 잡힘

    if (entries.length === 0 && bizMajor) {
      entries = await tryMatch(bizMajor);
      matchLevel = "major"; // 대분류로 넓혀서 잡힘
    }

    if (entries.length === 0) {
      return res.status(404).json({ error: `"${biz}"/"${bizMajor}"에 해당하는 업종 코드를 찾지 못했습니다.` });
    }

    // 동(여러 개일 수 있음) × 업종코드(여러 개일 수 있음) 조합을 병렬로 전부 조회 후 합산
    const tasks = [];
    for (const dongCode of adongCds) {
      for (const e of entries) {
        tasks.push(countStoresInDong(serviceKey, dongCode, { [e.field]: e.value }));
      }
    }
    const counts = await Promise.all(tasks);
    const total = counts.reduce((sum, n) => sum + n, 0);

    return res.status(200).json({
      adongCd,
      biz,
      matchLevel, // "sub" | "major" — 프론트에서 태그 문구 다르게 표시
      matchedUpjong: entries.map((e) => e.name).filter(Boolean),
      storeCount: total,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}

