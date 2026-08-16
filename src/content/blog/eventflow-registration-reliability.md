---
title: "报名接口的可靠性设计：用条件更新和唯一约束防住超卖"
description: "从 EventFlow 的报名与取消源码出发，拆解校验顺序、InnoDB 条件更新、联合唯一约束、事务回滚和并发重复请求的处理方式。"
pubDate: 2026-08-16
updatedDate: 2026-08-16
section: practice
projectSlug: eventflow
cover: /cover-practice-registration.png
coverAlt: "报名接口可靠性封面"
tags:
  - MySQL
  - InnoDB
  - 条件更新
  - 唯一约束
  - 事务
  - 并发控制
featured: false
---

报名接口看起来像一个普通的 `POST` 请求，但它实际同时修改两类事实：场次的剩余名额和用户的报名记录。只要这两类数据没有被同一个事务覆盖，或者名额扣减只在 Java 内存中判断，就可能出现“报名记录成功但名额没有扣”“最后一个名额被两个人拿走”“用户重复报名”等问题。

EventFlow 当前把 MySQL/InnoDB 作为报名主链路的事实源，使用 Service 层校验、条件更新、联合唯一约束和事务共同维护不变量。Redis 和 RabbitMQ 已配置到部署基础设施中，但没有被塞进报名扣减的核心路径。

## 一、先把报名规则排成有顺序的检查

`RegistrationService.register` 并不是拿到两个 ID 就直接扣名额，而是按业务事实的依赖关系逐步检查：

```text
活动存在且为 PUBLISHED
        |
        v
场次存在，并且属于当前活动
        |
        v
场次状态为 ACTIVE
        |
        v
当前时间落在报名窗口内
        |
        v
场次尚未开始
        |
        v
用户在该活动下没有 CONFIRMED 报名
        |
        v
条件更新扣减可用名额
        |
        v
新建报名记录，或把 CANCELLED 记录重新激活
```

这个顺序不是为了让代码看起来整齐，而是为了让错误尽早返回，并且避免对不合法的活动或场次执行写操作。时间使用注入的 `Clock` 获取，因此业务测试可以固定“当前时间”，覆盖报名未开始、已结束和场次已经开始等边界。

## 二、为什么先 SELECT 再 UPDATE 会超卖

一个容易写出的版本是：

```java
ActivitySession session = mapper.selectById(sessionId);
if (session.getAvailableQuota() <= 0) {
    throw new ConflictException("名额已满");
}
mapper.updateQuota(sessionId, session.getAvailableQuota() - 1);
```

假设只剩一个名额，两个事务 T1 和 T2 可能同时读到 `available_quota = 1`：

```text
T1 SELECT -> 1          T2 SELECT -> 1
T1 判断可以报名          T2 判断可以报名
T1 UPDATE -> 0          T2 UPDATE -> 0
T1 INSERT 报名          T2 INSERT 报名
```

如果更新语句没有把“仍然有名额”作为数据库条件，第二个请求的业务判断就建立在过期快照上。应用层的 `if` 不能替代数据库层的原子条件。

## 三、把扣名额条件放进一条 UPDATE

EventFlow 的 `ActivitySessionMapper.confirmQuota` 使用以下条件更新：

```sql
UPDATE ef_activity_session
SET available_quota = available_quota - 1,
    confirmed_quota = confirmed_quota + 1
WHERE id = ?
  AND activity_id = ?
  AND status = 'ACTIVE'
  AND available_quota > 0;
```

代码不读取更新后的数字来猜结果，而是判断影响行数：

```java
if (activitySessionMapper.confirmQuota(activityId, sessionId) != 1) {
    throw new BusinessException(ErrorCode.CONFLICT, "该场次名额已满");
}
```

当最后一个名额被并发请求竞争时，只有一个事务能让 `available_quota > 0` 成为真并更新一行；另一个事务得到影响行数 `0`，直接失败。`available_quota = available_quota - 1` 也避免了“先读数再写回”的丢失更新。

取消报名使用反向条件更新：

