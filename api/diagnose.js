import { findUpjongCode, countStoresInDong, runWithConcurrencyLimit } from "./_lib.js";
import { getPopulationForRegion } from "./_population.js";
import { cacheGet, cacheSet } from "./_cache.js";

// "전체" 업종 모드는 세부업종이 많아서(예: 한식 13개) 동(dong) × 업종코드 조합이 수십 개까지
// 늘어날 수 있는데, 이걸 한 번에 다 동시에 쏘면 공공 API 쪽 트래픽 버스트 제한에 걸려서
// 무더기로 실패하는 걸 실제로 확인함(양식 전체처럼 조합이 몇 개 안 되는 경우도 재현됨).
// 그래서 한 번에 나가는 요청 수를 이 정도로 제한한다.
const SBIZ_CONCURRENCY = 4;

// 매장 수/인구 데이터는 분기~월 단위로만 실제로 바뀌는 자료라, 같은 지역+업종 조합을 다른
// 사람이 다시 물어보면 정부 API를 또 부르지 않고 이 시간 동안은 캐시된 값을 재사용한다.
// (동시 접속자가 많을 때 실제 API 호출량 자체를 줄여서 트래픽 버스트/일일 쿼터 문제를 완화)
const CACHE_TTL_SECONDS = 24 * 60 * 60;

export default async function handler(req, res) {
  try {
    const { adongCd = "", biz = "", bizMajor = "", ctprvnNm = "", signguNm = "", dongLabel = "" } = req.query;
    const serviceKey = process.env.SBIZ_API_KEY;
    if (!serviceKey) {
      return res.status(500).json({ error: "SBIZ_API_KEY 환경변수가 설정되지 않았습니다." });
    }
    if (!adongCd) {
      return res.status(400).json({ error: "adongCd가 필요합니다." });
    }

    const cacheKey = `diag:v1:${adongCd}|${biz}|${bizMajor}|${ctprvnNm}|${signguNm}|${dongLabel}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      return res.status(200).json({ ...cached, cached: true });
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

    // biz가 "치킨,버거,피자"처럼 콤마로 여러 개 올 수 있음 ("전체" 옵션 — 대분류 안 세부업종 다 합산)
    async function tryMatchAll(bizString) {
      const pieces = bizString.split(",").map((s) => s.trim()).filter(Boolean);
      const results = await Promise.all(pieces.map((p) => tryMatch(p)));
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

    let entries = await tryMatchAll(biz);
    let matchLevel = "sub"; // 세부업종 기준으로 잡힘

    if (entries.length === 0 && bizMajor) {
      entries = await tryMatch(bizMajor);
      matchLevel = "major"; // 대분류로 넓혀서 잡힘
    }

    if (entries.length === 0) {
      return res.status(404).json({ error: `"${biz}"/"${bizMajor}"에 해당하는 업종 코드를 찾지 못했습니다.` });
    }

    // 동(여러 개일 수 있음) × 업종코드(여러 개일 수 있음) 조합을 조회 후 합산.
    // "전체" 모드는 세부업종이 많아서(예: 한식 13개) 이 조합 개수가 수십 개까지 늘어날 수 있는데,
    // 예전엔 Promise.all이라 이 중 단 하나라도 실패하면(SBIZ 쪽 순간적인 트래픽 제한 등) 전체가
    // 실패로 처리돼서 실데이터가 멀쩡히 몇 개는 들어왔는데도 전부 "추정"으로 빠졌었음.
    // Promise.allSettled로 바꿔서 부분 실패는 넘어가게 했었는데, 그래도 "양식 전체"처럼 조합이
    // 몇 개 안 되는 경우에도 전부 다 같이 실패하는 게 재현됨 — 조합을 전부 동시에 쏘는 것
    // 자체가 공공 API 트래픽 버스트 제한에 걸리는 게 원인이라, runWithConcurrencyLimit으로
    // 동시 요청 수 자체를 제한하고(countStoresInDong 안에도 재시도 추가) 실패 확률을 낮춘다.
    const combos = [];
    for (const dongCode of adongCds) {
      for (const e of entries) {
        combos.push({ dongCode, e });
      }
    }
    const settled = await runWithConcurrencyLimit(combos, SBIZ_CONCURRENCY, ({ dongCode, e }) =>
      countStoresInDong(serviceKey, dongCode, { [e.field]: e.value })
    );
    const succeeded = settled.filter((s) => s.status === "fulfilled");
    const failedCount = settled.length - succeeded.length;
    if (succeeded.length === 0 && combos.length > 0) {
      // 전부 실패하면 0곳이라고 거짓으로 알리지 말고, 에러로 처리해서 프론트가 "추정"으로 빠지게 함
      throw new Error("상가업소 조회가 전부 실패했습니다 (SBIZ API 일시적 오류일 수 있음)");
    }
    const total = succeeded.reduce((sum, s) => sum + s.value, 0);

    // 인구 대비 밀도(1만명당 매장 수). 행정안전부 인구 통계 파일(월 갱신, api/data/dong-population.json)을
    // 동 이름 기준으로 매칭해서 계산 — 매칭 실패하면 population은 null, 프론트에서 "추정" 처리.
    const popInfo = getPopulationForRegion(ctprvnNm, signguNm, dongLabel);
    const population = popInfo ? popInfo.population : null;
    const densityPer10k = population ? Math.round((total / population) * 10000 * 10) / 10 : null;

    const result = {
      adongCd,
      biz,
      matchLevel, // "sub" | "major" — 프론트에서 태그 문구 다르게 표시
      matchedUpjong: entries.map((e) => e.name).filter(Boolean),
      storeCount: total,
      partial: failedCount > 0, // 일부 세부업종 조회가 실패해서 매장 수가 실제보다 적게 잡혔을 수 있음
      population,
      densityPer10k, // 인구 1만명당 매장 수 (population 매칭 실패 시 null)
    };

    // partial(일부만 반영된 결과)은 캐싱하지 않음 — 다음 사람이 물어볼 땐 다시 시도해서
    // 온전한 값을 받을 기회를 주는 게 낫다 (실패가 캐시로 굳어버리면 안 됨).
    // await하는 이유: 서버리스 함수는 응답을 보내고 나면 곧바로 인스턴스가 멈출 수 있어서,
    // await 없이 던져두면(fire-and-forget) 저장이 끝나기 전에 죽어서 캐시가 안 될 수 있음.
    if (!result.partial) {
      await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
    }

    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
