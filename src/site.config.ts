export const siteConfig = {
  name: "Wybell空间",
  displayName: "Wybell",
  role: "Java 后端开发者",
  title: "Wybell空间 | 记录生活、工作与学习",
  description: "记录项目、学习、工作与生活，把做过的事写下来，把还没想明白的问题留在路上。",
  url: "https://your-domain.example",
  establishedDate: "2026-08-13",
  location: "广州",
  email: "2458262576@qq.com",
  github: "https://github.com/Wybell",
  nav: [
    { label: "首页", href: "/" },
    { label: "技术空间", href: "/technical/" },
    { label: "生活空间", href: "/life/" },
    { label: "随想录", href: "/thoughts/" },
    { label: "关于我", href: "/about/" },
  ],
  stats: {
    articles: "19",
    repositories: "待补",
  },
} as const;

export const contactChannels = {
  github: { label: "GitHub", value: siteConfig.github },
  wechat: { label: "微信", value: "二维码", image: "/contact-wechat.jpg" },
  email: { label: "QQ邮箱", value: siteConfig.email },
  qq: { label: "QQ", value: "二维码", image: "/contact-qq.jpg" },
  douyin: { label: "抖音", value: "359543856" },
  xiaohongshu: { label: "小红书", value: "94183560222" },
} as const;

export const sectionNavigation = {
  technical: [
    { label: "技术总览", href: "/technical/" },
    { label: "项目实践", href: "/technical/projects/" },
    { label: "技术学习", href: "/technical/learning/" },
    { label: "技术栈", href: "/technical/stack/" },
    { label: "工程实践", href: "/technical/practice/" },
    { label: "工作经历", href: "/technical/experience/" },
  ],
  life: [
    { label: "生活总览", href: "/life/" },
    { label: "日常记录", href: "/life/daily/" },
    { label: "旅行见闻", href: "/life/travel/" },
    { label: "兴趣爱好", href: "/life/hobbies/" },
    { label: "影像片段", href: "/life/media/" },
    { label: "阅读观影", href: "/life/reading/" },
  ],
  thoughts: [
    { label: "随想总览", href: "/thoughts/" },
    { label: "学习思考", href: "/thoughts/learning/" },
    { label: "工作感受", href: "/thoughts/work/" },
    { label: "生活感受", href: "/thoughts/life/" },
    { label: "随笔灵思", href: "/thoughts/retrospective/" },
  ],
  about: [
    { label: "关于我", href: "/about/" },
    { label: "经历轨迹", href: "/about/experience/" },
    { label: "目前状态", href: "/about/status/" },
    { label: "联系方式", href: "/about/contact/" },
    { label: "关于本站", href: "/about/site/" },
  ],
} as const;

export const sectionPageContent = {
  technical: {
    eyebrow: "TECHNICAL SPACE",
    title: "技术空间",
    description: "把项目、学习和工作里真正做过的事放在一起，记录从想法到交付之间的过程。",
  },
  life: {
    eyebrow: "LIFE SPACE",
    title: "生活空间",
    description: "不只记录完成了什么，也留一点位置给日常、兴趣和那些正在发生的小事。",
  },
  thoughts: {
    eyebrow: "THOUGHTS",
    title: "随想录",
    description: "有些内容还没有结论，但它们值得先被写下来，留在之后回头看的路上。",
  },
  about: {
    eyebrow: "ABOUT WYBELL",
    title: "关于我",
    description: "把做过的事情讲清楚，把仍在学习的问题留下来，慢慢成为一个可靠的 Java 后端开发者。",
  },
} as const;

