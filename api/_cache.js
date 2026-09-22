// 공유 캐시 레이어 (Upstash Redis, REST API 방식 — 별도 npm 패키지 설치 없이 fetch만으로 사용).
//
// 왜 필요한가: 지금까지 한 진단 요청 "안에서" 나가는 API 호출들(동시 개수 제한, 재시도)은
// 손봤지만, 그건 한 사람의 요청 안에서만 통제되는 거라 동시 접속자가 늘면(예: 50명이 동시에
// 각자 다른 지역을 진단) 정부 API/네이버 쪽에는 여전히 요청이 몇 배로 몰림. 게다가 Vercel
// 서버리스 함수는 동시 요청이 오면 인스턴스를 여러 개 띄워서 처리하는데, 그 인스턴스들끼리는
// 메모리를 공유하지 않아서(_lib.js의 30분 캐시도 "같은 인스턴스가 재사용되는 동안만" 효과가
// 있음) 인스턴스별로 따로따로 API를 또 부르게 됨.
//
// 그래서 인스턴스 여러 개가 다 같이 읽고 쓸 수 있는 "공유" 저장소(Redis)에 결과를 잠깐
// 저장해두고, 같은 조합(같은 동네+업종, 같은 검색어)을 다른 사람이 다시 물어보면 실제 API를
// 다시 부르지 않고 캐시된 값을 바로 돌려준다. 매장 수 데이터는 분기 단위, 검색 트렌드는
// 월 단위로만 실제로 바뀌는 데이터라 몇 시간~하루 정도 캐싱해도 정확도 손해가 거의 없음.
//
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 환경변수가 아직 없으면(Upstash 연결 전)
// 캐시 없이 조용히 넘어간다 — 캐시는 있으면 좋고 없어도 앱이 그대로 동작해야 하는 "최적화"이지,
// 필수 요소가 아니라서 여기서 나는 에러가 진단 기능 자체를 막으면 안 됨.
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

function enabled() {
  return !!(UPSTASH_URL && UPSTASH_TOKEN);
}

async function command(cmd) {
  const res = await fetch(UPSTASH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error(`Upstash 호출 실패: ${res.status}`);
  const data = await res.json();
  return data.result;
}

// 캐시에서 읽는다. 캐시가 없거나(아직 아무도 안 물어봤거나 만료됨) Upstash가 연결 안 돼있거나
// 네트워크 오류가 나면 그냥 null — 호출하는 쪽에서 null이면 "캐시 없으니 실제 API 불러라"로
// 처리하면 됨.
export async function cacheGet(key) {
  if (!enabled()) return null;
  try {
    const raw = await command(["GET", key]);
    if (raw == null) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// value를 JSON으로 저장하고 ttlSeconds 후 자동 만료. 저장 실패해도 조용히 무시
// (캐시 저장이 안 됐어도 이번 요청 결과 자체는 이미 정상적으로 응답 나갔으니 문제 없음 —
// 다음 요청이 캐시 미스로 처리되고 다시 저장을 시도할 뿐).
export async function cacheSet(key, value, ttlSeconds) {
  if (!enabled()) return;
  try {
    await command(["SET", key, JSON.stringify(value), "EX", String(ttlSeconds)]);
  } catch (e) {
    // 무시
  }
}
