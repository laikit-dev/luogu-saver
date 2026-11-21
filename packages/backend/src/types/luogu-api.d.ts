export interface ProblemListParams {
    page?: number;
    keyword?: string;
    content?: boolean;
    orderBy?: string;
    order?: string;
    type?: string;
    difficulty?: number;
    tag?: string;
}

export interface ProblemSetListParams {
    page?: number;
    keyword?: string;
    type?: 'official' | 'select';
}

export interface RecordListParams {
    page?: number;
    pid?: string;
    contestId?: number;
    user?: string;
    status?: number;
    language?: number;
    orderBy?: number;
}

export interface ThemeListParams {
    page?: number;
    orderBy?: string;
    order?: string;
    type?: string;
}

export interface ArticleListParams {
    user: number;
    page?: number;
    category?: number;
    ascending?: boolean;
    promoted?: boolean;
    title?: string;
}

export interface CreatedArticleListParams {
    page?: number;
    category?: number;
    status?: number;
    time?: 'asc' | 'desc';
    type?: 'all' | 'promotion';
    title?: string;
}

export interface BlogListParams {
    uid: number;
    keyword?: string;
    type?: string;
    page?: number;
}

export interface RankingListParams {
    page?: number;
    orderBy?: number;
}

export interface NotificationsParams {
    type?: number;
    page?: number;
}

export interface SubmitCodeRequest {
    code: string;
    lang?: number;
    enableO2?: number;
    captcha?: string;
}

export interface CreateProblemRequest {
    settings: ProblemSettings;
    type: string;
    providerID: number | null;
}

export interface UpdateTestCasesSettingsRequest {
    cases: TestCase[];
    subtaskScoringStrategies: { [id: number]: ScoringStrategy };
    scoringStrategy: ScoringStrategy;
    showSubtask: boolean;
}

export interface EditContestRequest {
    settings: ContestSettings;
    hostID: number | null;
}

export interface CreatePostRequest {
    captcha: string;
    content: string;
    title: string;
    forum: string;
}

export interface BindRemoteJudgeAccountRequest {
    oj: string;
    username: string;
    password: string;
    captcha: string;
}

export interface ManageTeamMemberRequest {
    uid: number;
    realName: string;
    group: string;
    permission: number;
}

export interface EditThemeRequest {
    name: string;
    header: ThemeHeaderFooter;
    sideNav: ThemeSideNav;
    footer: ThemeHeaderFooter;
}

export interface ListImagesRequest {
    order?: string;
    bigImage?: boolean;
    page?: number;
}

export interface IDESubmitRequest {
    code: string;
    lang: number;
    input?: string;
    o2?: boolean;
    'csrf-token': string;
}

export interface EditArticleRequest {
    title: string;
    category: number;
    content: string;
    solutionFor: string | null;
    status: number;
    top: number;
}

export interface BatchEditArticleRequest {
    status: number;
    category: number;
    lids: string[];
}

export interface EditBlogRequest {
    title: string;
    content: string;
    identifier: string;
    type: string;
    top: number;
    status: number;
    'csrf-token': string;
}

export interface RegisterRequest {
    username: string;
    password: string;
    endpoint: string;
    endpointType: number;
    verificationCode: string;
}

export interface LoginRequest {
    username: string;
    password: string;
    captcha: string;
}

export interface DataResponse<T> {
    code: number;
    currentTemplate: string;
    currentData: T;
    currentTitle: string;
    currentTheme: Theme | null;
    currentTime: number;
    currentUser?: LegacyUser & Maybe<LegacySelf>;
}

export interface LentilleDataResponse<T> {
    instance: string;
    template: string;
    status: number;
    locale: string;
    data: T;
    user: (User & Maybe<Self & SelfStats>) | null;
    time: number;
    theme: Theme | null;
}

export interface UpdateTestCasesSettingsResponse {
    problem: LegacyProblemDetails;
    testCases: TestCase[];
    scoringStrategy: ScoringStrategy;
    subtaskScoringStrategies: ScoringStrategy[];
}

