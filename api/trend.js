// 네이버 검색어 트렌드 (NAVER API HUB) 연동
// 문서: https://api.ncloud-docs.com/docs/naver-api-hub-search-trend
// 참고: 이 API는 절대 검색량이 아니라 "구간 내 최고치를 100으로 둔 상대값"만 준다.

export default async function handler(req, res) {
  try {
    const { keyword = "" } = req.query;
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

    const body = {
      startDate,
      endDate,
      timeUnit: "month",
      keywordGroups: [{ groupName: keyword, keywords: [keyword] }],
    };

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

    // 응답 구조가 정확히 확인 안 된 상태라 방어적으로 여러 경로 시도.
    // (기존 데이터랩 포맷 기준: results[0].data = [{period, ratio}, ...])
    const series = data?.results?.[0]?.data || [];
    if (series.length === 0) {
      return res.status(200).json({ keyword, changePct: null, raw: data });
    }

    const first = series[0]?.ratio ?? 0;
    const last = series[series.length - 1]?.ratio ?? 0;
    const changePct = first > 0 ? Math.round(((last - first) / first) * 100) : null;

    return res.status(200).json({
      keyword,
      changePct, // null이면 계산 불가 (프론트에서 추정치 유지)
      series,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
