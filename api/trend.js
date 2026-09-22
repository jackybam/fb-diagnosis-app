// 네이버 검색어 트렌드 (NAVER API HUB) 연동
// 문서: https://api.ncloud-docs.com/docs/naver-api-hub-search-trend
//
// v3 — 관심도를 "완전히 다른 질문에 답하는 두 숫자"로 분리:
//
// 1) itemLevel (아래 "관심도 지수", 0~100): 이 아이템 자체가 최근 12개월 자기 흐름 안에서
//    지금 어디쯤인지. 카테고리 비교를 아예 안 함 — 그래서 "대분류로 비교하면 너무 낮고,
//    중분류로 비교하면 그 중분류 자체가 작아서 오히려 높아 보이는" 병목현상이 원천적으로 없음.
//    (예: "마라국밥"을 대분류(한식) 대비로 보면 항상 작게, 중분류(국물요리) 대비로 보면
//    중분류 자체 검색량이 작아서 부풀어 보이는 문제 — 이건 카테고리 비교를 안 하면 아예 안 생김)
//    Naver가 주는 지수 자체가 "요청 구간 내 최고치=100"인 상대값이라, 구간을 12개월로 넉넉하게
//    잡으면 그 자체가 "최근 1년 내 지금이 어느 위치인지"가 됨 — 별도 계산 필요 없이 그대로 씀.
//
// 2) shareChangePp (위쪽 훅 "+X%p"): 카테고리(기준 키워드) 검색량 대비 이 아이템의 비중이
//    3개월 전 대비 얼마나 움직였는지. "방향성"(뜨고 있나 식고 있나)만 보는 용도라 카테고리
//    선택에 따라 절대 수치는 달라져도 "오르는 중/내리는 중"이라는 신호 자체는 유효함.
//    두 시점 다 같은 기준 대비 비중(%)이라 division-by-small-number로 숫자가 폭주하는 문제 없음.
//
// itemLevel은 카테고리 비교가 필요 없어서, 기준 키워드를 못 찾는 경우(comparedToRef:false)에도
// 항상 계산 가능함 — 그래서 위쪽 훅은 "추정"으로 빠져도 아래 관심도 지수는 실데이터로 보여줄 수 있음.
const ESCALATE_THRESHOLD_PCT = 40;
const WINDOW_MONTHS = 12; // itemLevel의 기준 구간(자기 자신 12개월 내 위치)
const SHARE_LOOKBACK_MONTHS = 3; // 위쪽 훅("3개월 전 대비")의 비교 구간

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

    const today = new Date();
    const endDate = today.toISOString().slice(0, 10);
    const startDateObj = new Date(today);
    startDateObj.setMonth(startDateObj.getMonth() - WINDOW_MONTHS);
    const startDate = startDateObj.toISOString().slice(0, 10);

    const keywordGroups = [{ groupName: keyword, keywords: [keyword] }];
    const groupOrder = ["item"];
    if (ref && ref !== keyword) {
      keywordGroups.push({ groupName: ref, keywords: [ref] });
      groupOrder.push("narrow");
    }
    if (broadRef && broadRef !== ref && broadRef !== keyword) {
      keywordGroups.push({ groupName: broadRef, keywords: [broadRef] });
      groupOrder.push("broad");
    }

    const body = { startDate, endDate, timeUnit: "month", keywordGroups };

    const r = await fetch("https://naverapihub.apigw.ntruss.com/search-trend/v1/search", {
      method: "POST",
      headers: {
        "X-NCP-APIGW-API-KEY-ID": clientId,
        "X-NCP-APIGW-API-KEY": clientSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(502).json({ error: "네이버 API 호출 실패", detail: data });
    }

    const seriesByRole = {};
    groupOrder.forEach((role, i) => {
      seriesByRole[role] = data?.results?.[i]?.data || [];
    });
    const itemSeries = seriesByRole.item || [];

    if (itemSeries.length === 0) {
      return res.status(200).json({ keyword, hasItemLevel: false, comparedToRef: false, series: itemSeries });
    }

    // 1) itemLevel — 그냥 이 12개월 구간에서의 마지막(현재) 값. Naver가 이미 "구간 내 최고치=100"으로
    // 정규화해서 주기 때문에, 구간을 12개월로 잡은 시점에서 추가 계산이 필요 없음.
    const itemLevel = Math.round((itemSeries[itemSeries.length - 1]?.ratio ?? 0) * 10) / 10;

    // 2) shareChangePp — "3개월 전 대비 카테고리 비중 변화". 12개월 시계열 중 마지막 지점과,
    // 그로부터 SHARE_LOOKBACK_MONTHS개월 전 지점, 두 시점만 비교.
    const lastIdx = itemSeries.length - 1;
    const pastIdx = Math.max(0, lastIdx - SHARE_LOOKBACK_MONTHS);

    function shareAt(refSeries, idx) {
      const refRatio = refSeries?.[idx]?.ratio ?? 0;
      const itemRatio = itemSeries[idx]?.ratio ?? 0;
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

    // 좁은 기준 대비 "지금" 비중이 낮으면(=기준이 충분히 크다는 뜻) 좁은 기준 채택,
    // 너무 높으면(=기준 자체가 약함) 넓은 기준으로 전환.
    let chosen = null;
    let usedRef = null;
    let usedLevel = null;
    if (narrowFL && narrowFL.last <= ESCALATE_THRESHOLD_PCT) {
      chosen = narrowFL;
      usedRef = ref;
      usedLevel = "narrow";
    } else if (broadFL) {
      chosen = broadFL;
      usedRef = broadRef;
      usedLevel = "broad";
    } else if (narrowFL) {
      chosen = narrowFL;
      usedRef = ref;
      usedLevel = "narrow";
    }

    return res.status(200).json({
      keyword,
      hasItemLevel: true,
      itemLevel, // "관심도 지수" — 카테고리 비교 없는, 이 아이템 자체의 12개월 내 상대 위치(0~100)
      ref: chosen ? usedRef : null,
      refLevel: chosen ? usedLevel : null,
      comparedToRef: !!chosen,
      shareChangePp: chosen ? Math.round((chosen.last - chosen.past) * 10) / 10 : null, // 훅 "+X%p"
      series: itemSeries,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
