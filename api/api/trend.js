// 네이버 검색어 트렌드 (NAVER API HUB) 연동
// 문서: https://api.ncloud-docs.com/docs/naver-api-hub-search-trend
//
// v4 — v3에서 "관심도 지수"가 0.2%처럼 비정상적으로 낮게 나오던 버그를 고침.
//
// 원인: 네이버 트렌드 API는 한 번의 요청에 여러 keywordGroups를 같이 보내면, 그 요청 안에서
// "제일 검색량이 큰 그룹의 피크 = 100"으로 전체를 공동 정규화(joint normalization)해서 돌려줌.
// v3는 itemLevel을 계산할 때도 item+narrowRef+broadRef를 한 요청에 같이 보냈는데, broadRef(예:
// "파스타" 같은 대분류 대표 키워드)는 "먹물파스타" 같은 구체적 메뉴보다 검색량이 압도적으로 커서,
// item 자신의 값이 "자기 자신의 12개월 내 위치"가 아니라 "그 요청에서 제일 큰 그룹(대분류) 대비
// 얼마나 작은지"로 눌려버렸음 — 그래서 카테고리 비교를 안 하려던 원래 의도와 반대로,
// 오히려 대분류 검색량에 좌우되는 숫자가 나왔던 것.
//
// 고침: 요청을 두 개로 분리.
// 1) solo 요청 — item 혼자만 보내서, 이 아이템 자기 자신의 12개월 피크 = 100인 진짜
//    자기참조(self-referential) 지수를 얻음. (아래 "관심도 지수" = itemLevel)
// 2) joint 요청 — item + narrowRef + broadRef를 같이 보내서, 같은 정규화 상수를 공유하는 상태에서
//    "item 비율 / ref 비율" 비를 구함. 이 비율은 두 값이 같은 정규화 상수로 스케일되므로 그
//    상수가 얼마든 상관없이(분자분모에서 상쇄) 실제 검색량 비율과 같음 — 그래서 이 비율 계산에는
//    joint 요청이 맞고, 오히려 이게 필요한 이유임 (item과 ref가 다른 요청에서 오면 비교가 불가능).
//    이걸로 "3개월 전 대비 카테고리 비중 변화"(위쪽 훅 "+X%p")를 구함.
//
// 즉 "관심도 지수"(itemLevel)와 "위쪽 훅"(shareChangePp)은 서로 다른 API 요청 결과에서 나오고,
// 완전히 다른 질문에 답한다: 하나는 "이 아이템 자체가 요즘 뜨는 중인가", 하나는 "카테고리 안에서
// 비중이 커지는 중인가".
import { cacheGet, cacheSet } from "./_cache.js";

const ESCALATE_THRESHOLD_PCT = 40;
const WINDOW_MONTHS = 12;
const SHARE_LOOKBACK_MONTHS = 3;
// 검색 트렌드는 월 단위 데이터라 하루 안에서는 거의 안 바뀜 — 같은 검색어를 다른 사람이
// 다시 물어보면 네이버를 또 부르지 않고 이 시간 동안 캐시된 값을 재사용한다.
const CACHE_TTL_SECONDS = 6 * 60 * 60;

async function callNaver(clientId, clientSecret, startDate, endDate, keywordGroups) {
  const r = await fetch("https://naverapihub.apigw.ntruss.com/search-trend/v1/search", {
    method: "POST",
    headers: {
      "X-NCP-APIGW-API-KEY-ID": clientId,
      "X-NCP-APIGW-API-KEY": clientSecret,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ startDate, endDate, timeUnit: "month", keywordGroups }),
  });
  const data = await r.json();
  if (!r.ok) {
    const err = new Error("네이버 API 호출 실패");
    err.detail = data;
    throw err;
  }
  return data;
}

