// 임시 디버그 엔드포인트 — SBIZ storeListInDong이 상호명(bizesNm) 필드를 실제로 주는지,
// 그리고 대분류(indsLclsCd)로 좁혔을 때 한 동네 결과 개수가 어느 정도인지 확인하는 용도.
// "인근 동일 브랜드 매장 수"를 서버 쪽 이름검색 없이, 목록을 받아서 우리 코드에서
// bizesNm에 브랜드명이 포함되는지 걸러내는 방식으로 만들 수 있는지 확인하기 위함.
// 확인 끝나면 지울 것.
const BASE = "https://apis.data.go.kr/B553077/api/open/sdsc2";

export default async function handler(req, res) {
  try {
    const { adongCd = "", indsLclsCd = "", numOfRows = "50" } = req.query;
    const serviceKey = process.env.SBIZ_API_KEY;
    if (!serviceKey) return res.status(500).json({ error: "SBIZ_API_KEY 없음" });
    if (!adongCd) return res.status(400).json({ error: "adongCd가 필요합니다." });

    const params = new URLSearchParams({
      serviceKey,
      pageNo: "1",
      numOfRows,
      divId: "adongCd",
      key: adongCd,
      type: "json",
    });
    if (indsLclsCd) params.set("indsLclsCd", indsLclsCd);

    const url = `${BASE}/storeListInDong?${params.toString()}`;
    const r = await fetch(url);
    const text = await r.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return res.status(200).json({ parsed: false, httpStatus: r.status, rawSnippet: text.slice(0, 500) });
    }

    const items = json?.body?.items ?? [];
    const arr = Array.isArray(items) ? items : items ? [items] : [];

    return res.status(200).json({
      totalCount: json?.body?.totalCount,
      returnedCount: arr.length,
      sampleFieldKeys: arr[0] ? Object.keys(arr[0]) : [],
      sample: arr.slice(0, 5),
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
