# Phase 3: prototype variants, the full steps

Read by the lead from `/agent-hq:feature` phase 3. The gate stays in SKILL.md.
**Ask once, first**, in one AskUserQuestion with three questions: where to build them, on the Design canvas
(Recommended: about twice as fast to a visible result, nothing in the repo) or in the app with HeroUI (high fidelity on
the real stack, slower, and phase 6 takes it out again); how many variants, 2 or 3; and, for the Design canvas, whether
you check that every board renders before the gate (the Design type lets you verify only when the person asks).

**Choose and rank the variants.** Pick 2 or 3 variants, as asked, that differ in both UI and UX, never in colour alone:
- **visual style**: for example minimal and airy, dense and data-first, card-based, or bold and editorial;
- **UX**: the flow and where the action lives, for example one page against a step-by-step wizard, inline editing
  against a side panel, or the main action up front against behind a menu.

Give each a short name and one line: its style, its flow, and who it suits. Then **rank** them, best fit for the spec,
the project's design and the person's constraints first. The top one is the **Recommended** variant, and the rank is
the order everywhere after this: the briefs, the canvas and the gate.

**Build them in parallel.** Brief one frontend member per variant with hq_assign, **in parallel**: each builds
**one variant** only, from the approved spec and its line above, with mock data and no backend changes: every screen of
the main flow with its loading, empty, error and partial states, and every state the spec's acceptance criteria name.
With fewer frontend members than variants, run them one after another, or offer hq_hire.

**On the Design canvas (the default).** Claude's own canvas, the Artifact tool's Design type: live boards in rows, a
private link the person can share, comments for feedback, nothing in the repo. Boards use the type's own format with no
npm libraries (so no HeroUI), and links between boards did not work in Play mode in a test: promise no click-through,
and give each screen and each state its own board.
- **You lay it out** before the builders start: create the canvas with the Artifact tool from the Design type, follow
  the instructions its result returns, and save them to a file the briefs point at. Write `project/canvas.json` with
  every board already placed: one row per variant in rank order, the Recommended row on top, each row titled with the
  variant's name; a board for every screen and every state the spec's acceptance criteria name (the empty state too), at
  phone or desktop size as the spec needs, named `<variant>-<screen>.dc.html`. Publish it together with the entry board,
  `Main.dc.html` (the type asks for both in one call): the variants in rank order, each with its style and flow line and
  its main trade-off, and why the Recommended one. Only you change `canvas.json`.
- **Each builder writes only its own boards**, the files and sizes its brief names, directly with its file tool, in its
  own folder outside the repo, such as `<scratchpad>/boards/<variant>/` in the session's scratchpad:
  no generator scripts, no shared scratch folders or temp files (in a test run one member's script was overwritten and
  run by another). Its brief has no `files` (hq_assign scopes only paths inside the project), and `limits`: never
  `canvas.json`, the repo or other boards. A UI role with a tools list needs `Artifact` to publish, added through
  `/agent-hq:team`.
- **Publishing**: a publish is refused unless the publisher has viewed the canvas's latest version, every publish makes
  a new version, and a read and the publish built on it must be in separate turns. So each builder reads the canvas in
  one turn, then publishes all its boards in one publish call in its next turn; refused with
  "You haven't viewed the latest version", it reads again and publishes again in its next turn. `done`: "every board
  published and listed".
- **Render check**, only when the person said yes: open the canvas in a browser's foreground tab (a background tab
  freezes CSS transitions and gave false alarms) and check that every board renders, before the gate.

**In the app with HeroUI (opt-in).** High-fidelity prototypes on the real stack: each variant is a throwaway route in
the app, built with HeroUI v3, and a React Flow page lays them all out.
- **HeroUI v3**: web is `@heroui/react` with `@heroui/styles` (React 19 or later, Tailwind CSS v4, no provider); never
  the v2 or NextUI setup (`HeroUIProvider`, `@heroui/theme`, the `heroui()` Tailwind plugin, a `tailwind.config` content
  entry). Variants differ by layout, flow and theme tokens. React Native uses `heroui-native` with its provider, shown
  through the app's web build (Expo web), else as simulator screenshots. When the app cannot take HeroUI (React older
  than 19, Tailwind older than v4) or the person asks, use the project's own stack and UI library instead.
- **HeroUI's tools, never memory**: every UI brief has the member load the `heroui-react` skill (`heroui-native`) and
  call the HeroUI MCP server (`@heroui/react-mcp`) before it writes a component: `list_components`,
  `get_component_docs`, `get_theme_variables` for a variant's tokens, and the source tools to restyle a part; without
  them, `https://heroui.com/react/llms.txt` (`/native/llms.txt`). Ask the person before installing what the session
  lacks: the Claude skill only, with `npx skills add heroui-inc/heroui --skill heroui-react -a claude-code` (HeroUI's
  install script puts it into every AI tool it finds), and
  `claude mcp add heroui-react -- npx -y @heroui/react-mcp@latest` (`@heroui/native-mcp` and the name `heroui-native`
  for React Native; Node 22 or later). Then check with ToolSearch whether its tools loaded (they can, at once); only if
  not, ask for a restart of Claude Code and `/agent-hq:feature` again, which resumes here. A skill installed mid-session
  does not load for members ("Unknown skill"): give them its `SKILL.md` path. A UI role with a tools list needs the MCP
  tools by full name (`mcp__heroui-react__get_component_docs`), which only `/agent-hq:team` can add; until then it uses
  the skill and `llms.txt`.
