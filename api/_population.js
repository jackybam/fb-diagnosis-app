// 행정안전부 "지역별(행정동) 성별 연령별 주민등록 인구수" 파일데이터에서
// 행정기관코드/시도명/시군구명/읍면동명/총인구만 뽑아 경량화한 정적 데이터(api/data/dong-population.json)를 읽어
// SBIZ 상권정보 API의 지역명(ctprvnNm/signguNm/동이름)과 이름 기준으로 매칭한다.
//
// 왜 코드(admmCd) 매칭이 아니라 이름 매칭인가:
// - 행정안전부 인구 API가 쓰는 행정동코드(10자리, admmCd)는 SBIZ 상권정보 API가 쓰는 adongCd(8자리)와
//   체계가 다르고, 공식 변환 테이블이 API로 제공되지 않는다.
// - 반면 이 프로젝트는 이미 _lib.js의 matchDong/suggestDong에서 지역을 "이름"으로 매칭하고 있으므로
//   (숫자 뗀 동이름으로 묶어서 보여주는 방식과 동일하게), 인구 데이터도 같은 방식으로 이름 매칭하면
//   코드 변환 문제 자체를 건너뛸 수 있다.
// - 원본 데이터: https://www.data.go.kr/data/15097972/fileData.do (행정안전부, 월 1회 갱신, 로그인 불필요)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _cache = null;
function loadData() {
  if (_cache) return _cache;
  const raw = fs.readFileSync(path.join(__dirname, "data", "dong-population.json"), "utf-8");
  _cache = JSON.parse(raw);
  return _cache;
}

function norm(s) {
  return (s || "").replace(/\s+/g, "");
}
function stripNum(s) {
  // 서울 일부 자치구는 행정동 이름을 "창신제1동"처럼 "제"를 붙여서 표기함(전체 3,619개 동 중 345개).
  // SBIZ 쪽은 "창신1동"처럼 "제" 없이 표기해서, 숫자만 떼면 "창신제동" vs "창신동"으로 안 맞았음.
  // "제" 뒤에 숫자가 바로 오는 경우만 그 "제"를 지운다 (동 이름 자체에 "제"가 들어가는 "제기동" 같은
  // 경우는 뒤에 숫자가 안 오니까 그대로 남음).
  return norm(s).replace(/제(?=[0-9])/g, "").replace(/[0-9]/g, "");
}
// SBIZ 쪽 ctprvnNm 표기가 실제로 "경기"/"경기도", "서울"/"서울특별시" 중 뭐로 오는지
// 아직 실제 응답으로 확인 전이라(_lib.js 주석 참고), 시도명 접미사 차이는 흡수하고 비교한다.
function normProvince(s) {
  return norm(s).replace(/(특별자치도|특별자치시|광역시|특별시|도)$/, "");
}

// ctprvnNm(시도명) + signguNm(시군구명) + dongLabel(숫자 뗀 읍면동명, 예: "죽전동")을 받아
// 해당하는 행(들)의 총인구를 합산해서 돌려준다.
// "죽전1동/2동/3동"처럼 쪼개진 동은 dongLabel이 전부 "죽전동"으로 들어오므로 자동으로 다 합산됨.
// 매칭되는 행이 하나도 없으면 null (프론트에서는 이 경우 "추정" 모드로 대체 표시).
export function getPopulationForRegion(ctprvnNm, signguNm, dongLabel) {
  const dongKey = stripNum(dongLabel);
  if (!dongKey) return null;

  const data = loadData();
  const cityKey = normProvince(ctprvnNm) + norm(signguNm || "");

  const matched = data.filter((row) => {
    const rowDong = stripNum(row.d);
    if (rowDong !== dongKey) return false;
    if (!cityKey) return true;
    const rowCity = normProvince(row.s) + norm(row.g);
    return rowCity.includes(cityKey) || cityKey.includes(rowCity);
  });

  if (matched.length === 0) return null;
  const population = matched.reduce((sum, r) => sum + r.p, 0);
  return { population, matchedDongs: matched.map((r) => r.d) };
}