export const projects = [
  {
    slug: "student-system",
    name: "教务系统",
    category: "第一个项目 · 基础起点",
    description: "以 Java 17 和 Spring Boot 4.0.3 为基础，使用 Spring MVC、MyBatis XML、MySQL、Redis 和 Spring Security 完成学生信息管理学习项目。",
    summary: "这是我理解后端分层和一次请求如何走到数据库的起点：后端 CRUD 接口已经跑通，静态前端完成列表、刷新和删除，编辑交互仍保留为明确的后续边界。",
    stack: ["Java 17", "Spring Boot 4.0.3", "Spring MVC", "MyBatis 4.0.1", "MySQL", "Redis", "Spring Security", "Vue 3", "Element Plus", "Axios", "Maven", "Druid", "Lombok"],
    role: "独立开发",
    status: "学习项目",
    github: "",
    live: "",
    accent: "sage",
    highlights: [
      "建立 Controller、Service、Mapper 和 Entity 的基础分层，使用 MyBatis XML 访问 MySQL",
      "围绕 students:all 和 student:{id} 实现列表/详情缓存及写操作后的缓存失效",
      "通过数据库用户、BCrypt 和 Spring Security 完成基础表单认证，并保留参数校验、异常处理和业务测试等后续边界",
    ],
  },
  {
    slug: "ai-interview-assistant",
    name: "AI 面试助手",
    category: "完整产品 · 业务闭环",
    description: "围绕简历处理、AI 出题、模拟面试和复盘反馈构建的求职应用，是我从功能开发走向完整产品的一次升级。",
    summary: "从简历上传到模拟面试与总结报告，把多个 AI 能力组织成一条面向求职者的完整业务链路。",
    stack: ["Vue 3", "TypeScript", "Spring Boot", "MySQL", "Redis", "SSE"],
    role: "独立开发",
    status: "已部署",
    github: "https://github.com/Wybell/ai-interview-assistant",
    live: "http://81.71.140.104/",
    accent: "moss",
    highlights: [
      "支持知识库出题、自定义知识点、模拟面试和复盘反馈",
      "接入多模型调用与 SSE 流式输出，并记录用户近期出题历史",
      "完成 JWT、Flyway、Docker、Nginx 和云服务器部署实践",
    ],
  },
  {
    slug: "eventflow",
    name: "EventFlow",
    category: "业务可靠性 · 工程交付",
    description: "活动报名与场次配额管理平台，围绕审核、权限、名额、重复报名、并发一致性和线上交付建立完整业务闭环。",
    summary: "这是我把后端工程能力落到真实业务约束上的项目：让名额、报名记录、状态流转和发布链路在异常场景下仍然可解释、可验证。",
    stack: ["React 19", "TypeScript", "Spring Boot 3", "Java 17", "MySQL 8", "Flyway", "Docker Compose", "Nginx"],
    role: "独立开发",
    status: "已部署",
    github: "https://github.com/Wybell/eventflow",
    live: "http://81.71.140.104:8084/",
    accent: "fern",
    highlights: [
      "完成活动创建、场次配置、审核、驳回、发布、报名、取消和多角色权限闭环",
      "使用 MySQL 条件更新原子扣减场次名额，联合唯一约束防止同一活动重复报名",
      "使用 @Transactional、Flyway、Docker Compose 和 GitHub Actions 手动 CD 完成工程交付",
    ],
  },
] as const;

export const skills = [
  "Java 17 / Spring Boot / Spring MVC / MyBatis",
  "MySQL 8 / InnoDB / Flyway / 事务一致性",
  "Redis / Spring Security / JWT / JJWT / 权限",
  "Vue 3 / React 19 / TypeScript / Vite",
  "AI 多模型调用 / Prompt / SSE 实时通信",
  "Docker / Nginx / GitHub Actions / CI/CD",
  "JUnit / Mockito / Vitest / Git / RequestId",
];

export const homeSkillGroups = [
  {
    label: "后端",
    items: ["Java 17", "Spring Boot", "Spring MVC", "MyBatis / MyBatis-Plus"],
  },
  {
    label: "数据与安全",
    items: ["MySQL", "Redis", "Flyway", "Spring Security", "JWT"],
  },
  {
    label: "前端",
    items: ["Vue 3", "React", "TypeScript", "Vite", "Element Plus", "Ant Design"],
  },
  {
    label: "工程交付",
    items: ["Docker", "Docker Compose", "Nginx", "GitHub Actions", "CI/CD"],
  },
] as const;

