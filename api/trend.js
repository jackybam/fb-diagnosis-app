// 네이버 검색어 트렌드 (NAVER API HUB) 연동
// 문서: https://api.ncloud-docs.com/docs/naver-api-hub-search-trend
// 참고: 이 API는 절대 검색량이 아니라 "요청 범위 내 최고치를 100으로 둔 상대값"만 준다.
// 그래서 검색어 하나만 조회하면, 원래 검색량이 적은 틈새 키워드도 자기 자신의 최근 고점 근처면
// 100에 가깝게 나와서 "엄청 인기있다"는 착시를 만든다.
//
// 기준 키워드도 잘못 고르면 문제가 생긴다: "분식"처럼 카테고리명 자체는 사람들이 잘 안 쳐서
// 기준 자체가 약하면, 오히려 틈새 아이템이 그 기준 대비 비정상적으로 높게(예: 89%) 나와버림.
// 그래서 "좁은 기준"(세부업종에 가까운 단어, 예: 김밥)과 "넓은 기준"(대분류, 예: 분식)을
// 한 번에 같이 조회해서, 좁은 기준 대비 비율이 비정상적으로 높으면(=좁은 기준 자체가 약하다는 신호)
// 자동으로 넓은 기준 쪽 결과로 바꿔치기한다.
const ESCALATE_THRESHOLD_PCT = 40; // 이 비율 넘으면 "기준이 약하다"고 보고 넓은 기준으로 전환

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
    startDateObj.setMonth(startDateObj.getMonth() - 3); // 최근 3개월
    const startDate = startDateObj.toISOString().slice(0, 10);

    // 아이템(0) + 좁은 기준(1, 있으면) + 넓은 기준(2, 있고 좁은 기준과 다르면)을 한 번에 조회
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
      return res.status(200).json({ keyword, changePct: null, raw: data });
    }

    const first = itemSeries[0]?.ratio ?? 0;
    const last = itemSeries[itemSeries.length - 1]?.ratio ?? 0;
    const changePct = first > 0 ? Math.round(((last - first) / first) * 100) : null;

    function sharePct(refSeries) {
      if (!refSeries || refSeries.length === 0) return null;
      const refLast = refSeries[refSeries.length - 1]?.ratio ?? 0;
      if (refLast <= 0) return null;
      return Math.round((last / refLast) * 1000) / 10;
    }

    const narrowPct = sharePct(seriesByRole.narrow);
    const broadPct = sharePct(seriesByRole.broad);

    // 좁은 기준 대비가 비정상적으로 높으면(=좁은 기준 자체가 약한 검색어라는 신호) 넓은 기준으로 전환
    let finalPct, usedRef, usedLevel;
    if (narrowPct !== null && narrowPct <= ESCALATE_THRESHOLD_PCT) {
      finalPct = narrowPct;
      usedRef = ref;
      usedLevel = "narrow";
    } else if (broadPct !== null) {
      finalPct = broadPct;
      usedRef = broadRef;
      usedLevel = "broad";
    } else if (narrowPct !== null) {
      // 넓은 기준이 없어서 좁은 기준이 이상해도 그거라도 씀
      finalPct = narrowPct;
      usedRef = ref;
      usedLevel = "narrow";
    } else {
      finalPct = null;
      usedRef = null;
      usedLevel = null;
    }

    return res.status(200).json({
      keyword,
      ref: usedRef,
      refLevel: usedLevel, // "narrow" | "broad" | null — 프론트에서 태그 문구에 씀
      comparedToRef: finalPct !== null,
      changePct, // 트렌드(변화율) — 상승/하락 방향
      latestRatio: finalPct !== null ? finalPct : Math.round(last * 10) / 10,
      series: itemSeries,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
