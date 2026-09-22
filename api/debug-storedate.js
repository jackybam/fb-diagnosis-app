// 임시 디버그 엔드포인트 — "경쟁 강도"를 진짜 폐업률/생존율 기반으로 바꾸기 전에,
// SBIZ 상권정보 API의 /storeListByDate(수정일자기준 상가업소 조회, 삭제 포함)가
// 실제로 언제 어떤 데이터를 주는지 확인하는 용도. 확인 끝나면 이 파일은 지울 것.
//
// v2: 응답 구조를 미리 짐작해서 필드를 콕 집어 꺼내지 않고, 파싱 성공/실패와 원본을
// 그대로 다 보여주도록 바꿈 (지난 버전은 구조를 잘못 짐작해서 전부 비어있는 것처럼 보였음).
//
// 사용법(배포 후 브라우저 주소창에 그대로 입력):
//   기본(날짜 안 주면) → 후보 날짜 여러 개를 훑어서 어느 날짜에 실제 변경분이 있는지 스캔
//     /api/debug-storedate
//   특정 날짜 상세 확인(원본 응답 그대로):
//     /api/debug-storedate?date=20260630
//   특정 업종(소분류코드)으로 좁혀서:
//     /api/debug-storedate?date=20260630&indsSclsCd=I21101
const BASE = "https://apis.data.go.kr/B553077/api/open/sdsc2";

function candidateDates() {
  const dates = new Set();
  const now = new Date();
  for (let q = 0; q < 8; q++) {
    const m = now.getMonth() - q * 3;
    const d = new Date(now.getFullYear(), m + 1, 0);
    dates.add(d.toISOString().slice(0, 10).replace(/-/g, ""));
  }
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
  let r;
  try {
    r = await fetch(url);
  } catch (e) {
    return { date, fetchError: String(e.message || e), url };
  }
  const text = await r.text();
  try {
    const json = JSON.parse(text);
    return { date, httpStatus: r.status, parsed: true, json };
  } catch {
    // JSON이 아니면(XML 에러 응답 등) 원문 앞부분을 그대로 보여줌
    return { date, httpStatus: r.status, parsed: false, rawSnippet: text.slice(0, 500) };
  }
}

// 어디에 items/totalCount/resultCode가 들어있는지 몰라도 재귀적으로 훑어서 찾아줌
function findFirst(obj, keys, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 5) return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined) return obj[k];
  }
  for (const v of Object.values(obj)) {
    const found = findFirst(v, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

export default async function handler(req, res) {
  try {
    const { date = "", indsSclsCd = "" } = req.query;
    const serviceKey = process.env.SBIZ_API_KEY;
    if (!serviceKey) {
      return res.status(500).json({ error: "SBIZ_API_KEY 없음" });
    }

    if (date) {
      const result = await callOnce(serviceKey, date, indsSclsCd, 1000);
      if (!result.parsed) {
        // 파싱 실패든 fetch 실패든 원인을 그대로 노출 (여기서 진짜 원인이 보일 거임)
        return res.status(200).json(result);
      }
      const items = findFirst(result.json, ["items"]) ?? [];
      const arr = Array.isArray(items) ? items : items ? [items] : [];
      const chgGbCounts = {};
      for (const it of arr) {
        const g = it?.chgGb ?? "(없음)";
        chgGbCounts[g] = (chgGbCounts[g] || 0) + 1;
      }
      return res.status(200).json({
        date,
        indsSclsCd: indsSclsCd || null,
        httpStatus: result.httpStatus,
        resultCode: findFirst(result.json, ["resultCode"]),
        resultMsg: findFirst(result.json, ["resultMsg"]),
        totalCount: findFirst(result.json, ["totalCount"]),
        returnedCount: arr.length,
        chgGbCounts,
        sample: arr.slice(0, 3),
        rawTopLevelKeys: Object.keys(result.json), // 실제 응답이 어떤 모양인지 바로 보이게
      });
    }

    const dates = candidateDates();
    const scans = await Promise.all(
      dates.map(async (d) => {
        const result = await callOnce(serviceKey, d, indsSclsCd, 1);
        if (!result.parsed) {
          return { date: d, ok: false, httpStatus: result.httpStatus, fetchError: result.fetchError, rawSnippet: result.rawSnippet };
        }
        return {
          date: d,
          ok: true,
          resultCode: findFirst(result.json, ["resultCode"]),
          totalCount: findFirst(result.json, ["totalCount"]),
        };
      })
    );
    return res.status(200).json({ scanned: scans.length, results: scans });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
