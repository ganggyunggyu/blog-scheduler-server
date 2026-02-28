# naver-editor — Playwright UI Automation Library

## OVERVIEW

15-module library that automates Naver Blog editor via Playwright.

## MODULE MAP

| File | Purpose |
|------|---------|
| `types.ts` | TypeScript interfaces: `WritePostOptions`, `ScheduleOptions`, etc. |
| `browser.ts` | BrowserContext + Page lifecycle, session creation with cookies |
| `frame.ts` | Main editor frame detection (SmartEditor iframe), `waitForMainFrame` |
| `popup.ts` | Dismiss help panels and popup dialogs before editing |
| `editor.ts` | Title area focus, content area focus, text alignment (center/left) |
| `content.ts` | Content typing with image interleaving, subheading detection, spacing |
| `image.ts` | Image upload via file chooser, multi-image handling, image removal |
| `publish.ts` | Publish dialog open, category selection, visibility (public/private), tag input |
| `schedule.ts` | Reservation datepicker automation: date navigation, hour/minute select (minute rounded to 10) |
| `oneLineManuscript.ts` | Single-line manuscript formatting for short posts |
| `map.ts` | Naver Map place insertion |
| `link.ts` | Hyperlink insertion |
| `excludeLibraryLink.ts` | Library link exclusion (avoid Naver library links in post) |
| `phone.ts` | Phone number formatted insertion |
| `index.ts` | Barrel re-export of all modules |

## EXECUTION ORDER

Typical compose sequence for a full publish run:

1. `createSession()` — context + page
2. `navigateToEditor()` — GoBlogWrite.naver
3. `waitForMainFrame()` — get editor iframe
4. `dismissPopups()`
5. `focusTitleArea()` — type title
6. `focusContentArea()` → `typeContentWithImages()`
7. `openPublishDialog()` → `selectCategory()` → `setVisibility()`
8. `setScheduleTime()` — datepicker + time selects
9. `confirmPublish()`
10. `closeSession()`

## CONVENTIONS

- All functions take `Page` or `Frame` as first argument
- CSS selectors centralized in `src/constants/selectors.ts` — NEVER hardcode selectors here
- Every UI action uses `waitForSelector` before interaction
- Errors bubble up to `publish.worker.ts` for retry/fail decision

## ANTI-PATTERNS

- NEVER hardcode CSS selectors — use `SELECTORS` constant from `constants/selectors.ts`
- NEVER skip popup dismissal — editor state becomes unpredictable
- NEVER assume frame is ready without `waitForMainFrame()`
- NEVER use `page.click` without waiting for selector first

## GOTCHAS

- Naver editor uses SmartEditor inside an iframe — always work with `frame`, not `page`
- Minute select only accepts values divisible by 10 (0, 10, 20, 30, 40, 50)
- Datepicker month navigation: compare year+month before clicking next/prev
- Image upload triggers file chooser dialog — use `page.waitForEvent('filechooser')`
