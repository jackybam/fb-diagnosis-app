// 임시 디버그 엔드포인트 — "경쟁 강도"를 진짜 폐업률/생존율 기반으로 바꾸기 전에,
// SBIZ 상권정보 API의 /storeListByDate(수정일자기준 상가업소 조회, 삭제 포함)가
// 실제로 언제 어떤 데이터를 주는지 확인하는 용도. 확인 끝나면 이 파일은 지울 것.
//
// 사용법(배포 후 브라우저 주소창에 그대로 입력):
//   기본(날짜 안 주면) → 후보 날짜 여러 개를 훑어서 어느 날짜에 실제 변경분이 있는지 스캔
//     /api/debug-storedate
//   특정 날짜 상세 확인:
//     /api/debug-storedate?date=20260630
//   특정 업종(소분류코드)으로 좁혀서:
//     /api/debug-storedate?date=20260630&indsSclsCd=I21101
const BASE = "https://apis.data.go.kr/B553077/api/open/sdsc2";

// 실제 데이터 갱신 주기를 몰라서, 일단 최근 2년치 "분기 마지막 날" + "매달 1일"을
// 후보로 훑어봄. 어느 날짜에 데이터가 있는지 알면 그걸로 좁혀서 다시 확인하면 됨.
function candidateDates() {
  const dates = new Set();
  const now = new Date();
  // 최근 8개 분기말
  for (let q = 0; q < 8; q++) {
    const m = now.getMonth() - q * 3;
    const d = new Date(now.getFullYear(), m + 1, 0); // 그 달 마지막 날
    dates.add(d.toISOString().slice(0, 10).replace(/-/g, ""));
  }
  // 최근 12개월 1일
  for (let m = 0; m < 12; m++) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    dates.add(d.toISOString().slice(0, 10).replace(/-/g, ""));
  }
  return Array.from(dates).sort().reverse();
}

async function callOnce(serviceKey, date, indsSclsCd, numOfRows) {
  const params = new URLSearchParams({
    serviceKey,
    key: date,
    pageNo: "1",
    numOfRows: String(numOfRows),
    type: "json",
  });
  if (indsSclsCd) params.set("indsSclsCd", indsSclsCd);
  const url = `${BASE}/storeListByDate?${params.toString()}`;
  const r = await fetch(url);
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { date, httpStatus: r.status, parseError: true, rawSnippet: text.slice(0, 300) };
  }
  return { date, httpStatus: r.status, body: data };
}

export default async function handler(req, res) {
  try {
    const { date = "", indsSclsCd = "" } = req.query;
    const serviceKey = process.env.SBIZ_API_KEY;
    if (!serviceKey) {
      return res.status(500).json({ error: "SBIZ_API_KEY 없음" });
    }

    if (date) {
      // 특정 날짜 상세 조회 (최대 1000건까지, chgGb 분포도 같이 집계)
      const result = await callOnce(serviceKey, date, indsSclsCd, 1000);
      const items = result.body?.body?.items ?? result.body?.items ?? [];
      const arr = Array.isArray(items) ? items : items ? [items] : [];
      const chgGbCounts = {};
      for (const it of arr) {
        const g = it.chgGb ?? "(없음)";
        chgGbCounts[g] = (chgGbCounts[g] || 0) + 1;
      }
      return res.status(200).json({
        date,
        indsSclsCd: indsSclsCd || null,
        resultCode: result.body?.body?.resultCode ?? result.body?.resultCode,
        resultMsg: result.body?.body?.resultMsg ?? result.body?.resultMsg,
        totalCount: result.body?.body?.totalCount ?? result.body?.totalCount,
        returnedCount: arr.length,
        chgGbCounts, // C=생성 U=수정 D=삭제(폐업) 추정 — 여기서 실제 값 확인
        sample: arr.slice(0, 5),
      });
    }

    // 날짜 안 주면: 후보 날짜들을 가볍게(1건만) 훑어서 totalCount만 비교
    const dates = candidateDates();
    const scans = [];
    for (const d of dates) {
      const result = await callOnce(serviceKey, d, indsSclsCd, 1);
      scans.push({
        date: d,
        resultCode: result.body?.body?.resultCode ?? result.body?.resultCode,
        totalCount: result.body?.body?.totalCount ?? result.body?.totalCount ?? null,
      });
    }
    return res.status(200).json({ scanned: scans.length, results: scans });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