export interface GetScoreboardResponse {
    scoreboard: List<Score>;
    userScore: Score | null;
    userRank: number | null;
    firstBloodUID: { [pid: string]: number } | null;
}

export interface GenerateUploadParametersResponse {
    uploadLink: {
        host: string;
        policy: string;
        accessKeyID: string;
        callback: string;
        signature: string;
        expiredTime: number;
        dir: string;
    };
}

export interface LoginResponse {
    username: string;
    syncToken: string;
    locked: boolean;
    redirectTo: string;
}

export interface ConfigResponse {
    pageTree: PageTree;
    ws: { server: string };
    codeLanguages: {
        [id: number]: {
            name: string;
            family: string | null;
            disabled: boolean;
            canO2: boolean;
            fileExtensions: string[];
            aceMode: string;
            hljsMode: string;
            value: number;
            type: string;
            order: number;
        };
    };
    contestRuleTypes: {
        [id: number]: { id: number; name: string; color: string };
    };
    recordStatus: {
        [id: number]: {
            id: number;
            name: string;
            shortName: string;
            color: string;
            filterable: boolean;
        };
    };
    recordSortTypes: { id: number; name: string }[];
    messageStatusTypes: { id: number; name: string }[];
    translation: Translations;
    problemDifficulty: { id: number; name: string; color: string }[];
    senderEndpointTypes: { [id: number]: { id: number; type: string } };
    contestAccessLevel: { id: number; name: string }[];
    rankingSortTypes: { id: number; valueName: string; name: string }[];
    openIdPlatformTypes: { [id: number]: string };
    UserPermissionType: {
        [id: number]: {
            type: string;
            id: number;
            name: string;
            role: string | null;
        };
    };
    contestVisibilityTypes: {
        id: number;
        name: string;
        color: string;
        userCreatable: boolean;
        scope: 'disabled' | 'global' | 'team' | 'personal';
        invitation: boolean;
    }[];
    userRelationshipTypes: { id: number; type: string }[];
    scoringStrategyTypes: {
        [id: number]: { id: number; type: string; name: string };
    };
    problemTypes: {
        [id: string]: {
            id: string;
            type: string;
            name: string;
            vjudge: boolean;
            userCreatable: boolean;
            searchable: boolean;
            tds: string;
        };
    };
    messageModeTypes: { id: number; type: string; name: string }[];
    TeamJoinRequestStatusTypes: { id: number; type: string; name: string }[];
    problemFlagTypes: {
        [id: number]: { id: number; type: string; name: string };
    };
    contestInvitationCodeTypes: {
        [id: number]: { id: number; type: string; name: string };
    };
    trainingTypes: {
        [id: number]: {
            id: number;
            type: string;
            name: string;
            public: boolean;
            select: boolean;
            scope: 'hidden' | 'global' | 'team' | 'user';
            userCreatable: boolean;
            color: string;
        };
    };
    teamTypes: { [id: number]: { id: number; displayName: string | null } };
    notificationTypes: {
        [id: number]: { id: number; type: string; name: string };
    };
    imageHostingWatermarkTypes: { id: number; name: string }[];
    teamMemberTypes: {
        [id: number]: { id: number; type: string; name: string };
    };
    teamMemberPermissionTypes: {
        [id: number]: { id: number; type: string; name: string };
    };
    teamJoinPermissionTypes: { id: number; type: string; name: string }[];
    userPrizeShowLevelType: { id: number; type: string; name: string }[];
    ArticleCategory: {
        [id: number]: {
            type: string;
            id: number;
            name: string;
            color: string | null;
            locked: boolean;
            listing: boolean;
        };
    };
    ArticlePromoteStatus: {
        type: string;
        id: number;
        name: string;
        canSubmit: boolean;
    }[];
    ArticleStatus: { type: string; id: number; name: string }[];
    ContestInvitationType: {
        [id: number]: { type: string; id: number; name: string };
    };
    ContestMethod: {
        [id: number]: { type: string; id: number; name: string; color: string };
    };
    ContestVisibility: {
        type: string;
        id: number;
        name: string;
        color: string;
        scope: 'disabled' | 'global' | 'team' | 'user';
        userCreatable: boolean;
        invitation: boolean;
    }[];
    ImageHostingWatermarkStyle: { type: string; id: number }[];
    OpenIdPlatform: {
        [id: number]: { type: string; id: number; name: string };
    };
    ProblemDifficulty: {
        type: string;
        id: number;
        name: string;
        color: string;
    }[];
    ProblemFlag: { [id: number]: { type: string; id: number; name: string } };
    ProblemType: {
        [id: string]: { type: string; id: string; name: string; tds: string };
    };
    CodeLanguage: {
        [id: number]: {
            type: string;
            id: number;
            name: string;
            order: number;
            family: string | null;
            disabled: boolean;
            canO2: boolean;
            fileExt: string[];
            hljs: string;
        };
    };
    RecordStatus: {
        [id: number]: {
            type: string;
            id: number;
            name: string;
            shortName: string;
            color: string;
            filterable: boolean;
        };
    };
    SendEndpoint: { [id: number]: { type: string; id: number } };
    TeamJoinOpenness: { type: string; id: number; name: string }[];
    TeamJoinRequestStatus: { type: string; id: number; name: string }[];
    TeamMemberType: {
        [id: number]: { type: string; id: number; name: string };
    };
    TeamType: { [id: number]: { type: string; id: number; name: string } };
    TicketActionType: { [id: string]: { type: string; id: string } };
    TicketStatus: {
        [id: number]: { type: string; id: number; name: string; color: string };
    };
    TrainingType: {
        [id: number]: {
            type: string;
            id: number;
            name: string;
            public: boolean;
            color: string;
            scope: 'global' | 'team' | 'user' | 'hidden';
            select: boolean;
            userCreatable: boolean;
        };
    };
    UserMessageReceiveMode: { type: string; id: number; name: string }[];
    UserNotificationType: {
        [id: number]: { type: string; id: number; name: string };
    };
    UserOfflinePrizeShowLevel: { type: string; id: number; name: string }[];
    UserOpenSourceType: {
        [id: number]: { type: string; id: number; name: string };
    };
    UserRelationship: { [id: number]: { type: string; id: number } };
    VoteType: { [id: number]: { type: string; id: number } };
    route: { [id: string]: string };
    routeAttr: { [id: string]: { instance?: string; rawLink?: boolean } };
    _locale: string;
    _instance: string;
    routes: { [id: string]: string };
    _version_lentille: string;
    _version: number;
}

