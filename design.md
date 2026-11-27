---
name: luogu-saver-design
description: 用于洛谷保存站的用户归档页、时间线和记录卡片列表；服务于阅读已有归档与辨认记录时间的用户。
---

## 1. 范围与优先级

- [必须] 将本文件用于归档组件及修改后的用户页和陶片放逐页面。
- [必须] 保留现有 Vue 3、Naive UI 与主题预设，并复用统一的响应式导航壳层（桌面端左栏与移动端顶栏抽屉）。
- [必须] 按用户要求、数据真实性、隐私、可访问性、任务可用性、既有视觉约定的顺序处理冲突。
- [必须] 不为本次功能重做首页、搜索、管理台或全站主题。
- [必须] 为每个新增或修改的完整页面保留且仅保留一个 h1。

## 2. 品牌与读者

- [建议] 将内容、版本和记录时间放在主要区域，使读者先判断这是什么归档，再执行操作。
- [建议] 使用中文动作标签，明确区分本站收录与原文发布。
- [必须] 将公开洛谷 UID 与登录账号的私人关系分开呈现。
- [必须] 将公开资料历史按用户的新要求默认开放，不展示“仅本人可见”或“需要主动开启”提示。
- [建议] 保留现有蓝色主要操作、低对比表面和紧凑信息密度，不添加新的品牌配色。

## 3. 页面结构与构图

- [建议] 用户归档页先显示用户身份和主要操作，再显示归档浏览区和当前/历史资料。
- [建议] 将时间线、作者文章、资料版本和既有权限记录分为可明确切换的区域，避免一个长页面同时展开所有内容。
- [必须] 在历史资料区域显示版本号和本站记录时间，并提供回到当前资料的入口。
- [必须] 明确说明头像仍为当前上游头像，不将它称为历史头像。
- [建议] 时间线使用按月分组的纵向列表，不使用等高营销卡片网格。
- [建议] 紧凑记录列表使用独立 Card 组成单列纵向列表，让卡片高度随正文增长，不在外层嵌套 Card。决策来源：陶片放逐页面的卡片展示要求与现有 Card 原语。
- [建议] 操作型记录卡片在顶部独立标题栏显示操作类型与时间，宽屏两端对齐，在不超过 768px 的视口纵向排列；身份信息和正文置于标题栏下方并允许换行。决策来源：用户提供的陶片卡片参考图；实现来源：packages/frontend/src/components/JudgementCard.vue。
- [建议] 将筛选和加载更多放在它们控制的列表附近。
- [建议] 使用全站列表/工具页的 1220px 内容最大宽度作为新归档页的上限。决策来源：packages/frontend/src/views/user/UserProfileView.vue 与其余列表、工具页的现有容器。
- [建议] 在不超过 768px 的视口将工具栏和并列信息重排为单列。决策来源：App.vue 和 global.css 的现有移动断点。
- [必须] 给网格和可伸缩内容列设置 min-width: 0，不复制会截断窄屏内容的固定最小宽度。

## 4. 视觉规则

### 字体与层级

- [必须] 全站常规界面、导航、标题（首页主标、侧栏字标、CardTitle）与元数据默认统一使用本地加载的西文前置现代无衬线栈（`Plus Jakarta Sans Variable, PingFang SC, Noto Sans SC Variable, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, Hiragino Sans GB, Microsoft YaHei, sans-serif`），通过 --ui-font-family / --ui-font-family-display 统一应用；macOS/iOS 优先命中系统苹方，其余平台按字频分片加载 Noto Sans SC Variable 兜底生僻字。
- [必须] Markdown 长文区（.md-body）通过 --ui-font-family-reading 与 --ui-font-family-reading-heading 控制，支持在主题编辑器中切换现代无衬线、按需懒加载的典雅衬线体（Source Serif 4 Variable + Noto Serif SC Variable）与按需懒加载的霞鹜文楷（LXGW WenKai Screen），生僻字回退至 --ui-font-family-cjk。
- [必须] 代码与等宽文本使用 --ui-font-family-mono，默认保持本地加载的 JetBrains Mono Variable（含完整字重与斜体），并支持在主题编辑器中切换系统等宽、Cascadia Code、Fira Code 或自定义等宽字体栈，中文回退到 --ui-font-family-cjk。
- [建议] 使用 CardTitle 提供页面标题；它已定义桌面 24px、窄屏 22px、700 字重、-0.015em 字距和 1.3 行高，支持可选 `#extra` 插槽放置页头操作。
- [必须] 所有 Hero 保留主标题和原有图标，不绘制背景或外框；首页不显示标题下方标语，导航链接与操作放在独立工具栏或内容卡片中。决策来源：用户要求移除 Hero 副标题与背景，并保留图标。
- [建议] 使用 Card 自带的 16px 区域标题（600 字重）与轻量 18px 线性图标，不在页面重写其内部标题样式。
- [必须] 操作型记录卡片的操作标题继承正文默认字号；保留加粗、图标与文字同色的呈现。决策来源：用户要求卡片标题使用默认大小。
- [必须] 操作型记录卡片的用户名沿用用户页身份栏的 18px、700 字重，认证标记使用 16px，并垂直居中对齐。实现来源：UserProfileView.vue 的 archive-identity-name 与 UserPrizeBadge；决策来源：用户要求与用户页姓名及钩子匹配。
- [建议] 常规控件和元数据沿用 Naive UI 默认 14px 字号。
- [必须] 不将主要内容缩为低于常规控件字号的灰色小字。
- [建议] 时间和数量使用等宽数字特性，使列表元数据可比较。

