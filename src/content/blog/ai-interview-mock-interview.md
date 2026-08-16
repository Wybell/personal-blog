---
title: "从面试题生成到模拟面试复盘：AI 应用的业务闭环如何落地"
description: "结合 AI 面试助手的 InterviewService、知识检索、简历生命周期、模拟面试状态机、SSE 评分和复盘服务，拆解一条可恢复的业务闭环。"
pubDate: 2026-08-16
updatedDate: 2026-08-16
section: practice
projectSlug: ai-interview-assistant
cover: /cover-practice-mock-interview.png
coverAlt: "AI 面试业务闭环封面"
tags:
  - AI 应用
  - 业务建模
  - 模拟面试
  - SSE
  - MySQL
  - Flyway
  - Spring Boot
featured: false
---

如果只展示“输入知识点，返回一道题”，AI 面试助手看起来像一个模型调用 Demo。但用户真正使用时，会上传简历、选择方向和语言、生成问题、提交回答、接收评分、继续追问、提前离开，最后还希望看到一份可以复盘的总结。每一步都可能失败，且下一步必须知道上一步留下了什么事实。

这篇文章记录当前 AI 面试助手如何把这些功能组织成业务闭环。重点不是宣传功能数量，而是解释 `InterviewService`、`KnowledgeRetrievalService`、`MockInterviewService` 和 `MockInterviewReviewService` 如何分别承担责任，以及为什么简历删除、AI 失败、SSE 中断和数据库迁移都必须被当成业务设计的一部分。

## 一、先区分三种出题模式

当前 `InterviewService` 支持三类来源：

| 模式 | 输入 | 额外校验 | 上下文来源 |
| --- | --- | --- | --- |
| 自定义知识点 | direction、language、tag | tag 非空且不超过 50 个字符 | 用户输入 + Prompt |
| 技术专题 | direction、language、tag | `TechnicalTopicService` 判断组合是否支持 | 受支持的技术知识点 |
| 知识库专题 | knowledgeTopicId | 专题属于方向/语言且 published=1 | `KnowledgeRetrievalService` |

`QuestionMode` 进入 Service 后先验证方向和语言，再验证知识来源。知识库模式不能缺少 topicId；自定义模式不能携带 topicId；技术专题还要验证方向、语言和 tag 的组合是否被系统支持。这样可以避免 Controller 只做字段非空校验，导致错误请求一直走到 AI 服务。

## 二、知识库上下文要有限度

`KnowledgeRetrievalService` 按 `topicId + direction + language + published=1` 查询已发布专题。优先使用 `documentContent`，没有时退回 `summary`，两者都为空则返回业务错误，最终把上下文截断到 8,000 个字符：

```java
KnowledgeTopic topic = mapper.selectOne(new LambdaQueryWrapper<KnowledgeTopic>()
        .eq(KnowledgeTopic::getId, topicId)
        .eq(KnowledgeTopic::getDirection, direction)
        .eq(KnowledgeTopic::getLanguage, language)
        .eq(KnowledgeTopic::getPublished, 1));

String content = StringUtils.hasText(topic.getDocumentContent())
        ? topic.getDocumentContent()
        : topic.getSummary();

return new KnowledgeContext(
        topic.getId(), topic.getTitle(), content.trim().substring(0, Math.min(content.length(), 8000)));
```

这不是向量数据库，也不是复杂 RAG。它是已发布专题的定向检索和长度控制。上下文越长不代表题目越好，超过模型预算还会增加成本、延迟和提示词冲突。

## 三、题目缓存必须包含业务维度

`InterviewService` 的题目 key 包含用户、实际模型、出题模式、方向、语言和 tag/topic：

```text
question:{userId}:model:{modelId}:{mode}:{direction}:{language}:{tag-or-topic}
```

缓存未命中时：

1. 知识库模式读取当前用户该专题的历史题目。
2. 调用 AI 生成题目，并最多尝试两次避免与历史题目完全重复。
3. 记录知识库出题历史。
4. 以一小时 TTL 写入 Redis。

缓存命中时，知识库模式仍然记录本次题目使用历史。模型 id 进入 key 是必要的：用户切换模型后不能因为 key 相同而得到旧模型的题目。这里的 Redis 是可丢失的加速层，MySQL 中的答题记录和知识库历史才是可追踪事实。

## 四、简历上传是一个文件生命周期问题

简历并不只是一个 MultipartFile。`ResumeServiceImpl` 当前执行的顺序是：

```text
登录校验
  -> 文件非空
  -> 大小 <= 10 MB
  -> 后缀 PDF / DOCX / TXT
  -> 提取可读文本
  -> 保存到私有目录
  -> 写入 resume_document
```

文件原名经过 `Path.of(...).getFileName()` 处理，避免把用户提供的路径当作服务器路径；文件本体保存到配置目录，数据库保存原文件名、类型、存储路径和提取文本。若数据库插入失败，代码会尝试删除已经落盘的文件，避免产生孤儿文件。

资源归属查询始终带 `userId`。删除简历时，若仍有 `ACTIVE` 模拟面试引用它，返回 409，不允许删除。对于已经结束的面试，V11 将 `resume_id` 改为可空并保存 `resume_file_name_snapshot`，删除简历不会抹掉历史面试的可读性。数据库记录删除和文件删除还存在文件系统边界：`@Transactional` 能回滚数据库事务，不能回滚已经删除的物理文件，因此文件清理失败只能记录并通过运维重试。

## 五、模拟面试是状态机，不是几个按钮

`MockInterviewService` 用 `ACTIVE`、`COMPLETED`、`ENDED_EARLY` 表达 session 生命周期：