export interface TagsResponse {
    tags: { id: number; name: string; type: number; parent: number | null }[];
    types: { id: number; name: string; color: string }[];
    version: number;
}

export interface ProblemData {
    problem: ProblemDetails & Maybe<ProblemStatus>;
    translations: { [locale: string]: ProblemContents };
    bookmarked: boolean;
    contest: ContestSummary | null;
    vjudgeUsername: string | null;
    lastLanguage: number;
    lastCode: string;
    lastCodeAt: number | null;
    recommendations: (ProblemSummary & Maybe<ProblemStatus>)[];
    forum: Forum | null;
    discussions: PostSummary[] | null;
    locale: string;
    canEdit: boolean;
}

export interface SolutionsData {
    solutions: List<ArticleDetails>;
    problem: ProblemSummary & Maybe<ProblemStatus>;
    acceptSolution: boolean;
}

export interface ProblemSetListData {
    trainings: List<ProblemSet>;
    acceptedCounts: { [id: number]: number };
}

export interface ProblemSetData {
    training: ProblemSetDetails;
    trainingProblems: { result: [][]; perPage: null; count: number };
    canEdit: boolean;
    privilegedTeams: TeamSummary[];
}

export interface ContestData {
    contest: ContestDetails;
    contestProblems:
        | {
              score: number;
              problem: LegacyProblemSummary;
              submitted: boolean;
          }[]
        | null;
    isScoreboardFrozen: boolean;
    accessLevel: number;
    joined: boolean;
    userElo: (EloRatingSummary & { previous: EloRatingSummary | null }) | null;
}

