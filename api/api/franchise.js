// 프랜차이즈 탭 — "인근 동일 브랜드 매장 수" 실데이터.
//
// SBIZ 상권정보 API엔 상호명(bizesNm)으로 검색하는 파라미터가 따로 없음 (디버그 엔드포인트로
// 직접 확인함 — 문서에도 없고 실제로도 안 됨). 그래서 방식을 이렇게 잡음:
// 1) 그 동네의 "음식" 대분류 상가 목록을 통째로 받아온다 (indsLclsCd로 좁혀서 — 안 좁히면
//    동 하나에 수백~수천 개까지 나와서 numOfRows 안에 다 못 들어옴. 음식으로 좁히면 보통
//    한 동에 200개 안팎이라 한 번에 다 받을 수 있음 — 동백1동 기준 179개로 확인함).
// 2) 우리 코드에서 bizesNm(상호명)+brchNm(지점명)에 브랜드명이 포함되는지 직접 걸러낸다.
//
// 이러면 동네 안 음식점이 numOfRows보다 많은 초대형 상권(강남역 등)에선 일부만 확인하게
// 되는데, 그 경우엔 partial:true로 정직하게 표시한다.
import { findUpjongCode, listStoresInDong, runWithConcurrencyLimit } from "./_lib.js";
import { cacheGet, cacheSet } from "./_cache.js";

const DONG_CONCURRENCY = 3; // adongCds 개수(보통 1~3개)만큼 병렬 조회
const MAX_ROWS_PER_DONG = 500; // 동 하나당 "음식" 카테고리 최대 조회 개수
const CACHE_TTL_SECONDS = 24 * 60 * 60; // 매장 목록도 분기 단위로만 바뀌는 자료라 동일하게 24시간

function normBrand(s) {
  return (s || "").replace(/\s+/g, "").toLowerCase();
}

export default async function handler(req, res) {
  try {
    const { adongCd = "", brand = "" } = req.query;
    const serviceKey = process.env.SBIZ_API_KEY;
    if (!serviceKey) {
      return res.status(500).json({ error: "SBIZ_API_KEY 환경변수가 설정되지 않았습니다." });
    }
    if (!adongCd) {
      return res.status(400).json({ error: "adongCd가 필요합니다." });
    }
    if (!brand) {
      return res.status(400).json({ error: "brand가 필요합니다." });
    }

    const cacheKey = `fran:v1:${adongCd}|${brand}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      return res.status(200).json({ ...cached, cached: true });
    }

    const adongCds = adongCd.split(",").map((s) => s.trim()).filter(Boolean);

    // "음식" 대분류 코드를 찾는다 (기존 findUpjongCode 재사용 — 키워드로 실제 코드 검색).
    const foodCodes = await findUpjongCode(serviceKey, "large", "음식");
    const indsLclsCd = foodCodes[0]?.indsLclsCd;
    if (!indsLclsCd) {
      throw new Error('"음식" 대분류 코드를 찾지 못했습니다.');
    }

    const settled = await runWithConcurrencyLimit(adongCds, DONG_CONCURRENCY, (dongCode) =>
      listStoresInDong(serviceKey, dongCode, { indsLclsCd }, MAX_ROWS_PER_DONG)
    );
    const succeeded = settled.filter((s) => s.status === "fulfilled");
    const failedCount = settled.length - succeeded.length;
    if (succeeded.length === 0 && adongCds.length > 0) {
      throw new Error("상가업소 조회가 전부 실패했습니다 (SBIZ API 일시적 오류일 수 있음)");
    }

    const normedBrand = normBrand(brand);
    const matched = [];
    let cappedAny = false;
    for (const s of succeeded) {
      const { items, totalCount } = s.value;
      // 한 동네 음식점이 MAX_ROWS_PER_DONG보다 많아서 일부만 받아온 경우 — 못 본 매장 중에
      // 동일 브랜드가 더 있을 수 있으니 정직하게 partial 처리
      if (totalCount > items.length) cappedAny = true;
      for (const it of items) {
        const name = normBrand((it.bizesNm || "") + (it.brchNm || ""));
        if (name.includes(normedBrand)) {
          matched.push({
            name: it.bizesNm,
            branch: it.brchNm || null,
            addr: it.rdnmAdr || it.lnoAdr || null,
          });
        }
      }
    }

    const result = {
      adongCd,
      brand,
      sameBrandNearby: matched.length,
      matchedStores: matched.slice(0, 10), // 리포트에 너무 길게 나열되지 않게 최대 10개만
      partial: failedCount > 0 || cappedAny,
    };

    // partial(일부만 확인된 결과)은 캐싱하지 않음 — 다음 요청 땐 온전히 다시 시도할 기회를 줌.
    if (!result.partial) {
      await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
    }

    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
