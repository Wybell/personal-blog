---
title: "从新增审批功能看业务流程如何落地"
description: "以荣誉填报审批工单为例，拆解状态机、权限边界、审核意见、操作日志、事务一致性与并发控制如何共同构成一个可交付的业务流程。"
pubDate: 2026-08-17
updatedDate: 2026-08-17
section: practice
cover: /cover-practice-honor-approval.png
coverAlt: "荣誉填报审批流程工程实践封面"
tags:
  - Java
  - Spring Boot
  - 状态机
  - 权限控制
  - 事务
  - 审批流程
featured: false
---

工单 1005055 的内容是“填报荣誉时增加审批功能”。它表面上是给荣誉填报功能增加一个审批按钮，实际上是对原有业务流程的一次扩展。原来的荣誉记录可能只包含新增、保存和提交等操作，加入审批后，系统必须继续回答：哪些人可以提交，哪些角色可以审核，审核中的记录能不能修改，审核通过后是否还能编辑，驳回后如何重新提交，审核意见保存在哪里，前端隐藏的按钮是否还会被接口绕过，以及审批过程是否需要留下可追溯的历史。

这类需求的难点不在于增加一个 Controller 方法，而在于把“填报、提交、审核、驳回、再次提交”变成一条边界清晰、状态可解释、失败可回滚的业务链路。本文按这次工单涉及的思考顺序，记录我如何把一个看起来很小的功能拆成状态模型、数据模型、接口约束、权限校验和测试方案。

## 一、先把模糊需求拆成业务动作

实现之前，不能直接从“增加审批按钮”开始写代码。第一步是把用户能做的动作列出来，再为每个动作确定前置条件、操作者和结果。荣誉填报至少包含以下动作：创建草稿、修改草稿、提交审核、审核通过、审核不通过、驳回后再次编辑，以及查询当前状态和历史操作。

如果只把审批理解为一个字段变化，后续很容易出现页面按钮和后端规则不一致。例如页面把“审核通过”按钮隐藏了，但接口仍然接受普通用户请求；或者前端显示记录已经驳回，后端却没有允许创建人重新提交。业务动作应该先被定义，再映射到接口和页面。

本次设计将记录状态抽象为四个主要状态：

```text
DRAFT
  |
  v
SUBMITTED
  |       \
  |        \
  v         v
APPROVED  REJECTED
              |
              v
           DRAFT
```

`DRAFT` 表示记录还在填报人手中，可以编辑、保存和删除；`SUBMITTED` 表示已经提交，正在等待有权限的人员审核，此时创建人不能继续修改；`APPROVED` 表示审核通过，记录成为正式有效数据；`REJECTED` 表示审核不通过，需要根据意见修改后重新提交。驳回之后可以回到草稿，但不能删除之前的审核历史。

状态不是为了在页面上展示一个标签，而是为了限制业务操作。可以把它整理成一张操作矩阵：

| 状态 | 创建人编辑 | 创建人提交 | 审核人审核 | 创建人删除 |
| --- | --- | --- | --- | --- |
| 草稿 | 可以 | 可以 | 不可以 | 可以 |
| 待审核 | 不可以 | 不可以 | 可以 | 不可以 |
| 已通过 | 按业务决定 | 不可以 | 不可以 | 不可以 |
| 已驳回 | 可以 | 可以 | 不可以 | 按业务决定 |

这张矩阵的价值在于，它把“应该怎样”变成了可以被代码和测试验证的规则。后续每个接口都应该明确使用哪一行规则，而不是在不同页面里临时判断。

## 二、数据模型要同时保存当前状态和历史事实

荣誉记录表至少需要保存当前业务状态、提交时间和审核信息。一个简化后的结构如下：

```sql
CREATE TABLE honor_record (
    id BIGINT PRIMARY KEY,
    organization_id BIGINT NOT NULL,
    creator_id BIGINT NOT NULL,
    honor_name VARCHAR(200) NOT NULL,
    honor_level VARCHAR(50),
    status VARCHAR(30) NOT NULL,
    submit_time DATETIME NULL,
    audit_time DATETIME NULL,
    auditor_id BIGINT NULL,
    audit_comment VARCHAR(1000) NULL,
    create_time DATETIME NOT NULL,
    update_time DATETIME NOT NULL
);
```

`creator_id` 用于判断记录的归属，`organization_id` 用于数据范围控制，`status` 表示当前状态，`auditor_id` 和 `audit_comment` 保存最后一次审核结果。这里要注意，最后一次审核信息不能替代完整历史。如果一条记录先被驳回，后来又修改并通过，只保留当前的“审核通过”就无法解释之前发生过什么。

因此需要独立的操作日志表：