export interface CreatedContestData {
    isContestAdmin: boolean;
    contest: ContestDetails & { joinCode: string };
    contestProblems: { score: number; problem: LegacyProblemSummary }[];
    contestSetting: ContestSettings;
    privilegedTeams: TeamSummary[];
}

export interface RecordData {
    record: RecordDetails;
    testCaseGroup: number[][] | { [group: number]: number[] };
    showStatus: boolean;
}

export interface PostListData {
    forum: Forum | null;
    publicForums: Forum[];
    posts: List<Post>;
    canPost: boolean;
}

export interface PostData {
    forum: Forum;
    post: PostDetails;
    replies: List<Reply>;
    canReply: boolean;
    canDelete: boolean;
}

export interface LuoguPrize {
    year: number;
    contest: string;
    event: string | null;
    prize: string;
    score?: number;
    rank?: number;
}

export interface UserData {
    prizes: { prize: LuoguPrize }[];
    gu: GuRating;
    elo: (EloRating & { previous: EloRating | null })[];
    dailyCounts: Record<string, [number, number]>;
    user: UserDetails & UserStats & Maybe<SelfDetails>;
}

export interface UserPracticeData {
    passed: ProblemSummary[];
    submitted: ProblemSummary[];
    elo: EloRating[];
    user: UserDetails & UserStats & Maybe<SelfDetails>;
}

export interface UserTeamsData {
    teams: {
        user: UserSummary & Maybe<SelfSummary>;
        type: number;
        team: TeamSummary;
        pinned: boolean;
    }[];
    user: UserDetails & UserStats & Maybe<SelfDetails>;
}

export interface UserAccountsData {
    qqGroupToken: string;
    vjudgeAccounts: { username: string; oj: string }[];
    openidAccounts: { username: string; platform: number }[];
}

export interface UserPreferencesData {
    openSourceJoinTime: number;
    setting: UserPreferences;
}

export interface UserPrizeSettingsData {
    prizeLevel: {
        oi: { level: number; show: boolean };
        xcpc: { level: number; show: boolean };
    };
    prizes: []; // TODO
    hasRealName: boolean;
}

export interface UserSecuritySettingsData {
    totpSet: boolean;
    realName: string | null;
    phone: string | null;
    email: string | null;
    usernameUpdateTime: number;
    adminLogs: []; // TODO
}

export interface TeamData {
    team: Team;
    currentTeamMember: TeamMember | null;
    latestDiscussions: LegacyPost[] | null;
    joinRequest: null; // TODO
    groups: Group[];
    usages: {
        problem: [number, number];
        training: [number, number];
        contest: [number, number];
        file: [number, number];
    };
}

export interface ChatListData {
    latestMessages: List<Message>;
    unreadMessageCount: { [user: number]: number } | [];
    currentChat: UserSummary | null;
}

export interface ImageListData {
    images: List<Image>;
    spaceLimit: number;
    spaceUsage: number;
}

export interface ArticleListData {
    articles: List<Article>;
    featuredCollections: ArticleCollectionSummary[];
    category: number | null;
}

export interface CreatedArticleListData {
    articles: List<Article>;
    stat: { promoted: number; public: number; hidden: number };
}

export interface ArticleData {
    article: ArticleDetails;
    favored: boolean;
    voted: number | null;
    canReply: boolean;
    canEdit: boolean;
}

export interface ArticleCollectionData {
    articles: List<Article>;
    featuredCollections: ArticleCollectionSummary[];
    collection: ArticleCollection;
}

