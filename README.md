[README.md](https://github.com/user-attachments/files/32502815/README.md)
상권 진단서 (F&B 창업 진단 프로토타입)
지금 상태
지역 입력이 자동완성 방식입니다 (동백1동/2동/3동처럼 갈라진 지역도 정확히 매칭).
업종이 대분류 → 세부업종 2단계 구조입니다. 새 세부업종은 `index.html`의 `BIZ_TAXONOMY` 객체에만 추가하면 됨 (서버 수정 불필요).
"업종 포화도"는 실데이터입니다. 세부업종이 실제 업종분류에 없으면 대분류로 넓혀서 검색하고, 그 경우 "실데이터(대분류 기준)"으로 표시됩니다.
"관심도 지수"는 네이버 검색어 트렌드 API 연동 코드까지 만들어뒀지만, 아직 키가 없어서 추정치로 동작 중입니다. 아래 환경변수 추가하면 실데이터로 전환됩니다.
"진입 난이도"는 여전히 추정치입니다.
환경변수
Key	용도
`SBIZ_API_KEY`	소상공인시장진흥공단 상권정보 API (data.go.kr에서 발급)
`NAVER_CLIENT_ID`	네이버 API Hub 검색어 트렌드용 Client ID
`NAVER_CLIENT_SECRET`	네이버 API Hub 검색어 트렌드용 Client Secret
네이버 API Hub는 개발자센터(developers.naver.com)가 아니라 네이버클라우드플랫폼(NCP) 콘솔에서 신청합니다:
https://www.ncloud.com 가입 (휴대폰 인증 필요)
콘솔 → Menu → All Services → Application Services → NAVER API HUB
"검색어 트렌드" API 이용 신청 → Application 등록
인증 정보에서 Client ID / Client Secret 확인 → Vercel 환경변수에 등록
배포 방법 (Vercel)
이 폴더를 깃허브 저장소로 올립니다. (Vercel이 깃허브와 연동해서 자동 배포)
https://vercel.com 에서 깃허브 계정으로 가입 → "Add New Project" → 방금 만든 저장소 선택
위 환경변수 3개 등록
Deploy 버튼 누르면 끝 — `https://프로젝트명.vercel.app` 링크가 생깁니다.
배포 후 확인이 필요할 수 있는 것
`api/trend.js`는 네이버 검색어 트렌드 API의 정확한 응답 구조를 실제로 호출해보지 못하고
문서 기준으로 짰습니다. 키 등록 후 아래 URL을 직접 열어서 `changePct`가 숫자로 나오는지 확인하세요:
```
/api/trend?keyword=치즈탕수육
```
`changePct`가 `null`이거나 이상하면, 결과의 `raw`(또는 실패 시 `detail`) 필드에 실제 응답이 그대로 들어있으니
그 구조를 보고 `api/trend.js`의 `data?.results?.[0]?.data` 경로를 수정하면 됩니다.
파일 구조
```
/index.html           → 화면 (자동완성 지역 검색 + 대분류/세부업종 + 실데이터 연동)
/api/suggest.js         → 지역 자동완성
/api/diagnose.js        → 업종 포화도 (세부업종 → 안 되면 대분류로 확장)
/api/trend.js           → 검색어 트렌드 (관심도 지수)
/api/_lib.js            → 공통 상권정보 API 호출 로직
```
비용
Vercel 무료 티어로 충분
상권정보 API, 네이버 검색어 트렌드 API 둘 다 무료 티어로 충분 (소규모 트래픽 기준)