### 颜色与表面

- [必须] 使用既有 --ui-\* 语义 token，不在新页面硬编码浅色或深色调色板。
- [建议] 正文使用 --ui-text-color，说明使用 --ui-secondary-text-color，次要时间使用 --ui-muted-text-color。
- [建议] 主要操作使用 Naive UI 的 primary 类型和已有 --ui-primary-color。
- [建议] 将 --ui-card-color、--ui-panel-color、--ui-border-color 和 --ui-card-radius 用于容器及轻分隔。
- [建议] 操作型记录卡片的标题栏使用 --ui-card-color，正文表面使用 --ui-translucent-card-color；条目名称使用 --ui-panel-color 与轻边框区分。决策来源：用户提供的陶片卡片参考图；复用现有主题 token。

### 间距与响应式

- [建议] 页面组间距使用 --ui-section-gap，组件间距使用 --ui-space-4 或 --ui-space-3。
- [建议] Card 的内边距由 --ui-card-padding 控制，不在页面重复覆盖。
- [建议] 控件间距使用 --ui-control-gap，行内动作间距使用 --ui-inline-gap。
- [必须] 操作型记录卡片的头像使用 32px × 32px，复用 --ui-space-8。决策来源：用户要求缩小头像。
- [必须] 让筛选器、日期选择器、按钮和版本选择器在窄屏换行；子项宽度不得超过可用列。
- [必须] 不使用根级 overflow: hidden 掩盖页面横向溢出。
- [建议] 普通标题、链接说明和元数据必须可换行。

### 图标、交互和状态

- [建议] 复用 lucide-vue-next 图标和 NIcon，不新增图片装饰。
- [建议] 允许 Card 既有图标外观，不再叠加独立的彩色图标底板。
- [必须] 为仅图标按钮提供可访问名称。
- [必须] 操作型记录卡片的用户名链接在普通和悬停状态均不显示下划线。决策来源：用户要求用户名链接悬停时无下划线。
- [必须] 使用 Naive UI 的禁用、加载和焦点状态，或为自定义控件提供可见焦点。
- [必须] 将加载、空列表、无权限和请求失败区别呈现；不能把失败当成成功的空列表。
- [必须] 让未登录用户看到真实的 CP OAuth 登录入口，而非无效按钮。
- [必须] 在路由、版本或筛选变化时丢弃旧请求结果，避免把上一位用户的数据显示在新页面。
- [必须] 页面进入使用 260ms 淡入并轻度上移（8px），不缩放或等待离场动画；从文章卡片进入详情页时，点击卡片扩展为覆盖主内容区的主题渐变蒙版与独立居中标题层，在蒙版后完成路由切换并留出短暂骨架挂载时间（不阻塞等待接口返回）后平滑淡出；直接访问文章/剪贴板链接或从非卡片链接进入时同样使用该主题渐变揭示蒙版完成过渡；首页与列表/统计分区可使用上限受控的 `.ui-stagger-item` 级联入场，筛选和数据刷新不重复播放页面入场；异步路由切换超过 120ms 时在视口顶部展示 2px 合成层进度条。
- [建议] 交互卡片仅在支持悬停的精细指针设备上上浮 3px 并展示阴影与边框强调、按压时压回，边框反馈使用 120ms，变换和阴影使用 180ms；交互控件可提供 90ms 轻微按压反馈；不为整页长列表添加无限滚动触发的逐项重播动画。
- [必须] 桌面侧栏采用显式折叠切换（`≥1280px` 默认 `220px` 推挤，`769px–1279px` 默认 `64px` 图标轨且浮层展开），不使用悬停自动展开；移动端（`≤768px`）使用 `52px` 顶部轻量栏配合左侧 `n-drawer` 导航抽屉。子菜单与筛选面板展开复用 `.ui-collapse`，浮层与横幅入场复用 `ui-float-up`，标签/徽章弹出复用 `ui-pop`（均支持 `<TransitionGroup>` 重排过渡），异步内容揭示复用 `.ui-content-reveal`；过渡统一使用 --ui-motion-instant、--ui-motion-fast、--ui-motion-normal、--ui-motion-slow 与 --ui-motion-ease\*。
- [必须] 遵循 prefers-reduced-motion 并在设置页提供站内动效偏好（跟随系统 / 标准动效 / 减少动效），统一由 useMotionPreference / useReducedMotion 同步至 `html[data-ui-motion]`：减少动效模式下禁用页面入场、文章卡片扩展、级联入场、View Transitions 主题径向扩散过渡、数据柱生长、循环装饰与数字滚动，滚动定位立即完成，广告不自动轮播。侧栏与抽屉状态切换不依赖减少动效模式下不会触发的 transitionend。