export interface NotificationsData {
    notifications: List<Notification>;
    hasUnreadNotification: { [type: number]: true } | [];
}

export interface ActivityData {
    uid: number;
    time: { date: string; timezone_type: number; timezone: string };
    type: number;
    comment: string;
}

export interface BaseServerboundMessage {
    channel: string;
    channel_param: string;
    type: string;
}

export interface ServerboundJoinChannelMessage extends BaseServerboundMessage {
    type: 'join_channel';
    exclusive_key?: string;
}

export interface ServerboundDisconnectChannelMessage extends BaseServerboundMessage {
    type: 'disconnect_channel';
}

export interface ServerboundDataMessage<T> extends BaseServerboundMessage {
    type: 'data';
    data: T;
}

export interface BaseClientboundMessage {
    _channel: string;
    _channel_param: string;
    _ws_type: string;
}

export interface ClientboundJoinResultMessage<T> extends BaseClientboundMessage {
    _ws_type: 'join_result';
    client_number: number;
    result: 'success';
    type: 'result';
    welcome_message: T;
}

export interface ClientboundHeartbeatMessage extends BaseClientboundMessage {
    _ws_type: 'heartbeat';
    client_number: number;
    type: 'heartbeat';
}

export interface ClientboundExclusiveKickoffMessage extends BaseClientboundMessage {
    _ws_type: 'exclusive_kickoff';
}

export interface ClientboundServerBroadcastMessage extends BaseClientboundMessage {
    _ws_type: 'server_broadcast';
}

export interface ClientboundInitialRecordStatusMessageData {
    detail: RecordStatus;
    memory: `${number}` | null;
    record: {
        detail: RecordStatus;
        enableO2: boolean;
        id: number;
        memory: `${number}`;
        score?: `${number}`;
        status: number;
        time: `${number}`;
    };
    score: `${number}` | null;
    status: number;
    time: `${number}` | null;
    type: 'status_push';
}

export interface ClientboundUpdateRecordStatusMessageData {
    record: {
        detail: RecordStatus;
        enableO2: boolean;
        id: number;
        memory: number;
        score: number;
        status: number;
        time: number;
    };
    type: 'status_push';
}

export interface ClientboundFlushRecordStatusMessageData {
    type: 'flush';
}

export type ClientboundRecordStatusMessageData =
    | ClientboundUpdateRecordStatusMessageData
    | ClientboundFlushRecordStatusMessageData;

export interface ClientboundChatMessageData {
    message: {
        content: string;
        id: number;
        receiver: UserSummary;
        sender: UserSummary;
        status: number;
        time: number;
    };
}

export interface ProblemSummary {
    pid: string;
    type: string;
    title: string;
    difficulty: number | null;
}

export interface Problem extends ProblemSummary {
    tags: number[];
    wantsTranslation: boolean;
    totalSubmit: number;
    totalAccepted: number;
    flag: number;
}

export interface ProblemDetails extends Problem {
    provider: (UserSummary & Maybe<SelfSummary>) | TeamSummary;
    content: ProblemContents;
    attachments: ProblemAttachment[];
    acceptSolution: boolean;
    acceptLanguages: number[];
    samples: [input: string, output: string][];
    limits: { time: number[]; memory: number[] };
    showScore?: boolean;
    score?: number | null;
    bestRecord: {
        id: number;
        status: number;
        enableO2: boolean;
        score?: number;
    } | null;
    vjudge?: { id: string; link: string };
    translation: string;
}

export interface ProblemContents {
    name: string;
    background: string | null;
    description: string;
    formatI: string | null;
    formatO: string | null;
    hint: string | null;
    locale: string;
}

export interface ProblemAttachment {
    id: string;
    filename: string;
    size: number;
    uploadTime: number;
    downloadLink: string;
}

