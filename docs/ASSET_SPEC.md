# 그래픽 리소스 규격

이 문서는 ChatGPT(또는 다른 도구)로 이루리움 그래픽을 만들 때의 규칙입니다. 이 규칙만 지키면 `public/assets/`에 파일을 넣는 것만으로 화면에 바로 반영됩니다.

## 1. 공통 원칙

- **한 장에 하나씩.** 배경, 바닥, 물고기, 수초, 수석, 상징, 효과는 모두 따로 만듭니다. 어항 전체를 한 장으로 만들면 움직이거나 자라게 할 수 없습니다.
- **같은 화풍.** 한 테마의 리소스는 같은 조명 방향(왼쪽 위), 같은 채도, 같은 선 굵기로 맞춥니다.
- **투명 배경.** 배경과 바닥을 뺀 모든 리소스는 투명 배경 PNG(또는 WebP)입니다. 그림자를 그려 넣지 않습니다.
- **여백 최소.** 그림 바깥 투명 여백은 가장자리에서 2~4% 정도만 남깁니다.
- **파일 이름은 영어 소문자와 하이픈.** 예: `goldfish.png`, `stem-plant.png`.

생성 도구는 투명 배경을 바로 만들지 못하는 경우가 많습니다. 그럴 땐 흰색이나 초록색 단색 배경으로 만들어 주세요. 배경 제거는 Claude가 할 수 있습니다.

## 2. 종류별 규격

| 종류 | 방향·기준점 | 권장 크기(px) | 캔버스 비율 | 매니페스트 크기 키 |
| --- | --- | --- | --- | --- |
| 물고기 | 정확한 옆모습, **머리가 오른쪽**, 지느러미까지 전신 | 512 × 256 | 2 : 1 | `displayWidth` |
| 수초 | 아래 가운데가 밑동(기준점 0.5, 1), 위로 자람 | 256 × 640 | 2 : 5 | `displayHeight` |
| 수석 | 아래 가운데가 바닥 접점(기준점 0.5, 1) | 400 × 240 | 5 : 3 | `displayWidth` |
| 상징(산호·등불 등) | 아래 가운데가 바닥 접점 | 320 × 400 | 4 : 5 | `displayHeight` |
| 배경(물·원경) | 꽉 찬 사각형, 투명 아님 | 2000 × 1200 | 5 : 3 | 고정 |
| 바닥 | 위쪽 경계는 자연스러운 모래 물결, 아래는 꽉 참 | 2000 × 280 | 50 : 7 | 고정 |
| 효과(빛줄기·별·기포) | 투명, 가운데 기준 | 빛줄기 800 × 1200, 별 128 × 128, 기포 64 × 64 | — | 고정 |

권장 크기의 2배까지는 괜찮습니다. 그 이상은 휴대폰에서 느려질 수 있습니다.

## 3. 물고기를 따로 나눠야 하나요?

**나누지 않아도 됩니다.** 이 앱은 물고기 한 장을 화면에서 휘게 해서(PixiJS MeshRope) 꼬리와 몸통이 헤엄치는 것처럼 보이게 합니다. 그래서 이 조건만 지키면 됩니다.

- 머리가 오른쪽, 꼬리가 왼쪽 끝에 닿게
- 몸통 가운데 선이 그림의 세로 가운데에 오도록(위아래로 기울지 않게)
- 등지느러미·배지느러미가 위아래 가장자리에서 잘리지 않게

나중에 지느러미를 따로 펄럭이게 하고 싶을 때만 `fish/goldfish-body.png`, `fish/goldfish-fin-top.png`처럼 부위별 파일을 추가합니다. 지금 단계에서는 필요 없습니다.

## 4. 폴더와 파일 이름

원본과 앱용 파일을 나눠 관리합니다.

- **원본** `art/originals/<종류>/<이름>.png`: 생성 도구에서 받은 투명 PNG 그대로(크기 조정·압축 안 함). 앱에 실리지 않고, 다시 다듬거나 크기를 바꿀 때 씁니다.
- **앱용** `public/assets/<종류>/<이름>.webp`: 원본에서 여백 정리 후 가로 768px 안팎 WebP(물고기 약 100KB). manifest.json은 이 파일을 가리킵니다.

```
public/assets/
  manifest.json
  themes/<테마 id>/background.png
  themes/<테마 id>/floor.png
  fish/<어종>.png              예: medaka.png, goldfish.png, neon-tetra.png
  plants/<수초>.png             예: stem.png, leafy.png
  rocks/<수석>.png
  symbols/<상징>.png
  fx/bubble.png, fx/lightray.png, fx/star.png
```

## 5. 매니페스트 예시

```json
"fish.goldfish": {
  "src": "fish/goldfish.png",
  "displayWidth": 130,
  "swim": { "amplitude": 0.12, "frequency": 0.8 }
}
```

- `src`: `public/assets/` 기준 경로
- `displayWidth` / `displayHeight`: 어항 논리 좌표(가로 1000 × 세로 600)에서의 크기
- `swim.amplitude`: 꼬리 흔들림 폭(몸길이 대비, 0.08~0.14 권장). `frequency`: 초당 흔들림 횟수
- `sway`(수초): `amplitude`는 기울기(0.04~0.08), `frequency`는 초당 흔들림 횟수

요소 id(`fish.goldfish` 등)는 엔진 카탈로그(`src/engine/catalog.ts`)에 있어야 어항에 나옵니다. 새 어종을 추가하려면 카탈로그에도 한 줄을 추가해야 합니다(감정 위치, 개수 상한).

## 6. 첫 리소스로 추천하는 묶음

