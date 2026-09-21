// 공통 유틸: 소상공인시장진흥공단 상권정보 API 호출 헬퍼
// 문서: https://data.go.kr/data/15012005/openapi.do

const BASE = "https://apis.data.go.kr/B553077/api/open/sdsc2";

function norm(s) {
  return (s || "").replace(/\s+/g, "");
}

// 서버리스 함수가 "웜" 상태로 재사용되는 동안(같은 인스턴스가 연속 요청을 처리하는 동안)
// 메모리에 캐시해서 같은 데이터를 반복해서 API에 재요청하지 않게 한다.
// 인스턴스가 새로 뜨면(콜드 스타트) 캐시는 비워지지만, 그래도 반복 요청 상황에선 크게 빨라짐.
// 데이터가 분기(quarter) 단위로만 갱신되는 자료라 30분 캐시로도 충분히 안전함.
const CACHE_TTL_MS = 30 * 60 * 1000;
let _dongListCache = { data: null, ts: 0 };
const _upjongCache = {}; // level별 캐시

async function cachedFetch(cacheObj, url) {
  const now = Date.now();
  if (cacheObj.data && now - cacheObj.ts < CACHE_TTL_MS) {
    return cacheObj.data;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API 호출 실패: ${res.status}`);
  const data = await res.json();
  cacheObj.data = data;
  cacheObj.ts = now;
  return data;
}

// 행정동 전체 목록 (시도/시군구/행정동 코드+명칭)을 가져온다.
// 이 API는 pageNo/numOfRows 파라미터가 없고 전국 목록을 한 번에 반환한다.
export async function fetchDongList(serviceKey) {
  const url = `${BASE}/baroApi?serviceKey=${serviceKey}&resId=dong&catId=admi&type=json`;
  const data = await cachedFetch(_dongListCache, url);

  // 실제 응답 구조 확인 결과: response.body.items 가 바로 배열임 (item으로 한 번 더
  // 감싸져 있지 않음). 혹시 결과가 1건일 때 객체로 오는 경우까지 대비해 배열로 통일.
  const items = data?.body?.items ?? [];
  return Array.isArray(items) ? items : [items];
}

// 시군구+동 텍스트를 받아 가장 그럴듯한 행정동 코드(adongCd)를 찾는다.
// 정확한 지오코딩이 아니라 텍스트 포함 매칭이라 완벽하지 않을 수 있음 (동명 지역 등).
// "동백동" 입력 시 실제 행정동명이 "동백1동/동백2동/동백3동"으로 쪼개진 경우가 많아
// 숫자를 제거하고 비교한다.
function stripNum(s) {
  return norm(s).replace(/[0-9]/g, "");
}

export function matchDong(list, cityText, dongText) {
  const city = norm(cityText);
  const dongClean = stripNum(dongText);

  const candidates = list.filter((it) => {
    const full = norm((it.ctprvnNm || "") + (it.signguNm || ""));
    const dongNmClean = stripNum(it.adongNm || "");
    const cityOk = !city || full.includes(city) || city.includes(norm(it.signguNm || ""));
    const dongOk = !dongClean || dongNmClean.includes(dongClean) || dongClean.includes(dongNmClean);
    return cityOk && dongOk;
  });

  return candidates; // 여러 개면 동명 지역 또는 동백1/2/3동처럼 쪼개진 경우 — 호출부에서 처리
}

// 자동완성용: 사용자가 타이핑하는 중간에 부분 일치하는 행정동 후보를 찾는다.
// "용인시 기흥구 동백" 처럼 입력해도 도중에 매칭되도록 전체 결합 문자열에서 검색.
// "동백1동/2동/3동"처럼 숫자로 쪼개진 동은 "동백동" 하나로 묶어서 보여주고,
// 실제 코드는 여러 개(adongCds 배열)로 들고 있다가 나중에 다 더해서 계산한다.
export function suggestDong(list, query, limit = 8) {
  const q = stripNum(query);
  if (!q) return [];

  const groups = new Map(); // key: 시도+시군구+숫자뺀동이름 -> { label, ctprvnCd, signguCd, adongCds: [] }

  for (const it of list) {
    const dongClean = stripNum(it.adongNm || "");
    const combined = stripNum(`${it.ctprvnNm || ""}${it.signguNm || ""}${it.adongNm || ""}`);
    if (!combined.includes(q)) continue;

    const key = `${it.ctprvnNm}|${it.signguNm}|${dongClean}`;
    if (!groups.has(key)) {
      // 숫자를 뺀 이름으로 표시 (동백1동 -> 동백동)
      const displayDong = (it.adongNm || "").replace(/[0-9]/g, "") || it.adongNm;
      groups.set(key, {
        label: `${it.ctprvnNm} ${it.signguNm} ${displayDong}`,
        ctprvnCd: it.ctprvnCd,
        signguCd: it.signguCd,
        adongCds: [],
      });
      if (groups.size > limit) break; // 그룹 개수 기준으로 제한
    }
    groups.get(key).adongCds.push(it.adongCd);
  }

  return Array.from(groups.values()).slice(0, limit);
}

// 업종 대/중/소분류 코드 목록 조회 후, 한글 업종명으로 코드를 찾는다.
export async function findUpjongCode(serviceKey, level, keyword) {
  const endpoint =
    level === "large" ? "largeUpjongList" : level === "middle" ? "middleUpjongList" : "smallUpjongList";
  const url = `${BASE}/${endpoint}?serviceKey=${serviceKey}&type=json`;
  if (!_upjongCache[level]) _upjongCache[level] = { data: null, ts: 0 };
  const data = await cachedFetch(_upjongCache[level], url);
  const items = data?.body?.items ?? [];
  const arr = Array.isArray(items) ? items : [items];
  // 필드명(예: indsLclsCd/indsLclsNm 등)은 배포 후 실제 응답으로 1회 확인 필요
  return arr.filter((it) => Object.values(it).some((v) => String(v).includes(keyword)));
}

// 특정 행정동+업종 조건의 상가업소 개수를 구한다 (업종 밀집도용 실데이터).
export async function countStoresInDong(serviceKey, adongCd, upjongParam) {
  const params = new URLSearchParams({
    serviceKey,
    pageNo: "1",
    numOfRows: "1", // 목록 자체는 필요 없고 totalCount만 필요
    divId: "adongCd",
    key: adongCd,
    type: "json",
    ...upjongParam, // { indsMclsCd: 'xxxx' } 등
  });
  const url = `${BASE}/storeListInDong?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`storeListInDong 호출 실패: ${res.status}`);
  const data = await res.json();
  // totalCount 위치도 배포 후 실제 응답으로 확인 필요 (body.totalCount 가정)
  return Number(data?.body?.totalCount ?? 0);
}