export interface ProblemSettings {
    title: string;
    background: string;
    description: string;
    inputFormat: string;
    outputFormat: string;
    samples: [input: string, output: string][];
    hint: string;
    translation: string;
    needsTranslation: boolean;
    acceptSolution: boolean;
    allowDataDownload: boolean;
    difficulty: number;
    showScore: boolean;
    flag: number;
    tags: number[];
}

export interface ProblemStatus {
    submitted: boolean;
    accepted: boolean;
}

export interface TestCase {
    upid: number;
    inputFileName: string;
    outputFileName: string;
    timeLimit: number;
    memoryLimit: number;
    fullScore: number;
    isPretest: boolean;
    subtaskId: number;
}

export interface ScoringStrategy {
    type: number;
    script?: string;
}

export interface ProblemSet {
    createTime: number;
    deadline: number | null;
    problemCount: number;
    marked: boolean;
    markCount: number;
    id: number;
    title: string;
    type: number;
    provider: UserSummary | TeamSummary;
}

export interface ProblemSetDetails extends ProblemSet {
    description: string;
    problems: { problem: LegacyProblem }[];
    userScore: {
        user: UserSummary;
        totalScore: number;
        score: { [pid: string]: number | null };
        status: { [pid: string]: boolean };
    } | null;
}

export interface ProblemSetSettings {
    title: string;
    description: string;
    type: number;
    deadline: number | null;
}

export interface ContestSummary {
    id: number;
    name: string;
    startTime: number;
    endTime: number;
}

export interface Contest extends ContestSummary {
    ruleType: number;
    visibilityType: number;
    invitationCodeType: number;
    rated: boolean;
    eloThreshold: number | null;
    host: UserSummary | TeamSummary;
    problemCount: number;
}

export interface ContestDetails extends Contest {
    description: string;
    totalParticipants: number;
    eloDone: boolean;
    canEdit: boolean;
}

export interface ContestSettings {
    name: string;
    description: string;
    visibilityType: number;
    invitationCodeType: number;
    ruleType: number;
    startTime: number;
    endTime: number;
    rated: boolean;
    ratingGroup: string | null;
    eloThreshold: number | null;
    eloCenter: number | null;
}

export interface Score {
    details: { [pid: string]: { score: number; runningTime?: number } } | [];
    user: UserSummary;
    score: number;
    runningTime: number;
}

export interface RecordBase {
    time: number | null;
    memory: number | null;
    problem: LegacyProblemSummary;
    contest: ContestSummary | null;
    sourceCodeLength: number;
    submitTime: number;
    language: number;
    user?: UserSummary;
    id: number;
    status: number;
    enableO2: boolean;
    score?: number | null;
}

export interface RecordDetails extends RecordBase {
    detail: RecordStatus;
    sourceCode?: string | null;
}

export interface RecordStatus {
    compileResult: {
        success: boolean;
        message: string | null;
        opt2: boolean;
    } | null;
    judgeResult: {
        subtasks: SubtaskStatus[] | { [group: number]: SubtaskStatus };
        finishedCaseCount: number;
        status: 0;
        time: 0;
        memory: 0;
        score: 0;
    } | null;
    version: number;
}

export interface SubtaskStatus {
    id: number;
    score: number;
    status: number;
    testCases: TestCaseStatus[] | { [id: number]: TestCaseStatus };
    judger: '' | null;
    time: number;
    memory: number;
}

export interface TestCaseStatus {
    id: number;
    status: number;
    time: number;
    memory: number;
    score: number;
    signal: number | null;
    exitCode: number;
    description: string | 0;
    subtaskID: number;
}

export interface PostSummary {
    id: number;
    title: string;
    author: UserSummary;
    time: number;
}

export interface Post extends PostSummary {
    forum: Forum;
    topped: boolean;
    valid: boolean;
    locked: boolean;
    replyCount: number;
    recentReply: ReplySummary | false;
}

export interface PostDetails extends Post {
    content: string;
    pinnedReply: Reply | null;
}

export interface ReplySummary {
    id: number;
    author: UserSummary;
    time: number;
}

export interface Reply extends ReplySummary {
    content: string;
}

