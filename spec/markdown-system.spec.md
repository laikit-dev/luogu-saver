# Markdown System Specification

## 1. Scope

This specification defines Markdown rendering behavior provided by `@luogu-saver/markdown-renderer` and consumed by the frontend through `packages/frontend/src/workers/markdown.worker.ts`. The backend SHALL NOT import the renderer or expose a Markdown rendering endpoint.

## 2. Admonition Directive Containers

Supported block container directive names are:

- `info`
- `warning`
- `success`
- `error`

For a supported directive `:::name`, the renderer SHALL output one HTML container with:

1. Class `md-block`.
2. Class equal to `name`.
3. One title child with class `md-block-title`.
4. One body child with class `md-block-body`.

The renderer SHALL accept three or more leading colons for supported container directives.

For a supported nested directive block, a closing line containing the same number of colons as the opening line SHALL close that block and SHALL NOT be emitted as text.

For input:

```md
::::info[outer]
:::info[inner]
body
:::
::::
```

Expected postconditions:

1. The rendered HTML contains two nested `md-block info` containers.
2. The rendered HTML does not contain a paragraph whose text is `::::`.

## 3. Directive Title Resolution

For a supported directive `:::name`, the rendered title text SHALL be resolved by this precedence order:

1. If directive attribute `title` exists, use `title`.
2. Else if directive label `[label]` exists, use `label`.
3. Else use `name.toUpperCase()`.

The directive label node SHALL NOT be rendered inside `md-block-body`.

Example input:

```md
- aaa
  :::success[sb]
  a
  :::
- bbb
```

Expected postconditions:

1. The `success` block title text is `sb`.
2. The `success` block body contains text `a`.
3. The `success` block body does not contain text `sb`.

## 4. Open State

If directive attribute `open` exists, `md-block-body` SHALL be visible initially.

If directive attribute `open` does not exist, `md-block-body` SHALL have style `display:none`.

## 5. Heading Anchors

For each rendered heading element `h1`, `h2`, `h3`, `h4`, `h5`, or `h6`:

1. If the heading does not have an `id`, the renderer SHALL assign a deterministic slug `id` derived from heading text.
2. The renderer SHALL insert one `a` element as the first child of the heading.
3. The inserted `a` element SHALL have class `heading-anchor`.
4. The inserted `a` element SHALL have `href` equal to `#` followed by the heading `id`.
5. The inserted `a` element SHALL contain one Lucide Pin SVG.
6. The heading text SHALL remain outside the inserted `a` element.

## 6. Math Rendering Warnings

The Markdown renderer SHALL pass `strict="ignore"` to KaTeX.

If math content contains LaTeX-incompatible Unicode text, rendering SHALL NOT write a KaTeX strict-mode warning to stdout or stderr.

If a supported directive title contains Markdown math syntax, the title SHALL render that math using the same KaTeX pipeline as normal Markdown content.

For input `::::success[$$\\displaystyle\\sum_{i = 1}^n i$$]`, the rendered title SHALL contain KaTeX HTML and SHALL NOT render the raw TeX text as plain text.
Before invoking KaTeX, the renderer SHALL assign an empty `properties` object to each HAST element
that does not have one. A missing `properties` object SHALL NOT cause rendering to return a failure
paragraph.

### 6.1 Unclosed Display Math Fences

A standalone display math fence is unclosed if `remark-math` parses a line containing only an opening sequence of two or more dollar signs and optional whitespace as a `math` node, and the node does not end with a valid closing display math fence.

A dollar-sign sequence located inside an indented code block or fenced code block when the same input is parsed without math syntax SHALL NOT be a valid closing display math fence.

For each unclosed display math fence, the renderer SHALL:

1. Render the opening dollar-sign sequence as literal text.
2. Parse all content after the opening sequence as normal Markdown.
3. Render later valid inline math independently.
4. Not produce one display-math element that contains all content after the opening sequence.

Given input lines `normal text`, an empty line, `$$`, `inline math: $$ a = b $$`, an empty line, and `following text` followed by EOF, the output SHALL contain the literal text `$$`, SHALL render `a = b` through KaTeX, and SHALL contain `following text` outside that KaTeX element.