```sql
CREATE TABLE honor_operation_log (
    id BIGINT PRIMARY KEY,
    honor_id BIGINT NOT NULL,
    operator_id BIGINT NOT NULL,
    operator_role VARCHAR(50),
    operation_type VARCHAR(50) NOT NULL,
    before_status VARCHAR(30),
    after_status VARCHAR(30),
    comment VARCHAR(1000),
    create_time DATETIME NOT NULL
);
```

每次提交、审核通过、审核驳回、撤回或重新提交，都记录操作人、操作者角色、前状态、后状态和意见。这样做不仅便于页面展示审核记录，也便于出现争议时还原事实。业务表负责快速查询当前状态，日志表负责记录不可替代的过程，两者承担不同职责。

状态字段还应该使用统一的枚举或常量，而不是在代码中散落字符串。数据库约束、Java 枚举、接口文档和前端类型需要保持一致，否则一个地方使用 `PENDING`，另一个地方使用 `SUBMITTED`，问题往往要到联调时才暴露。

## 三、按业务动作设计接口

接口不应该只有一个笼统的“审核接口”，而应该让每一个会改变状态的动作都具备清晰的命令语义：

```text
POST /honor                         新增荣誉记录
PUT  /honor/{id}                    修改草稿或驳回记录
POST /honor/{id}/submit             提交审核
POST /honor/{id}/approve            审核通过
POST /honor/{id}/reject             审核不通过
GET  /honor/{id}/operations         查询操作记录
```

审核请求可以携带审核意见：

```json
{
  "comment": "材料完整，审核通过"
}
```

后端收到请求后，必须重新确认当前用户已登录、拥有对应角色、记录存在且处于可管理的数据范围内，并且当前状态确实允许这个动作。审核接口不能相信前端传来的 `role` 或 `status`，因为这些值都可以被请求方修改。

审核通过和审核驳回也不应该只修改一列。它们至少要同时更新状态、审核人、审核时间、审核意见和更新时间，并追加操作日志。对驳回动作，还要明确审核意见是否必填。没有理由的驳回会让填报人只能反复试错，最终变成流程上的“死循环”。

## 四、服务层要把状态变化和日志写入放进同一个用例

一个完整的审核动作应该由服务层组织，而不是让 Controller 分别调用几个 Mapper。审核通过的核心逻辑可以概括为：先加载记录，校验权限和状态，执行带原状态条件的更新，确认影响行数为一，再写入操作记录。

```java
@Transactional
public void approve(Long honorId, Long operatorId, String comment) {
    HonorRecord record = honorMapper.selectById(honorId);
    if (record == null) {
        throw new BusinessException("荣誉记录不存在");
    }
    if (!permissionService.canAudit(operatorId, record)) {
        throw new BusinessException("没有审核权限");
    }
    if (!"SUBMITTED".equals(record.getStatus())) {
        throw new BusinessException("当前状态不允许审核");
    }

    int updated = honorMapper.approveIfSubmitted(
        honorId, operatorId, comment
    );
    if (updated != 1) {
        throw new BusinessException("记录状态已变化，请刷新后重试");
    }

    operationLogService.record(
        honorId, operatorId, "APPROVE",
        "SUBMITTED", "APPROVED", comment
    );
}
```

关键的数据库更新不能只依赖前面那次查询，而应当把原状态放到 `WHERE` 条件里：

```sql
UPDATE honor_record
SET status = 'APPROVED',
    auditor_id = #{operatorId},
    audit_comment = #{comment},
    audit_time = NOW(),
    update_time = NOW()
WHERE id = #{honorId}
  AND status = 'SUBMITTED';
```

这样可以处理两个审核请求几乎同时到达的情况。两个请求都可能先读到待审核状态，但只有一个请求能够成功更新这一行。影响行数为 1 代表本次抢到了处理权，影响行数为 0 代表记录已经被别人处理、状态发生变化或记录不存在。相比“先查询，再无条件更新”，条件更新把检查和修改之间的竞态窗口缩小了。

审核驳回也使用同样的原则，并在事务中强制校验意见：

```java
@Transactional
public void reject(Long honorId, Long operatorId, String comment) {
    if (comment == null || comment.isBlank()) {
        throw new BusinessException("审核不通过时必须填写意见");
    }
    int updated = honorMapper.rejectIfSubmitted(
        honorId, operatorId, comment
    );
    if (updated != 1) {
        throw new BusinessException("当前记录已被处理");
    }
    operationLogService.record(
        honorId, operatorId, "REJECT",
        "SUBMITTED", "REJECTED", comment
    );
}
```

如果状态已经更新成功，但操作日志插入失败，事务应该整体回滚。这样不会出现页面显示已通过，却找不到任何审核记录的半成功状态。事务边界应当放在完整的业务服务方法上，而不是只给单条数据库语句加事务注解。