export interface Forum {
    name: string;
    type: number;
    slug: string;
    color: string;
    problem?: ProblemSummary & Maybe<ProblemStatus>;
}

export interface Activity {
    content: string;
    id: number;
    type: number;
    time: number;
    user: UserSummary;
}

export interface SelfSummary {
    verified: boolean;
}

// export interface Self extends SelfSummary {}

export interface SelfDetails extends Self {
    organization: null; // TODO
    email: string | null;
    phone: string | null;
    realName: string | null;
}

export interface SelfStats {
    unreadMessageCount: number;
    unreadNoticeCount: number;
    learnMode: boolean;
}

export type UserColor = 'Cheater' | 'Gray' | 'Blue' | 'Green' | 'Orange' | 'Red' | 'Purple';

export interface UserSummary {
    uid: number;
    name: string;
    avatar: string;
    slogan: string | null;
    badge?: string | null;
    isAdmin: boolean;
    isBanned: boolean;
    color: UserColor;
    ccfLevel: number;
    xcpcLevel: number;
    background: string | null;
    isRoot?: true;
}

export interface User extends UserSummary {
    followingCount: number;
    followerCount: number;
    ranking: number | null;
    eloValue: number | null;
}

export interface UserDetails extends User {
    rating: null;
    registerTime: number;
    introduction: string | null;
    prize: { year: number; contestName: string; prize: string }[];
    elo: EloRatingSummary | null;
}

export type UserStats = Maybe<UserRelationship> & UserPractice;

export interface UserRelationship {
    userRelationship: number;
    reverseUserRelationship: number;
}

export interface UserPractice {
    passedProblemCount: number | null;
    submittedProblemCount: number | null;
}

export interface UserPreferences {
    codeFont: string | null;
    colorScheme: null;
    openSource: number;
    codeSharingWithAi: boolean;
    learningMode: boolean;
    messageMode: number;
    acceptPromotion: boolean;
}

export interface TeamSummary {
    id: number;
    name: string;
    isPremium: boolean;
}

export interface Team extends TeamSummary {
    createTime: number;
    master: UserSummary;
    setting: { description: string; notice?: string; joinPermission: number };
    premiumUntil?: number;
    type: number;
    memberCount: number;
}

export interface TeamMember {
    group: Group;
    user: UserSummary;
    type: number;
    permission: number;
    realName: string;
}

export interface Group {
    id: number;
    name: string;
    no: number;
}

export interface Message {
    id: number;
    sender: UserSummary;
    receiver: UserSummary;
    time: number;
    status: number;
    content: string;
}

export interface Notification {
    id: number;
    time: number;
    type: number;
    title: string;
    content: string;
    read: boolean;
}

export interface Theme {
    id: number;
    header: ThemeHeaderFooter;
    sideNav: ThemeSideNav;
    footer: ThemeHeaderFooter;
}

export interface ThemeDetails extends Theme {
    name: string;
    type: number;
    author: UserSummary;
    updateTime: number;
    userCount: number;
}

export interface ThemeHeaderFooter {
    imagePath: string | null;
    color: [number, number, number, number][];
    blur: number;
    brightness: number;
    degree: number;
    repeat: number;
    position: [number, number];
    size: [number, number];
    type: number;
}

export interface ThemeSideNav {
    logoBackgroundColor: [number, number, number, number];
    color: [number, number, number, number];
    invertColor: boolean;
}

export interface Image {
    thumbnailUrl: string;
    url: string;
    id: string;
    provider: UserSummary;
    uploadTime: number;
    size: number;
}

export interface Paste {
    data: string;
    id: string;
    user: UserSummary;
    time: number;
    public: boolean;
}

export interface GuRating {
    rating: number;
    time: number;
    scores: {
        rating: number;
        social: number;
        basic: number;
        contest: number;
        practice: number;
        prize: number;
    };
}

export interface GuRatingDetails extends GuRating {
    user: UserSummary;
}