A display math fence with a valid closing fence SHALL retain normal display-math behavior. Dollar-sign sequences inside indented code or fenced code blocks SHALL retain normal code behavior.

### 6.2 Multiline Display Math With Attached Content

A display math region in normal Markdown text is an attached-content multiline region if all of these conditions hold:

1. Its opening sequence contains two or more dollar signs.
2. Non-whitespace math content follows the opening sequence on the same line.
3. Its closing dollar-sign sequence occurs on a later line.
4. The closing sequence contains at least as many dollar signs as the opening sequence.

The attached-content multiline region MAY place math content before its closing dollar-sign sequence on the same line.

For each attached-content multiline region, the renderer SHALL:

1. Preserve the math content located on the opening-fence line after the opening sequence.
2. Preserve the math content located on the closing-fence line before the closing sequence.
3. Parse all content between the two sequences as one display-math node.
4. Render valid LaTeX through KaTeX with class `katex-display`.
5. Not emit a `katex-error` element solely because content shares a line with either fence.
6. Preserve the whitespace prefix located before the opening fence on each inserted line.

For the following input, the output SHALL contain one `katex-display` element and SHALL NOT contain `katex-error`:

```text
$$\begin{aligned}a&=\begin{vmatrix}
    1 & 0 \\
    0 & 1
\end{vmatrix}\end{aligned}$$
```

Dollar-sign sequences inside indented code blocks or fenced code blocks SHALL retain normal code behavior.

### 6.3 Single-Line Display Math

A line in normal Markdown text is a single-line display math region if all of these conditions hold:

1. The line contains only optional whitespace, an opening sequence of two or more dollar signs, non-whitespace math content, a closing dollar-sign sequence, and optional whitespace.
2. The closing sequence contains at least as many dollar signs as the opening sequence.
3. The opening and closing sequences are distinct sequences.

For each single-line display math region, the renderer SHALL:

1. Preserve the math content between the opening and closing sequences.
2. Render valid LaTeX through KaTeX with class `katex-display`.
3. Not join the region with a later single-line display math region.
4. Preserve the whitespace prefix located before the opening fence on each inserted line.

A paragraph containing prose and exactly one single-dollar inline math region SHALL render the math without class `katex-display`.

The frontend SHALL center elements with class `katex-display`.

The frontend SHALL NOT center a paragraph solely because its only element child has class `katex`.

Dollar-sign sequences inside indented code blocks or fenced code blocks SHALL retain normal code behavior.

### 6.4 Global Macros

A macro defined via `\gdef\<name>{<body>}` in any math block SHALL be available to all subsequent math blocks within the same document.

The `macros` object SHALL be created once per rendering pass and SHALL NOT be shared across separate requests.

## 7. Unsupported Directives

Only these custom directive names are supported: `info`, `warning`, `success`, `error`, `align`, `epigraph`, and the leaf directive `cute-table` when it satisfies Section 9.

If the parser produces an inline text directive, or a leaf directive other than a valid `cute-table` directive, the renderer SHALL convert it back to literal Markdown text.

For input text `2023/12/15 9:29:37 [通过](https://www.luogu.com.cn/record/139634319)。`, the rendered HTML SHALL keep `9:29:37`, the link, and the trailing punctuation inside one paragraph element.

## 8. Table Merge Markers

For each Markdown table cell, the renderer SHALL inspect the cell text before HTML serialization.

Markdown table alignment markers (`:---`, `:---:`, `---:`) SHALL be preserved in the rendered HTML for normal tables and `cute-table` tables.

If a table cell contains exactly one of these marker strings and the target neighbor exists, the renderer SHALL treat the cell as a structural merge marker:

| Marker | Target neighbor | Structural effect            |
| ------ | --------------- | ---------------------------- |
| `^`    | cell above      | extend target cell downward  |
| `<`    | cell left       | extend target cell rightward |
| `>`    | cell right      | extend target cell leftward  |
| `v`    | cell below      | extend target cell upward    |

For a matched merge marker, the rendered table cell SHALL:

1. Be removed from the rendered HTML table.
2. Increase the target cell `rowspan` or `colspan` by one.
3. Add class `md-table-merged-cell` to the target cell.
4. Not render the marker text.

Any cell with class `md-table-merged-cell` SHALL render its content vertically centered over the merged cell area.