export const skillGroups = [
  {
    label: "核心后端技术",
    items: [
      "Java 17",
      "Spring Boot 4.0.3（教务系统）",
      "Spring Boot 3.x（EventFlow）",
      "Spring MVC",
      "MyBatis",
      "MyBatis-Plus",
      "Maven / Maven Wrapper",
      "RESTful API",
      "JSON 数据处理",
      "Controller / Service / Mapper / Entity",
    ],
  },
  {
    label: "数据库与数据一致性",
    items: [
      "MySQL",
      "MySQL 8",
      "InnoDB",
      "SQL 编写与优化基础",
      "数据库表设计",
      "联合唯一约束",
      "条件更新",
      "@Transactional",
      "数据库状态字段与状态机",
      "Flyway 数据库迁移",
      "条件更新防止名额超卖",
      "UNIQUE(activity_id, user_id) 防止重复报名",
      "事务保证名额扣减和报名记录一致",
      "活动、场次、报名记录的业务建模",
    ],
  },
  {
    label: "缓存、认证与权限",
    items: [
      "Redis",
      "Redis Cache Aside 缓存模式",
      "列表缓存和详情缓存",
      "缓存失效",
      "Spring Security",
      "JWT / JJWT",
      "BCrypt 密码加密",
      "登录认证",
      "角色权限",
      "用户资源归属校验",
      "Refresh Token 轮换",
      "EventFlow：Redis 为基础设施准备，未参与报名扣减主链路",
    ],
  },
  {
    label: "前端技术",
    items: [
      "教务系统：Vue 3 / Element Plus / Axios",
      "HTML / CSS / JavaScript",
      "AI 面试助手：Vue 3 / TypeScript / Axios",
      "SSE 流式输出",
      "EventFlow：React 19 / TypeScript / Vite",
      "Ant Design",
      "TanStack React Query",
      "Zustand",
    ],
  },
  {
    label: "AI 与实时通信",
    items: [
      "AI 多模型调用",
      "AI 模型路由",
      "Prompt 组织",
      "简历内容处理",
      "AI 面试题生成",
      "AI 答案评分",
      "面试复盘报告生成",
      "SSE 流式响应",
      "外部 AI 服务异常处理",
      "AI 结果结构化处理",
    ],
  },
  {
    label: "部署与工程交付",
    items: [
      "Docker",
      "Docker Compose",
      "Nginx",
      "腾讯云 CVM",
      "Linux 服务器部署",
      "SSH",
      "前后端分离部署",
      "Nginx 反向代理",
      "GitHub Actions",
      "CI/CD",
      "自动 CI",
      "手动生产发布",
      "健康检查",
      "Flyway 自动迁移",
    ],
  },
  {
    label: "测试与工程工具",
    items: [
      "JUnit / Spring Boot 测试",
      "Mockito 业务测试",
      "Vitest 前端测试",
      "Maven Test",
      "Git",
      "GitHub",
      "pnpm / npm",
      "IntelliJ IDEA",
      "Docker 日志排查",
      "RequestId 请求追踪",
    ],
  },
] as const;

export const experiences = [
  {
    period: "2026.05 - 2026.07",
    title: "Java 全栈实习生",
    organization: "广州平云信息技术有限公司",
    summary: "参与企业级组织管理平台开发，完成需求、缺陷、联调、测试和上线的完整工作流。",
    details: [
      "累计完成 73 个经过测试并上线的工单，其中包括 41 个需求和 32 个缺陷",
      "参与审批、待办、组织权限、费用导入、文件下载和前后端联调等工作",
      "处理分页、批量导入校验、JSON 解析和数据权限等问题",
    ],
  },
] as const;
