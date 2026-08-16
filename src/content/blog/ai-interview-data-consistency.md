---
title: "MySQL、Redis 与 Flyway：业务数据一致性如何分层设计"
description: "从主数据、缓存、状态机和数据库迁移四个角度，理解 AI 应用为什么不能把 Redis 当成唯一事实源，以及如何让演进可恢复。"
pubDate: 2026-08-16
updatedDate: 2026-08-16
section: learning
projectSlug: ai-interview-assistant
cover: /cover-learning-data-consistency.png
coverAlt: "MySQL Redis 与 Flyway 数据一致性封面"
tags:
  - MySQL
  - Redis
  - Flyway
  - 数据一致性
  - 状态机
  - 事务
featured: false
---

AI 应用经常同时拥有用户、题目、答题记录、知识专题、简历、模拟面试会话和复盘报告。模型输出可以重新生成，但这些业务数据不能靠“再请求一次”恢复。因此，数据一致性设计的第一步不是选择 Redis，而是先区分哪些数据是当前事实、哪些数据只是加速或派生结果。

## 一、先划分四类数据

可以先用下面的分类建立边界：

| 数据 | 例子 | 首要事实源 | 是否适合缓存 |
| --- | --- | --- | --- |
| 业务主数据 | 用户、简历、面试 session、答题记录 | MySQL/InnoDB | 谨慎，通常先保证数据库正确 |
| 查询加速数据 | 最近生成的题目 | MySQL 之外的 Redis key | 可以，必须能失效或过期 |
| 派生数据 | 平均分、复盘摘要 | 数据库记录或可重算结果 | 视重算成本决定 |
| 迁移元数据 | Flyway schema history | 数据库 | 不应放入应用缓存 |

当前 AI 面试助手里，题目缓存是典型加速数据，答题记录和面试会话是业务主数据。即使 Redis 暂时不可用，系统也不应该因此丢失已经保存的用户答案或面试状态。

## 二、MySQL 是业务事实源

业务事实源应该能够回答：“如果 Redis 清空，系统还能否判断这条记录到底存在、属于谁、处于什么状态？”对于 AI 面试助手，用户、答题记录、知识专题、简历文档、模拟面试 session、turn 和 review 都需要落在 MySQL 中。

核心表之间的关系可以简化为：

```text
user
  |-- answer_record
  |-- knowledge_question_history
  |-- resume_document
              |-- mock_interview_session
                         |-- mock_interview_turn
                         |-- mock_interview_review
ai_model
  |-- user_ai_preference
  |-- mock_interview_session
  |-- mock_interview_review
```

InnoDB 的外键、唯一约束、检查约束和事务不是数据库层面的装饰，它们是把业务规则变成可执行约束的方式。例如 V13 给 `mock_interview_review.session_id` 加联合唯一语义，保证一个 session 至多有一份复盘记录；V7-V13 逐步增加简历、模拟面试、追问、提前结束和复盘，而不是直接修改最初的 V1。

## 三、Redis Cache Aside 的正确边界

Cache Aside 的基本流程是“读时缓存未命中再查库并回填，写时先改数据库再删除缓存”：

```java
String cached = redisTemplate.opsForValue().get(cacheKey);
if (cached != null && !refresh) {
    return cached;
}

String generated = generateFromBusinessService();
redisTemplate.opsForValue().set(cacheKey, generated, Duration.ofHours(1));
return generated;
```

当前 `InterviewService` 的题目缓存 key 包含用户、实际 AI 模型、出题模式、方向、语言和知识点：

```text
question:{userId}:model:{aiModelId}:{mode}:{direction}:{language}:{tag-or-topic}
```

把模型放进 key 很重要：用户切换模型后，新模型不能读到旧模型生成的结果。出题模式也必须进入 key，否则知识库题目和自定义知识点题目可能相互污染。

缓存设计还要回答四个问题：

1. 空结果是否缓存？当前题目生成失败或返回空文本不应该写入缓存。
2. TTL 多久？TTL 只能降低陈旧数据风险，不能替代主动失效。
3. 写失败怎么办？数据库写入成功但缓存删除失败时，必须有 TTL 或重试机制兜底。
4. Redis 挂了怎么办？如果缓存是优化层，应该能降级到数据库或直接重新生成；如果业务只能依赖 Redis，就不能把它称为普通缓存。

对于答题记录、简历和面试状态，不应该把 Redis 作为唯一事实源。当前项目没有宣称完成 Redis 高可用、缓存故障演练或分布式一致性协议，这些是后续边界。