- **One dev server**: you run one dev server per app and put its URL in every brief; members never start their own (two
  `next dev` in one app collide).
- **First, one setup task**: one frontend member (or you) installs HeroUI if the app does not have it, at the exact
  versions its quick start names, else the newest exact versions at least two weeks old. It first checks `.npmrc` and
  the package manager's config for `legacy-peer-deps`, and installs HeroUI's peer dependencies explicitly. It adds a
  prototypes-only stylesheet (`@import "tailwindcss";` then `@import "@heroui/styles";`) loaded by the prototypes' own
  layout, so the real app's styles do not change. It is an hq_assign of its own, with
  `files`: package.json, the lockfile, the middleware file when the routes need its matcher exclusion (below), the
  prototypes layout and its stylesheet. It is done only when you load `/prototypes/<feature>` and a HeroUI `Button`
  renders (HTTP 200, no error overlay): lint and tsc passing is not enough. The setup task
  finishes before the variants and the canvas start, and is the only assignment that touches package.json, the
  lockfile or the middleware; note in the spec what it added.
- **Routes**: each variant gets `<app>/prototypes/<feature>/<variant>/**`, in a folder the router serves (the Next.js
  App Router never serves one whose name starts with `_`). Under i18n middleware (next-intl's `localePrefix: 'always'`)
  or an app-shell layout (analytics, presence beacons, backend fetches), put them outside the locale segment, with their
  own root layout and a middleware matcher exclusion.
- **Variant briefs**: `files` its own variant folder and its flow file; `done` "every screen of the main flow renders at
  desktop and mobile width on its own URL, with its states, the flow file lists them, and the report gives the URLs";
  `limits` "no backend, no shared components, no real data, no change to package.json, no dev server of your own".

Each in-app variant writes its flow file, `flows/<variant>.json` next to the canvas: its screens and how one leads to
the next. A screen has a `url`, or an `"image"` (a screenshot path) where it cannot be shown live, and a `state` when
it shows one (`"empty"`, `"error"`). This flow schema goes in the canvas member's brief too (links use `trigger`):

```json
{
  "variant": "wizard",
  "screens": [
    { "id": "list", "title": "My bookings", "url": "/prototypes/booking-cancellation/wizard/list" },
    { "id": "list-empty", "title": "No bookings", "state": "empty", "url": "/prototypes/booking-cancellation/wizard/list?state=empty" },
    { "id": "confirm", "title": "Confirm cancel", "url": "/prototypes/booking-cancellation/wizard/confirm" }
  ],
  "links": [{ "from": "list", "to": "confirm", "trigger": "Tap Cancel" }]
}
```

**The React Flow canvas.** At the same time as the variants, one more member (or you) builds one static page,
`public/prototypes/<feature>/index.html` for Next.js (the app's public folder elsewhere, same origin as the variants),
loading React, `@xyflow/react@12.11.6` (or a newer exact version at least two weeks old) and its `dist/style.css` from a
CDN such as esm.sh, so package.json does not change (if the project already depends on `@xyflow/react`, it may be a
route). Its `files` are that folder. It writes `flows/index.json`, the flow files in rank order (a static page cannot
list a folder), reads them, and shows them all at once, like a design tool's prototype canvas:
- each screen is a custom node: a labelled frame holding its URL in an iframe (or its `image`), the iframe classed
  `nodrag` and `nowheel` so the person can use it; a variant's screens sit side by side in one row, in flow order with
  state screens after their screen; rows go in rank order, so the Recommended variant is the top row and its
  first frame the leftmost, with a "Recommended" badge and why; each row is headed by the variant's name, style and flow
  line, and main trade-off; a toggle in a `Panel` switches every frame between desktop and mobile width;
- every frame has a `Handle` node on its left and right edge, and every link is a connection between them, an edge with
  an arrow (`MarkerType.ArrowClosed`) labelled with its trigger; hovering a frame lights up its path;
- the person can drag from a frame's node to a frame in another row to add a connection across variants, sketching a
  mix: `onConnect` adds it with `addEdge`, drawn dashed, Backspace deletes it, and a "Copy mix" button in a `Panel`
  copies the new connections as plain lines (`wizard/list -> single-page/confirm: Tap Cancel`);
- pan (drag or scroll) and zoom (pinch, ctrl+scroll), with `Controls`, a `MiniMap` and a `Background` of dots; a double
  click on a frame opens that screen full size.

**Review, then show.** On the in-app path, first check every screen URL, every flow file and the canvas render in your
browser's foreground tab. Then hq_review the variants to the review role, against the spec: every screen and every
state the acceptance criteria name has its board or URL, and each variant keeps to the spec. Give it the board or route
files on disk (a read-only reviewer may not reach the canvas or the dev server). Findings go back to the builder. Then
show the person the canvas (Artifact `open`, or the in-app browser), else give its link, or its URL and how to start
the server.
