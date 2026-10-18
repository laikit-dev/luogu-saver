---
name: luogu-saver-design
description: 用于洛谷保存站的用户归档页、时间线、版本对比和私人归档清单；服务于阅读已有归档、辨认记录时间与管理私人关注的用户。
---

## 1. 范围与优先级

- [必须] 将本文件用于本次新增的归档组件及修改后的用户页、文章对比和私人清单页面。
- [必须] 保留现有 Vue 3、Naive UI、主题预设和 App 导航布局。
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
- [建议] 私人清单页使用动态、关注、稍后阅读的任务分区，并将摘要偏好放在相关操作附近。
- [建议] 时间线使用按月分组的纵向列表，不使用等高营销卡片网格。
- [建议] 将筛选和加载更多放在它们控制的列表附近。
- [建议] 版本对比使用双版本选择器和按需展开的差异内容，不在时间线中自动加载正文。
- [必须] 允许选择任意两个已有文章版本，不设置四版上限。
- [建议] 使用全站列表/工具页的 1220px 内容最大宽度作为新归档页的上限。决策来源：packages/frontend/src/views/user/UserProfileView.vue 与其余列表、工具页的现有容器。
- [建议] 在不超过 768px 的视口将工具栏和并列信息重排为单列。决策来源：App.vue 和 global.css 的现有移动断点。
- [必须] 给网格和可伸缩内容列设置 min-width: 0，不复制会截断窄屏内容的固定最小宽度。

## 4. 视觉规则

### 字体与层级

- [建议] 继承 App/Naive UI 的 v-sans 与系统字体栈，不新增字体文件。
- [建议] 使用 CardTitle 提供页面标题；它已定义桌面 28px、窄屏 24px、700 字重和 1.25 行高。
- [建议] 使用 Card 自带的 18px 区域标题，不在页面重写其内部标题样式。
- [建议] 常规控件和元数据沿用 Naive UI 默认 14px 字号。
- [必须] 不将主要内容缩为低于常规控件字号的灰色小字。
- [建议] 时间和数量使用等宽数字特性，使列表元数据可比较。

### 颜色与表面

- [必须] 使用既有 --ui-\* 语义 token，不在新页面硬编码浅色或深色调色板。
- [建议] 正文使用 --ui-text-color，说明使用 --ui-secondary-text-color，次要时间使用 --ui-muted-text-color。
- [建议] 主要操作使用 Naive UI 的 primary 类型和已有 --ui-primary-color。
- [建议] 将 --ui-card-color、--ui-panel-color、--ui-border-color 和 --ui-card-radius 用于容器及轻分隔。
- [必须] 差异中的新增/删除同时使用文字或符号标记，不只依靠红绿颜色。
- [建议] 差异背景使用现有 --ui-alert-success-background-color / --ui-alert-error-background-color，正文保持 --ui-text-color，避免低对比彩色正文。

### 间距与响应式

- [建议] 页面组间距使用 --ui-section-gap，组件间距使用 --ui-space-4 或 --ui-space-3。
- [建议] Card 的内边距由 --ui-card-padding 控制，不在页面重复覆盖。
- [建议] 控件间距使用 --ui-control-gap，行内动作间距使用 --ui-inline-gap。
- [必须] 让筛选器、日期选择器、按钮和版本选择器在窄屏换行；子项宽度不得超过可用列。
- [必须] 不使用根级 overflow: hidden 掩盖页面横向溢出。
- [建议] 长代码行可以在差异区域局部滚动；普通标题、链接说明和元数据必须可换行。

### 图标、交互和状态

- [建议] 复用 lucide-vue-next 图标和 NIcon，不新增图片装饰。
- [建议] 允许 Card 既有图标外观，不再叠加独立的彩色图标底板。
- [必须] 为仅图标按钮提供可访问名称。
- [必须] 使用 Naive UI 的禁用、加载和焦点状态，或为自定义控件提供可见焦点。
- [必须] 新归档分区的 NTabPane 使用 archiveTabProps / selectedArchiveTabProps，保证 Enter、空格激活和可见键盘焦点。
- [必须] 将加载、空列表、无权限和请求失败区别呈现；不能把失败当成成功的空列表。
- [必须] 在清空资料历史前展示确认操作，并说明这会停止后续记录。
- [必须] 让未登录用户看到真实的 CP OAuth 登录入口，而非无效按钮。
- [必须] 在路由、版本或筛选变化时丢弃旧请求结果，避免把上一位用户的数据显示在新页面。
- [建议] 沿用现有轻量交互过渡，不为时间线加连续滚动动效。
- [必须] 对本次新增动效尊重 prefers-reduced-motion。

## 5. 可用原语