## 五、前端负责引导，后端负责边界

前端可以根据状态决定是否展示按钮，让用户少看到不能执行的操作：

```ts
const canSubmit = record.status === "DRAFT" || record.status === "REJECTED"
const canAudit = record.status === "SUBMITTED" && user.isAuditor
const canEdit = record.status === "DRAFT" || record.status === "REJECTED"
```

但这只是交互层优化。真正的权限检查必须放在后端，因为用户可以跳过页面直接构造 HTTP 请求。后端需要从登录会话中获取操作者身份，从数据库读取角色和组织关系，从记录本身判断数据归属，从当前状态判断动作是否合法。不能把前端的 `canAudit` 当成安全边界，也不能把请求体中传入的用户 ID 当成可信身份。

驳回后重新编辑时，保存接口只允许修改草稿或驳回记录，不能让待审核记录被悄悄改写。重新提交时要把状态从 `DRAFT` 变回 `SUBMITTED`，更新提交时间，但不能删除过去的驳回日志。页面上可以只展示当前结果，详情页或操作记录页则保留完整过程。

## 六、测试和上线验证

审批功能的测试不能只验证“点击通过后页面变绿”。至少要覆盖以下场景：

- 草稿提交成功，状态从 `DRAFT` 变成 `SUBMITTED`。
- 已提交记录不能重复提交，待审核记录不能被创建人编辑或删除。
- 具有权限的审核人可以通过或驳回，普通用户不能审核。
- 驳回时未填写意见必须失败，且数据库状态不能变化。
- 用户不能审核不属于自己数据范围的记录。
- 已通过或已驳回的记录不能重复执行当前不允许的动作。
- 驳回后重新编辑、重新提交能够产生新的操作日志。
- 两个审核请求同时到达时，只有一个成功，不能产生两条通过记录。
- 审核成功后日志写入失败时，状态和日志都回滚。

验证还应覆盖接口直接调用，而不是只通过前端页面操作。前端按钮的显示规则、后端接口的拒绝规则和数据库最终状态必须形成闭环。上线前要准备一条完整的测试数据，依次执行新增、提交、驳回、修改、再次提交和通过，检查每一步的操作者、时间、意见和状态是否一致。

## 七、这项需求的工程价值

这次工单让我更清楚地认识到，企业系统里的“增加审批”不是增加一个按钮，也不是简单地把一个字段改成 `APPROVED`。它至少包含状态机、角色权限、组织数据范围、审核意见、操作日志、事务一致性、并发控制和异常恢复。

真正可交付的实现，需要先把模糊需求拆成可验证的业务规则，再把规则落到数据库、服务层、接口和前端交互中。前端负责让正确操作更容易，后端负责让错误操作无法成立，数据库条件更新负责处理并发，事务负责防止半成功，操作日志负责让过程可追溯。只有这些部分同时成立，审批功能才算真正从“能点”走到了“能长期运行”。

在实际交付时，还需要给这类状态流转保留可观测性。日志中至少应包含荣誉记录 ID、操作人 ID、操作类型、原状态、目标状态和请求标识，异常时能够从一次请求追到状态更新和日志写入。对于审核失败、无权限、状态冲突等情况，返回给前端的消息要能区分“没有权限”和“记录已经被别人处理”，这样用户知道是应该联系管理员，还是刷新页面重新确认。上线后的抽样检查也不能只看接口返回成功，还要核对记录当前状态、最后审核人和操作日志是否一致。

这次需求最终沉淀下来的方法，可以迁移到请假、报销、合同、资料归档等其他审批场景：先定义状态和合法转移，再定义每个转移的操作者与数据范围，最后用条件更新、事务和日志把规则固定下来。这样后续新增一个节点时，修改的是清晰的流程模型，而不是在多个页面和接口中继续堆叠例外判断。

从开发协作角度看，状态模型还可以作为前后端联调的共同语言。接口文档中应写清每个动作的请求参数、成功后的状态、失败时的原因和是否允许重试，测试人员则可以按照状态转移表组织用例。这样讨论问题时，不再停留在“这个按钮好像不能点”，而是可以准确描述为“REJECTED 记录提交后没有转为 SUBMITTED”或“非审核角色调用 approve 被错误接受”。业务、开发和测试对同一状态拥有相同理解，沟通成本会明显降低。

审批流程还需要考虑版本演进。后续如果增加会签、撤回或重新审核，不能直接复用旧字段并改变原有含义，而应增加新的状态或流程节点，并保证历史记录仍然能够按旧规则解释。对已经存在的老数据，要设计迁移默认值和回滚方案；对新旧接口并存的阶段，要明确哪一个接口负责创建操作日志。把这些变化提前纳入设计，能减少上线后因为历史数据无法解释而产生的补救工作。
