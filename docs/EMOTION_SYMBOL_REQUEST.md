# 감정 상징 12종 — 그림 요청서 (기본 그림 1장씩)

> 2026-11-18 결정: 12종의 **기본 그림만** 먼저 만들어 어항에 한꺼번에 넣고 사람 평가를 해요. 모양 변형과 자란 단계 그림은 평가 뒤에 만들어요(그전에는 크기·빛으로 단계를 표현).
> 기획: [EMOTION_DICTIONARY.md](EMOTION_DICTIONARY.md) · 규격: [ASSET_SPEC.md](ASSET_SPEC.md)

## 만들 때 꼭 지킬 것
1. **한 장에 하나씩**, 화풍은 지금 어항과 같은 **세미 리얼**로요(실사 느낌 + 조금 더 선명한 색 + 정리된 윤곽, 고급 모바일 게임 일러스트, 왼쪽 위 조명).
2. **배경은 단색**(흰색, 그림이 하얗거나 밝으면 초록색 #00FF00). 배경 제거는 Claude가 해요.
3. **그림자·물·다른 물건·글자 없이.** 그림 바깥으로 퍼지는 **빛 번짐(후광)도 그리지 않기.** 빛은 앱이 따로 넣어요. 그림 안쪽의 빛(유리병 속 불빛 등)은 괜찮아요.
4. **작게 보여도 알아볼 수 있게.** 어항에서는 높이 70~100px 정도로 작게 보여요. 모양(실루엣)이 또렷해야 하고, 자잘한 장식은 빼요. **색만으로 구별되지 않게 모양이 서로 달라야 해요.**
5. 바닥에 놓이는 것은 **아래 가운데가 바닥 닿는 점**이에요. 그림 아래쪽에 여백을 거의 두지 않아요.
6. 무섭거나 징그럽지 않게, 귀엽기보다 **차분하고 예쁜** 쪽으로요.
7. 받은 원본은 그대로 보내 주세요(크기 조정·압축 안 해도 돼요). 원본은 `art/originals/emotions/`, 앱용은 `public/assets/emotions/`에 Claude가 정리해요.

## 공통 문구 (모든 요청 앞에 붙이기)
```
Semi-realistic 2D illustration for a premium mobile aquarium game, single object, soft underwater lighting from the top-left, slightly vivid colors, clean refined edges, bold readable silhouette that is recognizable at small size, no tiny clutter details, plain solid white background, no shadow, no water, no other objects, no text, no watermark, no outer glow or halo
```
흰색이나 아주 밝은 그림이면 `plain solid white background`를 `plain solid pure green (#00FF00) background`로 바꿔요.

## 12종 요청

### 1. 기쁨 — 노을빛 꽃산호 `sunset-coral.png`
바닥 장식 · 세로 4:5 (예: 1024×1280)
```
[공통 문구], a small branching flower coral in warm sunset colors (apricot orange, coral pink, golden tips), several open blooming polyps like little flowers, cheerful and warm, standing on its base, bottom center touches the ground, 4:5 portrait canvas
```

### 2. 설렘 — 반짝이 진주조개 `pearl-clam.png`
바닥 장식 · 4:5
```
[공통 문구], a half-open scallop clam shell with a luminous pearl inside, pink and pearly white shell, a few tiny sparkling bubbles rising just above the pearl, hopeful and fluttering mood, resting on the ground, bottom center touches the ground, 4:5 portrait canvas
```
(조개가 밝은 색이라 초록 배경 권장)

### 3. 신남 — 작은 물고기 떼 `fish-school.png`
물고기 · **물고기 한 마리만** 그려요(앱이 3~5마리로 무리 지어 움직여요) · 가로 2:1
```
[공통 문구], one small lively schooling fish like a rasbora or tetra, bright red-orange body with a gold stripe, slim and energetic, full body in exact side profile, head facing right, all fins visible and not cropped, body centerline horizontal and vertically centered, 2:1 wide canvas
```

### 4. 뿌듯함 — 쌓아 올린 돌탑 `stone-tower.png`
바닥 장식 · 4:5
```
[공통 문구], a small cairn of 4 to 5 smooth rounded river stones stacked neatly from large at the bottom to small at the top, warm grey and sand tones, a tiny warm light dot on the top stone, proud and steady mood, bottom center touches the ground, 4:5 portrait canvas
```

### 5. 평온 — 별빛 해파리 `star-jelly.png`
떠다니는 생물 · 4:5 · **가운데 기준**(바닥에 닿지 않고 물속에 떠 있음)
```
[공통 문구], a gentle translucent jellyfish with a soft round bell and long flowing tentacles hanging straight down, pale blue-violet with tiny star-like dots on the bell, calm and serene, floating, centered in the canvas, 4:5 portrait canvas
```
(투명하고 밝아서 초록 배경 권장)

### 6. 그리움 — 유리병 편지 `bottle-letter.png`
바닥 장식 · 4:5 (병이 비스듬히 누워도 괜찮아요)
```
[공통 문구], an old glass bottle lying tilted and half-buried in a small mound of sand, a rolled paper letter tied with string inside, a faint warm light glowing inside the bottle, nostalgic and longing mood, bottom center touches the ground, 4:5 portrait canvas
```

### 7. 외로움 — 등불 물고기 `lantern-fish.png`
물고기 · 가로 2:1 · 혼자 헤엄쳐요
```
[공통 문구], one small elegant deep-sea fish with a tiny glowing lantern lure on a thin stalk above its head, dark navy body with soft pale gold lantern light, slightly lonely but beautiful, not scary, no sharp teeth, full body in exact side profile, head facing right, all fins visible and not cropped, body centerline horizontal and vertically centered, 2:1 wide canvas
```

### 8. 슬픔 — 푸른 눈물 진주 `tear-pearl.png`
바닥 장식 · 4:5
```
[공통 문구], a single teardrop-shaped deep blue pearl resting on a small open grey shell, glossy reflections, quiet and sorrowful mood, bottom center touches the ground, 4:5 portrait canvas
```

### 9. 답답함 — 엉킨 해초 `tangled-weed.png`
바닥 장식 · 4:5 · **뿌리 없이**
```
[공통 문구], a short clump of seaweed strands knotted and tangled around each other, dark olive and muddy green, twisted and stuck feeling, growing from a single base with no roots, the strands end at the base, bottom center touches the ground, 4:5 portrait canvas
```

### 10. 막막함 — 안개 낀 나침반 `foggy-compass.png`
바닥 장식 · 4:5
```
[공통 문구], an old round brass compass half-buried at an angle in sand, the glass cover slightly clouded, its needle visible, a few soft grey mist wisps clinging close around it (contained, not spreading outward), lost and uncertain mood, bottom center touches the ground, 4:5 portrait canvas
```

### 11. 괴로움 — 검은 성게 `black-urchin.png`
바닥 장식 · 4:5
```
[공통 문구], a round black sea urchin with long thin spines, subtle deep purple highlights on the spines, tense but not scary or gross, resting on the ground, bottom center touches the ground, 4:5 portrait canvas
```

### 12. 졸림 — 잠든 소라고둥 `sleeping-conch.png`
바닥 장식 · 4:5
```
[공통 문구], a spiral conch shell lying on its side with the opening facing the viewer, soft pastel lavender and cream colors, three tiny round bubbles rising slowly from the opening like sleepy breaths, drowsy and cozy mood, bottom center touches the ground, 4:5 portrait canvas
```

## 받은 뒤 Claude가 할 일
- 배경 제거, 여백 정리, 앱용 WebP(가로 512~768px)로 변환
- `manifest.json`에 12종 등록(크기·물고기 헤엄 값·해파리 떠다님), 임시 조약돌(`TraceView`)을 그림으로 교체
  - 신남은 한 마리 그림으로 3~5마리 무리, 평온은 물속에 떠서 천천히 오르내림, 외로움은 혼자 헤엄
  - 자란 단계는 당분간 크기(1단계 1배 → 3단계 1.3배)와 은은한 빛으로 표현
- 검증실에 12종 한눈에 보기 + "이 상징은 어떤 감정일까?" 평가 추가
- 마음에 안 드는 그림은 그 1장만 다시 요청해요

## 체크리스트 (2026-11-18 12종 모두 받음, PR #26으로 적용)
시트에서 잘라 낸 6종(외로움·슬픔·답답함·막막함·괴로움·졸림)은 원본이 362px이에요. 출시 전 개별 고해상도로 다시 요청해요.

| # | 감정 | 파일 | 받음 |
|---|---|---|---|
| 1 | 기쁨 | sunset-coral.png | ✅ |
| 2 | 설렘 | pearl-clam.png | ✅ |
| 3 | 신남 | fish-school.png | ✅ |
| 4 | 뿌듯함 | stone-tower.png | ✅ |
| 5 | 평온 | star-jelly.png | ✅ |
| 6 | 그리움 | bottle-letter.png | ✅ |
| 7 | 외로움 | lantern-fish.png | ✅ |
| 8 | 슬픔 | tear-pearl.png | ✅ |
| 9 | 답답함 | tangled-weed.png | ✅ |
| 10 | 막막함 | foggy-compass.png | ✅ |
| 11 | 괴로움 | black-urchin.png | ✅ |
| 12 | 졸림 | sleeping-conch.png | ✅ |