## 5. 可用原语

| 角色         | 实现名称                                                                                                                                                                                                                         | 来源                                                                                                                                                                           | 使用条件                                                                                                              | 状态   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------ |
| 页面标题     | CardTitle，title / icon 属性，extra 插槽                                                                                                                                                                                         | packages/frontend/src/components/CardTitle.vue                                                                                                                                 | 每个完整页面一次；包含 h1                                                                                             | 已实现 |
| 区域容器     | Card，title / icon / hoverable / to / backgroundColor，header-extra 插槽                                                                                                                                                         | packages/frontend/src/components/Card.vue                                                                                                                                      | 信息区；避免嵌套 Card；to 把标题渲染为站内链接                                                                        | 已实现 |
| 操作记录卡片 | JudgementCard，item / displayOptions                                                                                                                                                                                             | packages/frontend/src/components/JudgementCard.vue                                                                                                                             | 纵向操作记录列表；沿用 Card 表面，提供独立标题栏与正文条目                                                            | 已实现 |
| 正文展示     | MarkdownViewer，content / loading / headingOffset                                                                                                                                                                                | packages/frontend/src/components/MarkdownViewer.vue                                                                                                                            | 文章正文使用 headingOffset=1；h3 下的资料介绍使用 3；保留锚点和原始 Markdown                                          | 已实现 |
| 用户标识     | UserLink、UserPrizeBadge                                                                                                                                                                                                         | packages/frontend/src/components/                                                                                                                                              | 用户名称和等级展示                                                                                                    | 已实现 |
| 操作与表单   | NButton、NInput、NSelect、NDatePicker、NCheckbox、NCheckboxGroup、NSwitch                                                                                                                                                        | naive-ui                                                                                                                                                                       | 主要操作、UID 输入、筛选、版本和偏好；NCheckbox 使用 checked / onUpdateChecked / label                                | 已实现 |
| 状态         | NSpin、NSkeleton、NEmpty、NAlert、useMessage、useDialog、createDiscreteApi                                                                                                                                                       | naive-ui                                                                                                                                                                       | 加载、空、错误和操作确认；useDialog 用于 provider 内部，App 层使用 createDiscreteApi；弹窗动作允许换行                | 已实现 |
| 分区与翻页   | NTabs、NTabPane、NPagination                                                                                                                                                                                                     | naive-ui                                                                                                                                                                       | 任务分区及页码列表；时间线使用加载更多                                                                                | 已实现 |
| 字体和主题   | --ui-font-family、--ui-font-family-display、--ui-font-family-reading、--ui-font-family-reading-heading、--ui-font-family-mono、useReadingFont、useCodeFont、ThemeEditor、App 的 Naive UI provider、uiThemeKey、UiThemeVars       | styles/global.css、main.ts、composables/useReadingFont.ts、composables/useCodeFont.ts、components/ThemeEditor.vue、App.vue、styles/theme/themeKeys.ts、styles/theme/presets.ts | 无衬线、思源黑体与 JetBrains Mono 在 main.ts 本地导入，衬线体与霞鹜文楷按需懒加载；阅读与代码字体均在主题编辑器切换   | 已实现 |
| 颜色与间距   | 本文件第 4 节列出的 --ui-\* token                                                                                                                                                                                                | packages/frontend/src/styles/global.css                                                                                                                                        | 页面和组件样式                                                                                                        | 已实现 |
| API 与登录   | apiFetch、requestErrorMessage、getApiUrl、isAuthenticated、currentAuth、currentAuthState、ensureCurrentAuth、startCpOAuthLogin                                                                                                   | utils/request.ts、utils/api-base-url.ts、utils/auth.ts、api/auth.ts                                                                                                            | 复用认证、API base URL、登录重定向和请求错误处理                                                                      | 已实现 |
| 访问门禁     | AccessGate，allowed / redirect，默认插槽                                                                                                                                                                                         | packages/frontend/src/components/AccessGate.vue                                                                                                                                | 需要登录或权限的整页；区分未登录、确认中、登录失效、确认失败、无权限                                                  | 已实现 |
| 动效         | --ui-motion-instant/fast/normal/slow、--ui-motion-ease/ease-out/ease-in/ease-spring、.ui-fade/.ui-float-up/.ui-pop/.ui-collapse/.ui-content-reveal/.ui-stagger-item、useMotionPreference、useReducedMotion、useArticleTransition | styles/global.css、composables/useMotionPreference.ts、composables/useReducedMotion.ts、composables/useArticleTransition.ts                                                    | 90ms/120ms/180ms/260ms 轻量合成层反馈、径向主题切换、文章卡片扩展与受控级联入场；JS 行为与 CSS 共用系统及站内动效偏好 | 已实现 |

