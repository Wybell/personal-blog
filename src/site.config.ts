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
  github: "",
  analytics: {
    provider: "busuanzi",
  },
  nav: [
    { label: "首页", href: "/" },
    { label: "技术空间", href: "/technical/" },
    { label: "生活空间", href: "/life/" },
    { label: "随想录", href: "/thoughts/" },
    { label: "关于我", href: "/about/" },
  ],
  stats: {
    articles: "04",
    repositories: "待补",
  },
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

export const projects = [
  {
    slug: "student-system",
    name: "教务系统",
    category: "第一个项目 · 基础起点",
    description: "从一个教务信息管理需求开始，第一次把 Spring Boot、MyBatis、MySQL、Redis 和 Spring Security 连成完整链路。",
    summary: "这是我理解后端分层和 Web 应用基本结构的起点。功能并不复杂，但它让我第一次真正走完从接口到数据库的过程。",
    stack: ["Spring Boot", "MyBatis", "MySQL", "Redis", "Spring Security"],
    role: "独立开发",
    status: "学习项目",
    github: "",
    live: "",
    accent: "sage",
    highlights: [
      "建立 Controller、Service、Mapper 和 Entity 的基础分层",
      "使用 MyBatis 访问 MySQL，并尝试接入 Redis 缓存",
      "通过 Spring Security 初步实现登录认证流程",
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
    github: "",
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
    description: "活动报名与配额管理平台，开始面对审核、权限、名额、重复报名和并发一致性等真实业务问题。",
    summary: "这是我进一步补强后端工程能力的项目：不只让功能跑通，还要让名额、报名记录和状态流转保持正确。",
    stack: ["React", "TypeScript", "Spring Boot", "MySQL", "Flyway", "Docker"],
    role: "独立开发",
    status: "已部署",
    github: "https://github.com/Wybell/eventflow",
    live: "http://81.71.140.104:8084/",
    accent: "fern",
    highlights: [
      "完成活动创建、审核、发布、报名、取消和多角色权限闭环",
      "使用 MySQL 条件更新原子扣减名额，唯一约束防止重复报名",
      "使用 @Transactional 保证名额扣减与报名记录的一致性",
    ],
  },
] as const;

export const skills = [
  "Java / Spring Boot",
  "MySQL / Redis",
  "JWT / 事务 / 权限",
  "Vue / React / TypeScript",
  "Docker / Nginx",
  "GitHub Actions / CI/CD",
];

export const skillGroups = [
  {
    label: "后端与框架",
    items: ["Java", "Spring Boot", "MyBatis", "Spring Security"],
  },
  {
    label: "数据与基础设施",
    items: ["MySQL", "Redis", "Flyway", "JWT"],
  },
  {
    label: "前端与交互",
    items: ["Vue 3", "React", "TypeScript", "SSE"],
  },
  {
    label: "工程与交付",
    items: ["Docker", "Nginx", "GitHub Actions", "CI/CD"],
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