| 角色         | 实现名称                                                                                                                       | 来源                                                                | 使用条件                                                                     | 状态   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| 页面标题     | CardTitle，title / icon 属性，默认插槽用于副标题                                                                               | packages/frontend/src/components/CardTitle.vue                      | 每个完整页面一次；包含 h1                                                    | 已实现 |
| 区域容器     | Card，title / icon / hoverable / to，header-extra 插槽                                                                         | packages/frontend/src/components/Card.vue                           | 信息区；避免嵌套 Card；to 把标题渲染为站内链接                               | 已实现 |
| 正文展示     | MarkdownViewer，content / loading / headingOffset                                                                              | packages/frontend/src/components/MarkdownViewer.vue                 | 文章正文使用 headingOffset=1；h3 下的资料介绍使用 3；保留锚点和原始 Markdown | 已实现 |
| 用户标识     | UserLink、UserPrizeBadge                                                                                                       | packages/frontend/src/components/                                   | 用户名称和等级展示                                                           | 已实现 |
| 操作与表单   | NButton、NInput、NSelect、NDatePicker、NCheckboxGroup、NSwitch                                                                 | naive-ui                                                            | 主要操作、UID 输入、筛选、版本和偏好                                         | 已实现 |
| 状态         | NSpin、NSkeleton、NEmpty、NAlert、useMessage、useDialog                                                                        | naive-ui                                                            | 加载、空、错误及破坏性动作确认                                               | 已实现 |
| 分区与翻页   | NTabs、NTabPane、NPagination                                                                                                   | naive-ui                                                            | 任务分区及页码列表；时间线使用加载更多                                       | 已实现 |
| 分区键盘操作 | archiveTabProps、selectedArchiveTabProps                                                                                       | packages/frontend/src/utils/archive-tab-props.ts                    | 绑定到 NTabPane 的 tab-props；选中态使用 selectedArchiveTabProps             | 已实现 |
| 字体和主题   | App 的 Naive UI provider、uiThemeKey、UiThemeVars                                                                              | App.vue、styles/theme/themeKeys.ts、styles/theme/presets.ts         | 继承当前主题，不建立平行 provider                                            | 已实现 |
| 颜色与间距   | 本文件第 4 节列出的 --ui-\* token                                                                                              | packages/frontend/src/styles/global.css                             | 页面和组件样式                                                               | 已实现 |
| API 与登录   | apiFetch、requestErrorMessage、getApiUrl、isAuthenticated、currentAuth、currentAuthState、ensureCurrentAuth、startCpOAuthLogin | utils/request.ts、utils/api-base-url.ts、utils/auth.ts、api/auth.ts | 复用认证、API base URL、登录重定向和中文请求错误文案                         | 已实现 |
| 访问门禁     | AccessGate，allowed / redirect，默认插槽                                                                                       | packages/frontend/src/components/AccessGate.vue                     | 需要登录或权限的整页；区分未登录、确认中、登录失效、确认失败、无权限         | 已实现 |

- [必须] 页面只使用这里已列出的原语和它们文档化的 API，不猜测组件属性。
- [建议] 新归档组件的局部类名使用 archive- 前缀。决策来源：限定本次功能的样式影响范围。
- [必须] 页面局部样式不得重写 CardTitle、Card 或 Naive UI 的全站字号、表面、边框和主题值。
- [建议] 局部布局可以组合以上原语；新增共享样式必须有两个真实使用点，而不是为未来建立组件库。

## 6. 文案与数据

- [必须] 使用“本站首次收录”“归档版本”“资料快照”等准确措辞，不把抓取时间称为作者编辑时间。
- [必须] 原文发布时间未知时显示未知或省略，不使用本地日期冒充。
- [必须] 对相同正文的两份归档显示无内容差异，标题变化另行显示。
- [必须] 空资料历史说明只从开始记录后保留，不暗示能还原更早的资料。
- [必须] RSS、时间线、收藏和对比不能继续返回已删除或已清空的历史内容。
- [必须] 私人列表中不可用文章只显示通用占位和移除操作，不展示旧标题或删除原因。
- [必须] 控件只有在 API 成功后才能报告关注、收藏、偏好或清空操作成功。
- [必须] 不把内部异常、SQL、密钥、文档路径或开发状态文案展示给用户。

## 7. 反模式

- [建议] 不将居中大标题加等高卡片网格套用于所有新页面。
- [建议] 不在 Card 内再包一层 Card。
- [建议] 不为普通日期、数量和 UID 批量添加胶囊标签。
- [建议] 不为元数据使用原语之外的小字号或颜色字面值。
- [建议] 不把已存在的本地段落书签改造成伪跨设备收藏。
- [必须] 不用完整正文渲染时间线列表，不自动为所有版本计算 diff。
- [必须] 不提供没有真实行为的按钮、静态私人数据或伪成功状态。

## 8. 实现与接入

- [必须] 继续使用 Vue 单文件组件、现有路由模块自动加载和 Naive UI。
- [建议] 将时间线、文章列表、资料历史和文章对比分成有明确任务的组件，避免把全部逻辑塞进 UserProfileView。
- [必须] 复用 api/archive.ts 类型和请求函数，并核对实际后端错误语义。
- [必须] 用 Vue 文本节点或安全文本组件渲染 diff 片段，不用 v-html 插入用户 Markdown。
- [必须] RSS 链接使用配置后的 API base URL；订阅项链接使用后端的公开站点地址。
- [必须] 页面卸载或 UID 改变时移除旧的 RSS alternate link、监听器及未完成的差异计算。

## 词汇表

| 概念                        | 名称     |
| --------------------------- | -------- |
| 被归档的洛谷身份            | 洛谷 UID |
| 本站登录身份                | 登录账号 |
| 文章第一次进入本站          | 首次收录 |
| 本站记录的一份文章内容      | 归档版本 |
| 本站记录的一份完整资料      | 资料快照 |
| 个人保存的文章清单          | 稍后阅读 |
| 跟随作者/待读内容的私人列表 | 关注动态 |