export default async function handler(req, res) {
  try {
    const { keyword = "", ref = "", broadRef = "" } = req.query;
    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: "NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 없습니다." });
    }
    if (!keyword) {
      return res.status(400).json({ error: "keyword가 필요합니다." });
    }

    const cacheKey = `trend:v1:${keyword}|${ref}|${broadRef}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      return res.status(200).json({ ...cached, cached: true });
    }

    const today = new Date();
    const endDate = today.toISOString().slice(0, 10);
    const startDateObj = new Date(today);
    startDateObj.setMonth(startDateObj.getMonth() - WINDOW_MONTHS);
    const startDate = startDateObj.toISOString().slice(0, 10);

    // narrow/broad 준비 (joint 요청용)
    const jointGroups = [{ groupName: keyword, keywords: [keyword] }];
    const jointOrder = ["item"];
    if (ref && ref !== keyword) {
      jointGroups.push({ groupName: ref, keywords: [ref] });
      jointOrder.push("narrow");
    }
    if (broadRef && broadRef !== ref && broadRef !== keyword) {
      jointGroups.push({ groupName: broadRef, keywords: [broadRef] });
      jointOrder.push("broad");
    }
    const needsJoint = jointOrder.length > 1;

    // solo(itemLevel용)와 joint(shareChangePp용)를 병렬로 호출 — 필요할 때만 joint를 호출.
    const [soloData, jointData] = await Promise.all([
      callNaver(clientId, clientSecret, startDate, endDate, [{ groupName: keyword, keywords: [keyword] }]),
      needsJoint ? callNaver(clientId, clientSecret, startDate, endDate, jointGroups) : Promise.resolve(null),
    ]);

    const itemSeries = soloData?.results?.[0]?.data || [];
    if (itemSeries.length === 0) {
      const emptyResult = { keyword, hasItemLevel: false, comparedToRef: false, series: [] };
      await cacheSet(cacheKey, emptyResult, CACHE_TTL_SECONDS);
      return res.status(200).json(emptyResult);
    }

    // 1) itemLevel — item 혼자만 보낸 요청이라, "이 12개월 구간에서 이 아이템 자신의 피크=100"
    // 기준으로 지금이 어디쯤인지가 그대로 나옴. 카테고리 비교 없음.
    const itemLevel = Math.round((itemSeries[itemSeries.length - 1]?.ratio ?? 0) * 10) / 10;

    // 2) shareChangePp — joint 요청(있을 때만)에서, item과 ref가 같은 정규화 상수를 공유하는
    // 상태의 비율로 계산. "3개월 전 대비 카테고리 비중 변화".
    let shareChangePp = null;
    let usedRef = null;
    let usedLevel = null;
    let comparedToRef = false;

    if (needsJoint && jointData) {
      const seriesByRole = {};
      jointOrder.forEach((role, i) => {
        seriesByRole[role] = jointData?.results?.[i]?.data || [];
      });
      const jointItemSeries = seriesByRole.item || [];
      const lastIdx = jointItemSeries.length - 1;
      const pastIdx = Math.max(0, lastIdx - SHARE_LOOKBACK_MONTHS);

      function shareAt(refSeries, idx) {
        const refRatio = refSeries?.[idx]?.ratio ?? 0;
        const itemRatio = jointItemSeries[idx]?.ratio ?? 0;
        if (refRatio <= 0) return null;
        return Math.round((itemRatio / refRatio) * 1000) / 10;
      }
      function shareDelta(refSeries) {
        const last = shareAt(refSeries, lastIdx);
        const past = shareAt(refSeries, pastIdx);
        if (last === null || past === null) return null;
        return { last, past };
      }

      const narrowFL = shareDelta(seriesByRole.narrow);
      const broadFL = shareDelta(seriesByRole.broad);

      let chosen = null;
      if (narrowFL && narrowFL.last <= ESCALATE_THRESHOLD_PCT) {
        chosen = narrowFL; usedRef = ref; usedLevel = "narrow";
      } else if (broadFL) {
        chosen = broadFL; usedRef = broadRef; usedLevel = "broad";
      } else if (narrowFL) {
        chosen = narrowFL; usedRef = ref; usedLevel = "narrow";
      }

      if (chosen) {
        comparedToRef = true;
        shareChangePp = Math.round((chosen.last - chosen.past) * 10) / 10;
      }
    }

    const result = {
      keyword,
      hasItemLevel: true,
      itemLevel, // "관심도 지수" — 카테고리 비교 없는, 이 아이템 자체의 12개월 내 자기참조 위치(0~100)
      ref: comparedToRef ? usedRef : null,
      refLevel: comparedToRef ? usedLevel : null,
      comparedToRef,
      shareChangePp, // 훅 "+X%p"
      series: itemSeries,
    };
    await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