- [必须] 页面只使用这里已列出的原语和它们文档化的 API，不猜测组件属性。
- [建议] 新归档组件的局部类名使用 archive- 前缀。决策来源：限定本次功能的样式影响范围。
- [必须] 页面局部样式不得重写 CardTitle、Card 或 Naive UI 的全站字号、表面、边框和主题值。
- [建议] 局部布局可以组合以上原语；新增共享样式必须有两个真实使用点，而不是为未来建立组件库。

## 6. 文案与数据

- [必须] 区分本站收录时间与原文发布时间，不把抓取时间称为作者编辑时间。
- [必须] 原文发布时间未知时显示未知或省略，不使用本地日期冒充。
- [必须] 控件只有在 API 成功后才能报告偏好操作成功。
- [必须] 不把内部堆栈、SQL、密钥或文件路径展示给用户。

## 7. 反模式

- [建议] 不将居中大标题加等高卡片网格套用于所有新页面。
- [建议] 不在 Card 内再包一层 Card。
- [建议] 不为普通日期、数量和 UID 批量添加胶囊标签。
- [建议] 不为元数据使用原语之外的小字号或颜色字面值。
- [建议] 不把已存在的本地段落书签改造成伪跨设备收藏。
- [必须] 不用完整正文渲染时间线列表。
- [必须] 不提供没有真实行为的按钮、静态私人数据或伪成功状态。

## 8. 实现与接入

- [必须] 继续使用 Vue 单文件组件、现有路由模块自动加载和 Naive UI。
- [必须] 全局 `ThemeEditor` 与 `UserNotificationCenter` 挂载于 `n-dialog-provider` 内部并由导航壳层触发；App 层跨 `n-dialog-provider` 边界的弹窗使用 `createDiscreteApi`，并以响应式 `configProviderProps` 同步当前主题，App 卸载时调用其 `unmount`。只有处于 `n-dialog-provider` 后代组件的 `setup` 才使用 `useDialog`。
- [必须] 清理样式前核对模板、动态类名、组件及运行时 HTML 的来源；保留 Naive UI 生成的内部选择器、Vue 过渡类和 Markdown 渲染样式，不以模板中没有类名作为删除依据。决策来源：用户的全站无用 CSS 清理要求。
- [建议] 将时间线、文章列表和资料历史分成有明确任务的组件，避免把全部逻辑塞进 UserProfileView。
- [必须] 复用 api/archive.ts 类型和请求函数，并核对实际后端错误语义。

## 词汇表

| 概念                   | 名称     |
| ---------------------- | -------- |
| 被归档的洛谷身份       | 洛谷 UID |
| 本站登录身份           | 登录账号 |
| 文章第一次进入本站     | 首次收录 |
| 本站记录的一份文章内容 | 归档版本 |
| 本站记录的一份完整资料 | 资料快照 |