export interface EloRatingSummary {
    rating: number;
    time: number;
    latest: boolean;
    contest?: ContestSummary;
}

export interface EloRating extends EloRatingSummary {
    userCount: number;
    prevDiff: number | null;
}

export interface EloRatingDetails extends EloRating {
    user: UserSummary;
}

export interface Article {
    lid: string;
    title: string;
    time: number;
    author: UserSummary & Maybe<SelfSummary>;
    upvote: number;
    replyCount: number;
    favorCount: number;
    category: number;
    status: number;
    solutionFor: (ProblemSummary & Maybe<ProblemStatus>) | null;
    promoteStatus: number;
    collection: ArticleCollectionSummary | null;
    content: string;
    top: number;
    promoteResult?: {
        updateAt: number | null;
        rejectReason?: string | null;
    };
    categoryOld?: string;
}

export interface ArticleDetails extends Article {
    contentFull: boolean;
    adminNote: string | null;
    voted?: number | null;
    canReply?: boolean;
    canEdit?: boolean;
}

export interface ArticleCollectionSummary {
    id: number;
    name: string;
}

export interface ArticleCollection extends ArticleCollectionSummary {
    opening: boolean;
    featured: number;
    categoryLimitation: null;
}

export interface BlogSummary {
    lid: string;
    id: number;
    identifier: string;
    title: string;
}

export interface Blog extends BlogSummary {
    type: string;
    status: number;
    postTime: number;
    author: UserSummary;
    thumbUp: number;
    commentCount: number;
    currentUserVoteType: number;
    contentDescription: string;
}

export interface Comment {
    id: number;
    author: UserSummary & Maybe<SelfSummary>;
    time: number;
    content: string;
}

export interface PageTree {
    name: string;
    template: string;
    route: string;
    children?: PageTree[];
    url?: string | null;
}

export interface Translations {
    [id: string]: string | Translations;
}

export interface Advertisement {
    image: Image;
    imageUrl: string;
    url: string;
    id: number;
}

export type Maybe<T> = T | { [K in keyof T]?: never };

export interface List<T> {
    result: T[] | { [index: number]: T };
    count: number;
    perPage: number | null;
}

/** @deprecated */
export interface LegacyProblemSummary extends ProblemSummary {
    fullScore: number;
}

/** @deprecated */
export interface LegacyProblem extends LegacyProblemSummary {
    tags: number[];
    wantsTranslation: boolean;
    totalSubmit: number;
    totalAccepted: number;
    flag: number;
}

/** @deprecated */
export interface LegacyProblemDetails extends LegacyProblem {
    background: string;
    description: string;
    inputFormat: string;
    outputFormat: string;
    samples: [input: string, output: string][];
    hint: string;
    provider: UserSummary | TeamSummary;
    attachments: ProblemAttachment[];
    canEdit: boolean;
    limits: { time: number[]; memory: number[] };
    stdCode: string;
    translation?: string;
}

/** @deprecated */
export interface LegacyPostSummary {
    id: number;
    title: string;
    forum: LegacyForum;
}

/** @deprecated */
export interface LegacyPost extends LegacyPostSummary {
    top: number;
    author: UserSummary;
    time: number;
    valid: boolean;
    replyCount: number;
    recentReply: ReplySummary | null;
}

/** @deprecated */
export interface LegacyForum {
    id: number;
    name: string;
    slug: string;
}

/** @deprecated */
export interface LegacyUser extends User {
    blogAddress: string | null;
}

/** @deprecated */
export interface LegacySelf extends Self {
    unreadMessageCount: number;
    unreadNoticeCount: number;
}

/** @deprecated */
export interface LegacyBlog {
    BlogID: number;
    Identifier: string;
    Title: string;
    Type: string;
    PostTime: number;
    // deno-lint-ignore ban-types
    Author: object;
    Status: number;
    ContentDescription: string;
    ThumbUp: number;
    Content: string;
}
