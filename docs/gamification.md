# Gamification Integration Recipe

How to wire a new answer flow into the Lodera gamification system.

## 1. Import

```ts
import { StreakBadge } from "@/components/gamification/StreakBadge";
import { ComboMeter } from "@/components/gamification/ComboMeter";
import { SoundToggle } from "@/components/ui/SoundToggle";
import { useStreakTouchOnce } from "@/components/gamification/useStreakTouchOnce";
import { comboReducer, onCorrectAnswer, onIncorrectAnswer } from "@/lib/gamification";
```

## 2. State + hook (inside your client component)

```ts
const [combo, setCombo] = useState(0);
useStreakTouchOnce(); // fires POST /api/streak/touch at most once per page-load
```

## 3. On every answer

```ts
// correct answer
setCombo((prev) => {
  const next = comboReducer({ count: prev }, "correct").count;
  onCorrectAnswer(next); // plays sound; ComboMeter handles visuals
  return next;
});

// incorrect / skipped
setCombo((prev) => comboReducer({ count: prev }, "incorrect").count);
onIncorrectAnswer();
```

## 4. In JSX

Add to your page header (once per page):
```tsx
<StreakBadge />   {/* hidden when logged out */}
<SoundToggle />
```

Add above your answer choices:
```tsx
<ComboMeter combo={combo} />
```

Optionally wrap the choices block in `<CorrectPulse trigger={revealed && wasCorrect}>` for the green-glow pop.

## 5. Policy (defined in lib/gamification.ts — edit there only)

- Correct → `playCorrect` + `CorrectPulse` always  
- Combo milestone (3, 5, 10) → ComboMeter shows brand-colored chip  
- Streak extended today → `playStreak` + StreakBadge celebrates (auto via CustomEvent)  
- Incorrect → `playIncorrect` (gentle), no punishing visuals  