```sql
UPDATE ef_activity_session
SET available_quota = available_quota + 1,
    confirmed_quota = confirmed_quota - 1
WHERE id = ?
  AND activity_id = ?
  AND confirmed_quota > 0
  AND available_quota < total_quota;
```

它同时守住了两个边界：确认人数不能减到负数，可用名额不能超过总名额。

## 四、唯一约束负责最后一道防线

报名表 `ef_registration` 使用活动和用户的联合唯一约束：

```sql
UNIQUE KEY uk_ef_registration_activity_user (activity_id, user_id)
```

它表达的是“一个用户在一个活动下只有一条报名记录”，而不是“一个用户只能参加一个场次”。场次 ID 不放进这个唯一键，是因为同一活动下切换场次应当更新原来的记录，而不是插入第二行。

Service 层会先查询已有记录，给正常请求返回更明确的业务提示；但两个相同请求仍可能同时通过这次查询，所以新建记录时还捕获 `DuplicateKeyException`，把数据库约束转为统一的业务冲突响应：

```java
try {
    registrationMapper.insert(registration);
} catch (DuplicateKeyException exception) {
    throw new BusinessException(
            ErrorCode.CONFLICT, "你已经报名了该活动");
}
```

这体现了应用校验和数据库约束的分工：应用校验负责可读性，唯一索引负责并发下的最终事实。

## 五、扣名额和写报名记录必须在同一事务

报名用例标记为 `@Transactional`，扣减场次名额和插入/激活报名记录属于同一个事务边界：

```java
@Transactional
public Long register(AuthenticatedPrincipal principal, RegistrationCommand command) {
    // 校验活动、场次、时间和重复报名
    // 条件更新名额
    // 插入或重新激活报名记录
}
```

如果扣名额成功后插入报名记录失败，事务回滚会把名额恢复；如果报名记录写入成功后后续抛出异常，也不会留下与名额不匹配的半成品。

取消报名同样在一个事务内完成，并且先校验报名记录是否存在、是否属于当前用户、是否仍为 `CONFIRMED`：

```java
if (!registration.getUserId().equals(principal.userId())) {
    throw new BusinessException(ErrorCode.FORBIDDEN);
}
if (registration.getStatus() != RegistrationStatus.CONFIRMED) {
    throw new BusinessException(ErrorCode.CONFLICT, "该报名已经取消");
}
```

随后先归还名额，再用带有 `user_id` 和 `status = 'CONFIRMED'` 条件的 UPDATE 把报名状态改为 `CANCELLED`。影响行数不是 `1` 时抛出冲突，让并发状态变化不会被静默覆盖。

## 六、取消后重新报名为什么复用原记录

报名表保留 `CANCELLED` 记录，而不是取消后直接删除。这样可以保留用户和活动之间的历史关系，也能让“取消后重新报名”变成条件更新：

```sql
UPDATE ef_registration
SET session_id = ?,
    status = 'CONFIRMED',
    update_time = CURRENT_TIMESTAMP(3)
WHERE id = ?
  AND status = 'CANCELLED';
```

重新报名仍然要先成功扣名额，只有名额扣减成功后才激活记录。若激活影响行数不是 `1`，事务会回滚此前的扣减，避免出现“名额减少但记录仍是取消状态”。

## 七、数据库事实源和未验证边界

当前设计选择 MySQL/InnoDB 作为报名事实源，有三个现实原因：

1. 场次名额和报名记录需要同一事务边界。
2. 条件更新的影响行数直接来自数据库执行结果。
3. 联合唯一索引和事务回滚由同一个数据库保证。

Redis 和 RabbitMQ 在 Compose 中已经准备好，但当前没有参与报名扣减。因此不能把这个实现描述成“Redis 预扣库存”或“RabbitMQ 异步报名”。这条链路也没有做真实 MySQL 环境下的并发压测，前端没有完整浏览器 E2E；已有测试主要是 Mockito 业务测试和前端 Vitest 测试。后续如果要提高验证强度，应增加 Testcontainers MySQL 并发场景、唯一索引冲突测试和真实 HTTP 流程测试。