| 종류 | 개수 | 지금 임시 파일 |
| --- | --- | --- |
| 물고기 | 2종(송사리형, 금붕어형) | `fish/medaka.svg`, `fish/goldfish.svg` |
| 수초 | 2종(긴 줄기형, 잎이 풍성한 형) | `plants/stem.svg`, `plants/leafy.svg` |
| 수석 | 2종 | `rocks/round.svg`, `rocks/sharp.svg` |
| 바닥 | 1종 | `themes/starlit-desert/floor.svg` |
| 배경 | 1종 | `themes/starlit-desert/background.svg` |
| 효과 | 기포, 빛줄기, 별 | `fx/*.svg` |

새 파일 확장자가 바뀌면(.svg → .png) 매니페스트의 `src`도 같이 바꿔 주세요.

## 7. 생성 요청 문구 예시(물고기)

```
Photorealistic aquarium fish, [SPECIES], full body in exact side profile, head facing right, all fins fully visible and not cropped, body centerline horizontal and vertically centered, soft even studio lighting from top-left, high detail, plain solid white background, no shadow, no water, no other objects, 2:1 wide canvas
```

세미 리얼(실사 느낌을 살린 일러스트) 방향이면 첫 줄을 `Semi-realistic 2D illustration of an aquarium fish`로 바꿉니다. 어떤 방향으로 갈지는 같은 어종을 두 스타일로 만들어 비교한 뒤 정합니다.

## 6. 확정 스타일: 세미 리얼 (2026-11-13)

- 기획자 결정으로 **세미 리얼**을 이루리움의 그래픽 스타일로 정했습니다. 앞으로 만드는 물고기·수초·수석·배경은 같은 화풍으로 맞춥니다.
  - 실사 느낌(비늘·지느러미 결, 부드러운 수중 조명)은 유지하되 색을 조금 더 선명하게, 윤곽을 살짝 정리한 고급 모바일 게임 일러스트
- 적용: `fish.goldfish` → `fish/goldfish-semi.webp` (displayWidth 180, swim 0.08 / 0.7). ChatGPT로 만든 류킨 금붕어, 원본 1774×887 투명 PNG → 여백 정리 후 768×433 WebP(약 100KB).
- 비교용으로 `fish/goldfish-real.webp`(실사)와 `fish/goldfish.svg`(이전 임시)를 남겨 두고, 검증실 "그래픽 비교" 탭에서 볼 수 있습니다.
- 지느러미가 긴 어종은 그림 폭에 지느러미가 포함되므로 `displayWidth`를 몸통 기준보다 크게(금붕어 약 180) 잡고, 휘는 정도(`swim.amplitude`)는 0.06~0.09가 자연스럽습니다.
- 휴대폰 용량을 위해 물고기는 가로 768px 안팎 WebP를 권장합니다.

### 적용된 세미 리얼 물고기 (2026-11-13)

| 요소 | 어종 | 앱용 파일 | displayWidth | swim (amplitude / frequency) |
| --- | --- | --- | --- | --- |
| fish.goldfish 노을 금붕어 | 류킨 금붕어 | fish/goldfish-semi.webp (768×433) | 180 | 0.08 / 0.7 |
| fish.medaka 모래빛 송사리 | 황금 송사리 | fish/medaka.webp (768×248) | 112 | 0.10 / 1.1 |
| fish.bluefin 푸른 밤 물고기 | 하프문 베타 | fish/bluefin.webp (768×415) | 170 | 0.06 / 0.6 |
| fish.foxfish 여우 물고기(완성 대표) | 버터플라이 비단잉어 | fish/foxfish.webp (768×335) | 210 | 0.07 / 0.6 |

원본 투명 PNG는 `art/originals/fish/`. 지느러미가 큰 베타·비단잉어는 휘는 정도를 낮게(0.06~0.07) 잡아야 지느러미가 과하게 출렁이지 않습니다. 베타는 190으로 키워 보면 한 장면에선 보기 좋지만, 200일 어항에서 3마리가 최대 1.5배로 자라면 화면을 많이 가려 170으로 두었습니다.

### 적용된 세미 리얼 수초·수석 (2026-11-13)

| 요소 | 실물 | 앱용 파일 | 크기 키 | 흔들림 |
| --- | --- | --- | --- | --- |
| plant.stem 모래풀 | 발리스네리아 | plants/stem.webp (263×640) | displayHeight 240 | 0.06 / 0.35 |
| plant.leafy 잎 풍성한 수초 | 루드위지아 | plants/leafy.webp (307×640) | displayHeight 220 | 0.04 / 0.30 |
| plant.foxtail 여우꼬리풀 | 미리오필룸 | plants/foxtail.webp (291×640) | displayHeight 230 | 0.05 / 0.40 |
| rock.round 둥근 수석 | 둥근 강돌 무리 | rocks/round.webp (640×380) | displayWidth 140 | - |
| rock.sharp 모난 수석 | 청회색 산석 | rocks/sharp.webp (640×415) | displayWidth 140 | - |

- 생성 도구가 수초에 **뿌리**까지 그려 주는 경우가 많습니다. 앱은 수초를 모래 위에 세우므로(기준점 = 아래 가운데) 줄기가 뿌리로 바뀌는 높이에서 잘라 내고, 잘린 밑동 아래 10px만 살짝 투명하게 처리했습니다. 원본(뿌리 포함)은 `art/originals/plants/`에 있습니다.
- 다음에 수초를 요청할 때는 "뿌리 없이, 줄기 밑동에서 끝나게"라고 덧붙이면 손질이 줄어듭니다.