The horizontal alignment of a merged cell SHALL follow the original Markdown alignment of the target cell and SHALL be calculated by the browser over the final merged cell width.

If the required target neighbor does not exist, the renderer SHALL keep the original cell content unchanged.

If a table cell contains exactly one escaped marker string among `\^`, `\<`, `\>`, or `\v`, the renderer SHALL output the unescaped literal character and SHALL NOT apply merge classes.

If a table cell contains any other content, including whitespace around a marker, multiple characters, inline formatting, or nested elements, the renderer SHALL NOT apply merge classes.

## 9. Cute Table Directive

If a leaf directive `::cute-table{tuack}` appears immediately before a Markdown table, the renderer SHALL:

1. Remove the directive from rendered output.
2. Add class `cute-table` to the immediately following table element.
3. Not apply `cute-table` to any later table.

The directive SHALL match only leaf directive name `cute-table` with attribute `tuack` present.

Table merge markers from Section 8 SHALL still apply inside `cute-table` tables.

If the directive is not immediately followed by a table, the renderer SHALL keep its literal text behavior defined by Section 7.

For a `cute-table` table, frontend styles SHALL satisfy these postconditions:

1. The table element is horizontally centered inside its table container.
2. Cell text alignment SHALL follow the original Markdown table alignment rules.
3. The `cute-table` style SHALL NOT force all cell text to center alignment.
4. The leftmost cells have no visible left border.
5. The rightmost cells have no visible right border.
6. The top border and bottom border are the thickest table lines.
7. The second horizontal line from the top is thicker than ordinary inner lines and thinner than the top border.
8. Other visible table lines are solid black.

## 10. Epigraph Directive

For a supported directive `:::epigraph[author]`, the renderer SHALL output one block with class `md-epigraph`.

The block body SHALL be followed by one horizontal line.

Below the line, the renderer SHALL display `——author` aligned to the right.

The block width SHALL NOT exceed one quarter of its parent container width.

The block SHALL be aligned to the right side of its parent container.

## 11. Align Directive

For a supported directive `:::align`, the renderer SHALL output one `div` element.

The output class SHALL be `md-align-{value}` where `value` is resolved by this order:

1. If directive attribute `class` exists, use that value.
2. Else if the directive has any attribute key, use the first attribute key.
3. Else use `center`.

The directive body SHALL be rendered as the children of that `div`.

## 12. Bilibili Image Conversion

For a Markdown image whose URL starts with `bilibili:`, the renderer SHALL replace the image with one HTML block:

1. The outer element SHALL be `div.bilibili-video-container`.
2. The child SHALL be an `iframe` whose `src` starts with `https://player.bilibili.com/player.html?`.
3. URL prefixes `BV`, `av`, and decimal numeric IDs SHALL map to `bvid` or `aid` query parameters.
4. Optional query parameters `page` and `t` SHALL be copied; absent `page` defaults to `1`, absent `t` defaults to `0` and is omitted from the iframe URL.
5. The iframe URL SHALL include `high_quality=1` and `autoplay=0`.

## 12.1 Luogu CAPTCHA Image Placeholder

For a Markdown image whose URL contains the exact case-sensitive substring
`https://www.luogu.com.cn/lg4/captcha`, the renderer SHALL replace the complete image node with
the plain text `[LUOGU CAPTCHA]`.

The rendered HTML for a matched image SHALL NOT contain an `img` element or the matched image URL.

A Markdown image whose URL does not contain that substring SHALL retain normal image rendering,
except for the Bilibili conversion defined in Section 12.

## 13. Frontend Rendering Boundary

1. The frontend SHALL send raw Markdown to one module Web Worker.
2. The Worker SHALL invoke the shared renderer and return one sanitized HTML string.
3. The frontend SHALL insert only the returned renderer output into `v-html`.
4. The backend SHALL return raw Markdown and SHALL NOT render, cache, persist, or return derived
   Markdown HTML.
5. The backend SHALL NOT expose `POST /markdown/render` or any equivalent rendering endpoint.

## 14. GFM Task Lists

For GFM task list input `- [ ] item` or `- [x] item`, the renderer SHALL preserve checkbox inputs in the output HTML.

The checked state SHALL match the Markdown marker.

The checkbox inputs SHALL be disabled.
