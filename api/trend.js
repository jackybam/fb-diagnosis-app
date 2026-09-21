// 네이버 검색어 트렌드 (NAVER API HUB) 연동
// 문서: https://api.ncloud-docs.com/docs/naver-api-hub-search-trend
// 참고: 이 API는 절대 검색량이 아니라 "요청 범위 내 최고치를 100으로 둔 상대값"만 준다.
// 그래서 검색어 하나만 조회하면, 원래 검색량이 적은 틈새 키워드도 자기 자신의 최근 고점 근처면
// 100에 가깝게 나와서 "엄청 인기있다"는 착시를 만든다.
// 이를 막기 위해 "기준 키워드"(보통 상위 대분류, 예: 중식)를 같이 묶어서 조회한다.
// 이러면 100이라는 기준점이 "묶은 것 중 제일 검색량 많은 것"이 되어서, 정말 틈새면 정직하게 낮게 나온다.

export default async function handler(req, res) {
  try {
    const { keyword = "", ref = "" } = req.query;
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

    const keywordGroups = [{ groupName: keyword, keywords: [keyword] }];
    if (ref && ref !== keyword) {
      keywordGroups.push({ groupName: ref, keywords: [ref] });
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

    // results[0] = 아이템 자신, results[1] = 기준 키워드(있는 경우)
    const itemSeries = data?.results?.[0]?.data || [];
    const refSeriesRaw = data?.results?.[1]?.data || null;

    if (itemSeries.length === 0) {
      return res.status(200).json({ keyword, changePct: null, raw: data });
    }

    const first = itemSeries[0]?.ratio ?? 0;
    const last = itemSeries[itemSeries.length - 1]?.ratio ?? 0;
    const changePct = first > 0 ? Math.round(((last - first) / first) * 100) : null;

    // "OO 검색량 대비 몇 %"를 정확히 계산: 같은 달(최근 달) 기준으로 아이템/기준키워드 값을 직접 나눔.
    // (이전 버전은 "구간 내 최고점 대비"였는데, 그 최고점이 항상 ref의 최근 값이라는 보장이 없어서
    //  라벨("OO 대비")이랑 실제 계산이 안 맞을 수 있었음 — 이제 같은 달끼리 직접 비교하도록 수정)
    let shareOfRefPct = null;
    if (refSeriesRaw && refSeriesRaw.length > 0) {
      const refLast = refSeriesRaw[refSeriesRaw.length - 1]?.ratio ?? 0;
      if (refLast > 0) {
        shareOfRefPct = Math.round((last / refLast) * 1000) / 10; // 소수점 한 자리
      }
    }

    return res.status(200).json({
      keyword,
      ref: ref || null,
      comparedToRef: shareOfRefPct !== null,
      changePct, // 트렌드(변화율) — 상승/하락 방향
      // ref가 있으면 "이번 달 ref 검색량 대비 정확히 몇 %"(shareOfRefPct), 없으면 예전 방식(자기 구간 내 상대값)
      latestRatio: shareOfRefPct !== null ? shareOfRefPct : Math.round(last * 10) / 10,
      series: itemSeries,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