```text
创建 session -> ACTIVE
    |
    +-- 完成 questionLimit 个主问题并生成总结 -> COMPLETED
    |
    +-- 用户提前离开 -> ENDED_EARLY
```

不同轮次有不同主问题上限：第一轮 8 题、第二轮 12 题、第三轮 10 题、HR 轮 4 题。创建 session 时保存目标职位、目标公司、面试轮次、简历文件名快照和当时生效的 AI 模型 id。

### 主问题和追问的约束

主问题写入递增的 `sequence_no`。回答前要确认它是当前最新问题、尚未回答；否则返回 409，防止跳过当前问题。追问只能针对主问题，不能追问追问，并且同一主问题最多两次。V10 增加 `turn_type`、`parent_turn_id` 和 `follow_up_no`，使追问上下文可以从表结构中恢复，而不是只依赖前端数组。

```java
if (!"MAIN".equals(parentTurn.getTurnType())) {
    throw new BusinessException(409, "追问只能针对主问题");
}
if (followUpCount >= 2) {
    throw new BusinessException(409, "当前问题最多追问两次");
}
```

生成追问时，AI 会收到主问题、当前回答、评分、建议和已经生成的追问标题；这比把整个前端页面状态直接拼到 Prompt 更可控。

## 六、评分与 SSE 是两条不同的完成路径

普通评分由 `InterviewService.scoreAnswer` 调用 AI、得到 `AiScoreResult` 后保存 `answer_record`。流式评分由 `streamScoreAnswer` 和 `InterviewScoreSseAdapter` 组合：AI 客户端每收到一个 delta 就发送给浏览器，结束后仍然要得到完整结构化评分并持久化。

```text
POST /api/question/score/stream
  -> JwtAuthenticationFilter
  -> UserContext
  -> InterviewScoreSseAdapter
  -> AiClient.generateStream
  -> delta / done / error
  -> 完整 AiScoreResult
  -> answer_record
```

流式输出只是传输方式，不能把“已经显示了一段文本”当作数据库提交成功。客户端断开、上游超时、JSON 结构不完整时，都要区分连接取消和业务失败。当前项目对流式取消保留线程中断语义，并将上游错误归类为 502/504；它没有把 SSE 设计成消息队列，也没有宣称支持断线续传。

## 七、结束面试和生成复盘要隔离失败

完成全部主问题时，`MockInterviewService.finishSession` 先生成 session summary，写入 `COMPLETED` 和 finishedTime，再尝试调用 `MockInterviewReviewService.generateReview`。复盘生成失败会记录 warning，但不会把已结束的 session 改回 ACTIVE：

```java
session.setSummary(aiService.generateMockInterviewSummary(...));
session.setStatus("COMPLETED");
session.setFinishedTime(LocalDateTime.now());
sessionMapper.updateById(session);

try {
    mockInterviewReviewService.generateReview(userId, sessionId);
} catch (RuntimeException exception) {
    log.warn("mock_interview_review_generation_failed", exception);
}
```

这是一种“核心事实先落地、派生结果可重试”的取舍。`MockInterviewReviewService` 只允许读取已结束 session，要求至少回答一道题；它统计 answeredTurnCount、主问题数、追问数和平均分，调用 AI 生成 overallFeedback、strengths、improvementAreas、actionItems，再写入 V13 的 `mock_interview_review`。`session_id` 唯一约束使重复请求不会产生多份 review。

## 八、V1-V13 是业务演进记录

这条闭环不是一次性设计完成的：

- V1 建立用户和答题记录。
- V2-V3 建立 AI 模型目录、用户偏好和默认模型修正。
- V4-V5 增加知识专题与文档内容。
- V6、V8 让 custom Responses provider 与 DeepSeek 默认模型并存。
- V7 增加简历、session 和 turn。
- V9 增加目标公司。
- V10 增加主问题/追问关系与次数限制。
- V11 保留删除简历后的面试历史快照。
- V12 增加 `ENDED_EARLY`。
- V13 增加可独立重试的复盘表。

迁移顺序体现了一个经验：当业务从“生成一道题”演进到“可恢复的面试流程”时，数据库需要先承接新的事实，再让 Service 使用这些事实。不要只改前端按钮或在 JSON 里临时塞字段。

## 九、部署和验证边界

当前项目使用 Docker Compose 组织单机部署，Nginx 负责前后端入口和反向代理，GitHub Actions 执行自动 CI，生产发布仍由人工确认后执行。Flyway 在后端启动时应用 V1-V13，健康检查用于确认容器启动后的服务可用性。

这些工程措施能帮助验证“版本是否正确、容器是否启动、迁移是否执行”，但不等于已经完成无停机发布、自动回滚、真实并发压测或多节点容灾。AI 上游本身仍可能超时或返回不可解析内容，业务必须保留失败和重试边界。

## 十、测试清单与迁移结论

当前值得覆盖的测试包括：

- 三种出题模式的参数互斥和知识专题 published/方向/语言校验。
- 用户、简历、session、turn 和 review 的归属校验。
- 当前问题不能跳过、追问最多两次、非 ACTIVE 状态不能继续操作。
- 删除简历时 ACTIVE session 阻止删除，结束后的历史保留快照。
- SSE delta、done、error 和取消路径。
- 复盘失败不影响已结束 session，重复生成不产生第二条 review。
- Flyway V1-V13 在干净数据库上的顺序执行。

当前没有真实 AI 上游全链路稳定性压测，也没有把 Docker Compose 单机部署包装成生产级平台。可迁移的核心是：主数据先落库，状态转换由 Service 和数据库约束共同守护，外部 AI 结果作为可失败步骤，复盘等派生结果支持隔离和重试，文件删除和数据库事务的边界要诚实表达。