## 四、Flyway 让数据库演进可追踪

手动修改线上表结构最大的问题不是“偶尔失败”，而是团队无法知道某个环境究竟执行过哪些结构变化。Flyway 用版本化迁移文件记录数据库演进，应用启动时按版本顺序执行尚未应用的脚本。

当前 AI 面试助手的 V1-V13 可以按能力阶段理解：

| 版本 | 主要变化 |
| --- | --- |
| V1 | 用户和答题记录核心表、外键、分数约束 |
| V2-V3 | AI 模型目录、默认策略、用户模型偏好和 DeepSeek 模型修正 |
| V4-V5 | 知识库专题、题目和文档内容字段 |
| V6 | 引入 custom Responses 兼容模型选项 |
| V7 | 简历文档、模拟面试 session 和 turn |
| V8 | 恢复 DeepSeek 默认模型并保留 custom 选项 |
| V9 | 模拟面试目标公司 |
| V10 | 主问题、追问、追问次数和父子关系 |
| V11 | 删除简历后保留面试历史快照 |
| V12 | 增加 `ENDED_EARLY` 状态 |
| V13 | 模拟面试复盘表和 session 唯一约束 |

迁移文件应该满足两个原则：已应用的迁移不改写，新增变化追加新版本；迁移脚本要尽量可审查、可重放，避免把 API Key 等运行配置放进 SQL。V6 和 V8 看起来都在调整模型目录，但它们分别表达了引入 custom provider 和修复默认模型的业务历史，不能为了“看起来更整洁”合并成一个不可追溯的脚本。

## 五、状态机比布尔字段更能表达业务

模拟面试 session 至少有三个状态：`ACTIVE`、`COMPLETED` 和 `ENDED_EARLY`。状态决定哪些动作可执行：

```text
ACTIVE
  |-- 完成全部主问题并生成总结 -> COMPLETED
  |
  +-- 用户主动结束 -> ENDED_EARLY

COMPLETED / ENDED_EARLY
  |-- 可以读取复盘
  +-- 不能继续回答或追加新问题
```

状态转换应由 Service 层集中控制，数据库检查约束负责拒绝非法值。不要只依赖前端按钮禁用，因为客户端可以直接调用 API。`MockInterviewService` 会在操作前检查 session 属于当前用户且仍为 `ACTIVE`，`MockInterviewReviewService` 则拒绝对活动中的 session 生成复盘。

## 六、事务解决的是一组数据库变化

当一次操作需要同时修改多张表时，事务要覆盖这些变化的最小完整范围。例如删除简历时，当前实现会阻止删除仍被活动面试使用的简历；删除数据库记录和物理文件清理之间还存在文件系统边界，文件清理失败需要记录并可重试，不能假装数据库事务能够回滚文件系统。

同样，生成复盘时，AI 调用成功后才插入 `mock_interview_review`，并通过 `session_id` 唯一约束避免重复生成多份结果。外部 AI 调用本身不能被 MySQL 事务回滚，所以工程上要把“外部调用”“结果校验”“数据库落库”拆成清晰阶段，并允许失败后重试，而不是把网络请求包装在事务注解里就认为具备原子性。

## 七、什么时候不该用缓存

以下情况优先使用 MySQL：

- 数据是审计或历史事实，例如答题记录和面试复盘。
- 数据变更后必须立即被其他请求看到，且没有可靠失效策略。
- 数据规模不大，查询本身足够快，缓存只会增加失效复杂度。
- 需要依赖数据库约束保证唯一性、外键关系或状态合法性。

以下情况可以考虑 Redis：

- 结果可重新生成，且短时间陈旧可接受。
- 查询模式稳定，key 的组成和失效策略清楚。
- Redis 不可用时有明确降级路径。

## 八、验证与可迁移结论

当前能验证的重点包括 Flyway 迁移顺序、MyBatis 查询条件、题目缓存 key、模型切换后的缓存隔离、状态转换和服务层的单元测试。当前没有真实 Redis 集群故障演练、跨节点缓存一致性压测或完整生产数据恢复演练，因此这些能力不能被写成已完成。

可迁移的设计顺序是：先建模事实，再定义状态机和数据库约束；然后确定事务范围；最后为可重算查询增加缓存。缓存是加速器，Flyway 是演进记录，MySQL 是业务事实源，三者职责清楚，系统才有恢复和排查的基础。
