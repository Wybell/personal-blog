---
title: "EventFlow 技术复盘：从活动报名业务到可交付的工程系统"
description: "以 EventFlow 为例，完整拆解活动状态机、多场次配额、MySQL 条件更新防超卖、JWT 令牌轮换、前端缓存一致性、容器部署和 CI/CD 中的真实实现与踩坑。"
pubDate: 2026-08-14
updatedDate: 2026-08-16
section: project
projectSlug: eventflow
cover: /project-eventflow.png
coverAlt: "EventFlow 活动报名系统项目封面"
tags:
  - EventFlow
  - Spring Boot
  - React
  - MySQL
  - 并发控制
  - Docker
  - CI/CD
featured: true
---

很多活动报名系统的演示，最后都会变成几个页面和几组接口：创建活动、展示活动、点击报名。真正开始做 EventFlow 之后，我才发现，页面上的“报名成功”只是业务的表面结果，系统还必须回答一系列更具体的问题：活动处于什么阶段时可以被谁修改，审核通过后为什么还需要一个发布动作，一个活动有多个场次时名额应该归属在哪里，两个用户同时抢最后一个名额时数据库如何保证不超卖，重复点击和取消后重新报名怎样处理，access token 过期时多个请求如何刷新，代码发布到服务器后怎样确认它真的在运行。

EventFlow 是我围绕这些问题实现的活动报名与场次配额管理平台。活动创建者可以创建活动、配置多个场次与名额、提交审核并发布；普通用户可以浏览已发布活动、选择场次报名和取消报名；管理员负责审核、驳回、查看审核记录和下架活动。

这篇文章不是功能清单，而是一次基于当前仓库源码的工程复盘。我会把已经实现的方案、选择方案的原因、容易踩坑的地方，以及当前明确没有实现的边界都写清楚。Redis、RabbitMQ、E2E 和并发压测在文章中只会作为配置基础或后续方向出现，不会被描述成已经接入核心报名链路的能力。

## 一、先从业务模型开始，而不是先选中间件

### 1.1 三类核心对象

EventFlow 的报名流程至少需要三类对象：活动、活动场次和报名记录。

活动记录描述标题、简介、地点、主办方、联系人、报名时间窗口以及审核和发布状态。活动场次记录具体的开始时间、结束时间和名额。报名记录关联活动、场次和用户，并保存 `CONFIRMED` 或 `CANCELLED` 状态。

之所以把活动和场次拆开，是因为名额属于某个具体场次，而不是一个活动的抽象总量。例如一个活动有上午场 30 个名额、下午场 20 个名额，用户报名时选择的是某个场次，系统必须分别维护它们的可用名额。如果把名额只放在活动表上，就无法准确表达场次级库存，也无法让创建者对不同场次进行独立配置。

项目中的角色边界是：

| 角色 | 主要能力 | 权限判断依据 |
| --- | --- | --- |
| 普通用户 | 浏览公开活动、报名、取消自己的报名、维护个人资料 | 登录身份和报名记录的用户归属 |
| 活动创建者 | 创建活动、编辑草稿、配置场次、提交审核、发布审核通过的活动、查看报名 | `create_user_id` 是否为当前用户 |
| 管理员 | 审核、驳回、查看审核历史、下架活动 | JWT 中的 `ADMIN` 角色以及服务层校验 |

这里有一个贯穿整个项目的原则：前端隐藏按钮只是体验优化，后端才是权限和业务规则的最终边界。即使普通用户手工构造请求调用管理员接口，或者把页面上的按钮重新显示出来，后端也必须拒绝请求。

### 1.2 活动状态不能用一个布尔字段代替

活动的状态机如下：

```text
                    +------------------+
                    |                  v
DRAFT ----------> PENDING_REVIEW --> APPROVED --> PUBLISHED --> OFFLINE
  ^                       |
  |                       v
  +------------------- REJECTED
       修改后重新提交审核
```

实际代码中的状态包括 `DRAFT`、`PENDING_REVIEW`、`APPROVED`、`REJECTED`、`PUBLISHED` 和 `OFFLINE`。

状态机解决的是“当前状态允许哪些动作”，而不只是展示一个状态标签：

- 创建者只能编辑 `DRAFT` 和 `REJECTED` 活动。
- 提交审核前必须至少配置一个场次。
- 审核接口只接受 `PENDING_REVIEW` 活动。
- 驳回必须填写审核原因，原因会同时写入活动的最新审核信息和审核历史表。
- 审核通过后进入 `APPROVED`，只有创建者再次发布后才进入 `PUBLISHED`。
- 公开接口只查询 `PUBLISHED` 活动。
- 已发布活动只能由管理员下架到 `OFFLINE`。

`ActivityService` 在每个写操作中都重新查询活动，然后校验当前用户归属、管理员角色和允许的状态迁移。前端的状态映射和按钮禁用是第一层提示，Service 中的校验是第二层强制约束，这两层不能互相替代。

## 二、架构选择：模块化单体，而不是为了“高级”拆微服务

### 2.1 整体拓扑

项目采用前后端分离的模块化单体架构：

```text
Browser
   |
   v
宿主机 Nginx :80/:443 或临时 :8084
   |
   v
frontend 容器：Nginx + React 静态资源
   |  /api 反向代理
   v
backend 容器：Spring Boot 3.4 / Java 17
   |
   +--> MySQL 8.4：业务事实和事务边界
   +--> Redis 7：已配置，当前未参与报名主链路
   +--> RabbitMQ 4.1：已配置，当前未参与报名主链路
```

后端按业务域拆分为：

```text
com.eventflow
├── auth
│   ├── api                 Controller 和请求响应 DTO
│   ├── application         登录、刷新、资料、头像、改密
│   └── infrastructure      用户、角色、refresh token 持久化
├── activity
│   ├── api                 活动、场次、审核接口
│   ├── application         活动和场次用例编排
│   ├── domain              ActivityStatus、ActivitySessionStatus
│   └── infrastructure      Activity、Session、ReviewRecord 和 Mapper
├── registration
│   ├── api                 报名、取消、报名管理接口
│   ├── application         RegistrationService 事务用例
│   ├── domain              RegistrationStatus
│   └── infrastructure      报名实体和关键 SQL Mapper
└── shared
    ├── api                 ApiResponse
    ├── error               BusinessException 和全局异常处理
    ├── request              RequestIdFilter
    └── security             JWT Filter、SecurityContext、权限配置
```

每个业务域基本遵循 `api -> application -> domain -> infrastructure/persistence` 的方向：Controller 负责 HTTP 映射，Application Service 负责用例和事务，Domain 保存有限状态概念，Persistence 负责实体和 SQL。

### 2.2 为什么当前阶段不拆成微服务

活动审核、场次配额和报名记录共享同一个 MySQL 事实源，报名时还需要在同一事务中完成场次更新和报名记录写入。如果现在拆成活动服务、库存服务、报名服务，反而要马上引入 RPC、分布式事务、消息最终一致性和链路追踪，复杂度会上升，但业务吞吐和部署规模并没有相应需求。

模块化单体保留了边界：报名逻辑集中在 `registration` 模块，活动状态集中在 `activity` 模块，认证集中在 `auth` 模块；同时又让关键报名事务直接落在同一个数据库连接和事务上下文中。未来如果真的需要拆分，可以从明确的模块边界开始，而不是从一个互相调用的“大包”里被动拆代码。

## 三、数据库设计：把业务不变量写进表结构

### 3.1 Flyway 迁移体现了模型的演进

数据库由 Flyway 管理，当前迁移从 `V001` 到 `V007`，每次变更通过新的版本脚本完成，不能修改已经在生产执行过的旧脚本。

迁移的大致演进是：

| 版本 | 主要内容 |
| --- | --- |
| V001 | 平台事件、已处理事件和操作日志的基础表预留 |
| V002 | 用户、角色、用户角色关系、refresh token |
| V003 | 活动、活动场次和配额检查约束 |
| V004 | 组织和组织者申请相关表 |
| V005 | 活动审核字段、审核历史和创建者索引 |
| V006 | 用户头像字段 |
| V007 | 报名记录、重复报名唯一约束和查询索引 |

这个历史也暴露出一个真实的建模过程：早期模型包含组织和组织者申请，后续业务把重点调整为活动审核，于是在 `V005` 中对活动表做增量调整并增加审核记录，而不是直接重写旧迁移。迁移历史保留了需求演进的证据，也提醒我数据库设计不是一次性画完就不变。

### 3.2 场次配额不变量

`ef_activity_session` 中有四个配额字段：

```text
total_quota = available_quota + reserved_quota + confirmed_quota
```

建表时通过 MySQL `CHECK` 约束表达这个不变量：

```sql
CONSTRAINT chk_ef_activity_session_quota
CHECK (total_quota = available_quota + reserved_quota + confirmed_quota)
```

创建场次时，Service 初始化为：

```text
available_quota = total_quota
reserved_quota  = 0
confirmed_quota = 0
```

当前版本只使用 `available_quota` 和 `confirmed_quota`。`reserved_quota` 是为后续“临时预约占用”模型预留的字段，但当前没有临时锁定和超时释放逻辑，所以不能把它说成已实现的预约能力。

场次还通过 `CHECK (end_time > start_time)` 保证时间范围合法，Service 另外校验名额必须大于 0。应用层校验负责给出可读错误，数据库约束负责阻止绕过 Service 的异常写入。

### 3.3 报名表为什么对活动和用户做唯一约束

`ef_registration` 的关键定义是：

```sql
CREATE TABLE ef_registration (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    activity_id BIGINT UNSIGNED NOT NULL,
    session_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    status VARCHAR(32) NOT NULL,
    create_time DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    update_time DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_ef_registration_activity_user (activity_id, user_id),
    KEY idx_ef_registration_user_status (user_id, status, update_time, id),
    KEY idx_ef_registration_session_status (session_id, status, id)
);
```

唯一键是 `(activity_id, user_id)`，而不是 `(activity_id, session_id, user_id)`。这是由业务规则决定的：用户对同一个活动只能保留一条报名事实，不能通过选择另一个场次绕过重复报名限制。

报名取消不是删除记录，而是把状态改成 `CANCELLED`。这样可以保留报名历史，也可以在用户再次报名时复用原记录，将它重新激活为 `CONFIRMED`。因此这个唯一键既防止新记录重复插入，也支持“取消后重新报名”的状态模型。

## 四、最核心的技术问题：如何防止报名超卖

### 4.1 先看有风险的写法

最容易写出的实现是：

```java
ActivitySession session = sessionMapper.selectById(sessionId);
if (session.getAvailableQuota() <= 0) {
    throw new BusinessException("名额已满");
}
session.setAvailableQuota(session.getAvailableQuota() - 1);
sessionMapper.updateById(session);
registrationMapper.insert(registration);
```

问题是 `SELECT` 和 `UPDATE` 之间存在窗口。两个请求都可能读取到 `available_quota = 1`，都通过 Java 判断，然后先后写入，最终出现两个报名对应一个名额的情况。给 Java 方法加 `synchronized` 也不能解决多实例部署、多个线程和其他写入口的问题。

### 4.2 用条件更新把判断和扣减合并

EventFlow 在 `ActivitySessionMapper` 中使用显式 SQL：

```sql
UPDATE ef_activity_session
SET available_quota = available_quota - 1,
    confirmed_quota = confirmed_quota + 1
WHERE id = #{sessionId}
  AND activity_id = #{activityId}
  AND status = 'ACTIVE'
  AND available_quota > 0;
```

这里的关键不是“减一”本身，而是 `available_quota > 0` 与更新动作在数据库中作为一个原子操作执行。InnoDB 会对满足条件的行进行并发控制：

- 如果请求成功获取行并完成更新，返回影响行数 `1`。
- 如果名额已被其他事务消耗，当前条件不再满足，返回影响行数 `0`。

Service 不看 Java 对象里的旧 `availableQuota` 决定成败，而是看 Mapper 返回的影响行数：

```java
if (activitySessionMapper.confirmQuota(activity.getId(), session.getId()) != 1) {
    throw new BusinessException(ErrorCode.CONFLICT, "该场次名额已满");
}
```

取消报名使用对称的条件更新：

```sql
UPDATE ef_activity_session
SET available_quota = available_quota + 1,
    confirmed_quota = confirmed_quota - 1
WHERE id = #{sessionId}
  AND activity_id = #{activityId}
  AND confirmed_quota > 0
  AND available_quota < total_quota;
```

它防止释放动作把 `confirmed_quota` 减成负数，也防止可用名额超过总名额。

### 4.3 并发时序到底发生了什么

假设某场次 `available_quota = 1`，用户 A 和用户 B 同时报名：

```text
用户 A                          用户 B
  |                               |
  | UPDATE ... available > 0      |
  |------------------------------>| 等待数据库并发控制
  | 影响行数 = 1                  |
  | 写入 A 的报名记录              |
  | 提交事务                       |
  |                               | 继续判断条件
  |                               | available_quota 已为 0
  |                               | 影响行数 = 0
  |                               | 返回名额已满
```

关键点是，用户 B 不能因为之前的查询结果是“有名额”就成功，最终判断发生在 `UPDATE ... WHERE available_quota > 0` 的执行时刻。数据库中的当前值才是并发竞争后的事实。

### 4.4 同一用户并发重复报名怎么办

即使 Service 先做了：

```java
findByActivityAndUser(activityId, userId)
```

也不能把这个查询当作并发安全保障。两个相同用户的请求可能同时查到没有记录。此时依靠三层保护：

1. `(activity_id, user_id)` 唯一索引保证最终不能插入两条记录。
2. 捕获 `DuplicateKeyException`，把数据库异常转换为业务上的“已经报名”。
3. 整个方法使用 `@Transactional`，如果插入因唯一键失败，前面已经完成的名额扣减也随当前事务回滚。

取消后重新报名也有类似竞态：两个请求都读取到 `CANCELLED`，都先扣减名额，但只有一个请求能让 `reactivate` 的条件 `status = 'CANCELLED'` 成功；另一个请求影响行数为 0，异常会回滚它自己的名额扣减。

因此最终的正确性不是由某一行代码单独保证的，而是由“条件更新 + 唯一约束 + 条件状态更新 + 事务”共同保证的。

### 4.5 为什么没有把 Redis 放进报名主链路

项目已经在 Docker Compose 和 Spring Boot 生产配置中接入 Redis，但当前报名流程没有用 Redis 作为库存来源。原因是名额、报名记录和活动状态最终都要在 MySQL 中保持一致。把 Redis 作为另一个库存事实源，需要面对缓存预扣、回滚、重启恢复、消息丢失和数据库对账等问题。

在当前单体规模下，MySQL 条件更新已经能够表达这个业务约束，且数据最终只保留一份事实源。Redis 更适合在有明确的热点读、缓存失效策略或异步削峰需求后再引入，而不是为了让架构图看起来更复杂。

## 五、事务边界：报名不是几个 Mapper 调用的拼接

`RegistrationService.register` 的事务步骤可以拆成：

```text
开始事务
  1. 查询并校验活动是否 PUBLISHED
  2. 查询并校验场次是否属于活动且 ACTIVE
  3. 校验报名时间窗口和场次开始时间
  4. 查询当前用户的既有报名状态
  5. 条件扣减 available_quota
  6. INSERT 新报名，或 UPDATE 旧 CANCELLED 记录为 CONFIRMED
提交事务
```

任何一个业务异常都会导致事务回滚。尤其是第 5 步和第 6 步之间，不能出现“名额已经减掉但报名记录没有落库”的半成功状态。

取消流程同样在一个事务中完成：先通过用户 ID 校验报名归属和状态，再反向释放场次名额，最后执行带 `registration_id`、`user_id` 和 `status = 'CONFIRMED'` 条件的状态更新。这里把 `user_id` 继续放进更新条件，是为了让数据库层再多一道资源归属保护。

事务边界放在 Service 的公开方法，而不是 Controller 或单个 Mapper 上，原因是一个业务用例可能包含多个数据库动作。Controller 只负责把请求转换成命令对象，并从 Spring Security 获取 `AuthenticatedPrincipal`；它不负责自己决定状态、扣库存或拼写多次数据库调用。

## 六、认证设计：短期 JWT 加数据库 refresh token

### 6.1 登录和请求认证链路

登录成功后，后端读取用户和角色，生成：

- access token：JWT，默认有效期 30 分钟。
- refresh token：32 字节安全随机数编码后的不透明字符串，默认有效期 7 天。

JWT 中包含 issuer、subject、签发时间、过期时间、角色集合，以及可选的组织 ID。后续请求经过 `JwtAuthenticationFilter`：

```text
Authorization: Bearer <access-token>
            |
            v
解析签名 -> 校验 issuer 和 exp -> 构造 AuthenticatedPrincipal
            |
            v
写入 Spring SecurityContext
            |
            v
Controller 获取当前用户并调用 Service
```

JWT 的签名密钥从 `EVENTFLOW_JWT_SECRET` 读取，代码通过 Base64 解码后创建 HMAC key。这个实现带来一个部署上的坑：环境变量必须是合法的 Base64 密钥，不能随便填一段普通字符串，否则 `Decoders.BASE64.decode` 或 HMAC key 构造阶段会失败。项目文档使用 `openssl rand -base64 32` 生成密钥，避免手工配置格式不对。

### 6.2 refresh token 为什么不明文存库

refresh token 具有较长有效期，如果数据库直接保存原文，一旦数据库泄露，攻击者可以直接拿 token 换取新的 access token。EventFlow 只保存：

```text
token_hash = SHA-256(refresh_token)
```

刷新时对客户端提交的 token 重新计算哈希，再按哈希、未过期和未撤销条件查询。服务端不需要知道原文，数据库泄露后也不能直接把哈希当作原 token 使用。

刷新操作使用轮换：

```text
读取有效 refresh token
      |
      v
条件撤销旧 token
      |
      v
读取用户状态并签发新 access token + 新 refresh token
```

如果旧 token 已经被使用过，第二次刷新会因为撤销条件不满足而失败。退出登录只撤销当前 refresh token，修改密码则撤销该用户的全部 refresh token，让其他设备的长期会话一起失效。

### 6.3 前端 401 重试中的共享 Promise

前端 Axios 响应拦截器会处理 401。如果页面同时有多个接口请求，而 access token 恰好同时过期，简单实现会产生多个 refresh 请求；由于 refresh token 会轮换，后发请求可能使用已经失效的旧 token，造成连锁失败。

当前客户端用一个模块级 `refreshPromise` 合并并发刷新：

```text
请求 A 401 ----+
请求 B 401 ----+--> 复用同一个 refreshPromise
请求 C 401 ----+
                      |
                      v
             一次 refresh 成功
                      |
                      v
            更新两个 token，重试原请求
```

刷新成功后同时更新 access token 和 refresh token，避免继续使用已经轮换过的旧 token。刷新失败则清理会话并清理 React Query 缓存。

这个方案解决的是同一个浏览器运行时内的并发请求。如果未来要支持多标签页同时刷新，还需要 BroadcastChannel、共享锁或其他跨标签页协调机制；当前版本没有把这个边界包装成已经解决的能力。

## 七、前端状态管理：区分客户端会话和服务端事实

前端使用 React 19、TypeScript、Vite、Ant Design、TanStack React Query、Zustand 和 Axios，并按功能拆分：

```text
features/auth          登录、注册、角色默认路由
features/activity      创建活动、编辑、场次、提交、发布
features/participant   公开活动广场、报名、我的报名
features/registration  创建者报名管理、筛选、分页、脱敏展示
features/admin         管理员审核
features/profile       资料、头像、改密
shared/api             Axios、错误转换、RequestId、401 刷新
shared/auth            Zustand 持久化会话
```

状态划分遵循一个简单规则：

- Zustand 保存登录会话和当前用户，属于客户端身份状态。
- React Query 保存活动、场次、报名列表，属于服务端事实。

例如报名页会分别查询公开活动、活动场次和我的报名，报名 Mutation 成功后失效相关 Query：

```text
报名成功
   |
   +--> invalidate 活动场次 Query：刷新 availableQuota
   +--> invalidate 我的报名 Query：刷新用户状态
   +--> invalidate 活动详情 Query：刷新页面展示
```

如果把这些数据都复制到组件的 `useState` 里，报名成功后很容易只更新按钮，遗漏场次名额或我的报名列表。使用 Query 失效让页面重新从后端事实源读取，代价是多一次请求，但状态关系更清楚。

登录新用户和退出登录时，Session Store 会主动 `queryClient.clear()`。这一步很容易被遗漏：如果用户 A 退出后用户 B 登录，而缓存没有清理，B 可能短暂看到 A 的活动或报名数据。项目中专门为“切换用户清缓存”和“退出清缓存”写了测试。

## 八、权限和文件安全：不能只靠框架默认配置

### 8.1 两层权限判断

Spring Security 的配置负责两类基础动作：

1. 公开放行登录、注册、刷新、头像读取、公开活动和健康检查接口。
2. 其他请求默认要求已经认证。

但“已登录”不等于“有权操作这个资源”。例如创建者报名管理接口，还需要在 `RegistrationService.listForOrganizer` 中判断：当前用户是不是该活动的创建者，或者是否拥有 `ADMIN` 角色。

活动详情读取也不是简单的 `selectById`：创建者可以看自己的活动，管理员可以看待审核活动或自己曾经审核过的活动，其他用户返回 `FORBIDDEN`。资源归属校验放在 Service，可以覆盖所有入口，而不是只在某个 Controller 的一条路由上判断。

### 8.2 头像上传的具体防护

头像上传同时检查：

- 文件不能为空且不超过 5 MB。
- `Content-Type` 只能是 JPEG、PNG 或 WEBP。
- 文件内容必须匹配对应的魔数，不能只相信客户端传来的文件类型。
- 服务端使用 UUID 生成文件名，不使用用户提交的原始文件名。
- 解析头像路径时检查 `normalize()` 后的路径仍然以头像目录开头。
- 替换头像后删除旧文件，但删除失败不会让已经成功保存的新头像回滚。

这里有一个需要明确的工程取舍：数据库更新和文件系统写入不是同一个事务。当前实现先保存新文件，再更新用户头像 URL，旧文件清理由操作逻辑完成；如果清理旧文件失败，会留下一个可通过运维处理的旧文件，而不会影响用户已经成功使用的新头像。这比为了清理一个旧文件而让整个资料更新失败更符合用户体验，但生产环境仍应监控存储目录。

## 九、统一错误和 RequestId：让线上问题能被追踪

后端通过 `ApiResponse<T>` 统一返回：

```json
{
  "code": 0,
  "message": "success",
  "data": {},
  "requestId": "..."
}
```

`BusinessException` 由全局异常处理器转换成明确的 HTTP 状态、业务错误码和消息；参数绑定失败、请求体格式错误等统一返回参数错误；未预期异常记录完整堆栈，但对客户端只返回通用错误，避免泄露内部细节。

每次请求经过 `RequestIdFilter`：

1. 如果请求带有符合 `[A-Za-z0-9._-]{8,64}` 的 `X-Request-Id`，就沿用它。
2. 否则生成 UUID。
3. 写入 MDC，让日志 pattern 输出 `requestId`。
4. 在响应头和 `ApiResponse` 中返回同一个 ID。
5. 请求结束后清理 MDC，避免线程复用造成串号。

前端 Axios 也会为每次请求生成 `X-Request-Id`，并在异常转换中保留后端返回的 requestId。线上出现“点击发布没反应”时，可以同时记录浏览器响应、时间、操作和 requestId，再去服务端日志定位，而不是只凭一句“页面报错”排查。

## 十、部署实现和发布链路

### 10.1 Docker 构建细节

后端 Dockerfile 使用多阶段构建：

```text
maven:3.9.9-eclipse-temurin-17
  -> 依赖下载、编译、打包
eclipse-temurin:17-jre
  -> 只携带 JAR，以非 root 用户 eventflow 运行
```

前端 Dockerfile 也使用两阶段构建：先用 Node 22 和 pnpm 构建 React 静态文件，再复制到 Nginx 运行镜像。这样生产镜像不需要 Node、Maven 和完整源码，运行时体积和攻击面都更小。

这里有一个很容易踩的路径坑：`frontend/Dockerfile` 在构建阶段需要仓库根目录的 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`，所以 Compose 中前端的 build context 必须是仓库根目录，Dockerfile 路径才是 `frontend/Dockerfile`。如果把 context 错写成 `../frontend`，Dockerfile 中的根目录文件就无法 COPY。

### 10.2 容器和 Nginx 的网络边界

Compose 中后端只 `expose: 8080`，不直接映射到公网；前端容器映射到宿主机回环地址 `127.0.0.1:8083`，再由宿主机 Nginx 对外提供访问。MySQL 也只绑定宿主机回环地址，Redis 和 RabbitMQ 不暴露宿主机端口。

前端容器内的 Nginx 有三类重要配置：

```nginx
location /api/ {
    proxy_pass http://backend:8080;
}

location = /actuator/health {
    proxy_pass http://backend:8080/actuator/health;
}

location / {
    try_files $uri $uri/ /index.html;
}
```

第一段让浏览器使用同源 `/api` 访问后端，避免前端把内网地址暴露给用户。第二段让发布脚本可以通过前端入口检查后端健康。第三段是 React Router 刷新不返回 404 的关键，如果漏掉 SPA fallback，直接刷新 `/events` 会被 Nginx 当成静态文件查找。

头像上传还有多层大小限制：Spring multipart 限制单文件 5 MB、请求 6 MB，Nginx 也设置 6 MB。只改其中一层会出现“后端允许但网关 413”或“网关允许但后端拒绝”的体验不一致。

### 10.3 GitHub Actions 的 CI 和手动 CD

CI 工作流在推送 `main`、针对 `main` 的 Pull Request 或手动触发时运行：

```text
Frontend job:
  pnpm install --frozen-lockfile
  ESLint
  TypeScript typecheck
  Vitest
  Vite build

Backend job:
  Java 17
  Maven verify
  Checkstyle
  JUnit/Mockito tests
  JAR packaging
```

生产发布是独立的 `workflow_dispatch` 工作流，输入发布范围 `frontend`、`backend` 或 `all`，并要求人工确认。它不会因为一次 `git push` 自动改变服务器。

发布工作流会先检出 `main` 的当前提交，读取精确 SHA，调用 GitHub Checks API 确认这个 SHA 对应的前端和后端 CI 都成功，然后通过 SSH 执行服务器脚本。服务器脚本还会再次检查：

- `/opt/eventflow` 必须是 Git 仓库。
- 当前分支必须是 `main`。
- 工作区不能有未提交改动。
- `origin/main` 的 SHA 必须和 GitHub Actions 发布的 SHA 完全相同。
- 发布后 `/actuator/health` 必须在限定时间内返回 HTTP 200。

后端或全量发布前执行数据库备份；如果部署失败，脚本会输出 Compose 状态和最近的后端、前端日志，便于在 Actions 页面直接排查。

SSH 私钥、known hosts、数据库密码、JWT secret 和 `deploy/.env` 都不进入 Git。工作流只保存 GitHub Secrets，服务器保留生产配置。首次配置时使用专用部署密钥而不是个人 SSH 密钥，也是为了缩小泄露后的影响范围。

## 十一、测试覆盖了什么，还没有覆盖什么

当前后端测试共 34 项，前端测试共 10 项。主要覆盖：

### 后端

- 活动只能在允许状态下编辑、提交、发布和下架。
- 提交审核前必须有场次，驳回必须有原因。
- 场次开始时间、结束时间和名额校验。
- 报名窗口开始前、结束后和活动未发布时拒绝报名。
- 条件更新返回 0 时返回名额冲突。
- 重复确认报名被拒绝，取消后释放名额。
- 取消其他用户的报名返回无权限。
- 创建者报名管理的分页筛选、状态统计和联系方式脱敏。
- JWT issuer、过期时间、角色和无效 token。
- RequestId 的生成、透传、响应返回和清理。
- 头像类型、大小和文件魔数校验。

### 前端

- 路由和角色默认入口。
- 活动广场报名、取消和数据刷新。
- Session Store 切换用户和退出时清空服务端缓存。
- Axios 错误转换和 requestId 保留。
- 401 刷新相关的客户端行为。

这些测试足以防止很多回归，但有三类风险不能只靠当前测试宣称已经解决：

1. 没有完整的 Playwright 或浏览器 E2E 流程，无法自动证明从注册到审核、发布、报名、取消的跨页面闭环。
2. `RegistrationServiceTest` 使用 Mockito 验证业务编排，并不等于已经在真实 MySQL InnoDB 中完成多线程并发压测。
3. 没有跨标签页的 refresh token 协调测试，也没有消息队列消费者和缓存失效策略的测试，因为这些能力尚未接入当前主流程。

真正严谨的下一步应该是在 Testcontainers MySQL 环境中启动真实表结构，构造多个并发报名请求，验证成功数量不超过 `total_quota`，并检查每次失败事务没有留下错误的报名记录或配额变化。

## 十二、项目中最容易踩的坑

### 坑一：把前端状态当成权限控制

前端根据状态隐藏“编辑”“发布”按钮，不代表接口安全。后端必须重新查询活动、校验 `createUserId` 和状态。否则用户只要改请求就可以编辑别人的活动，或者在审核未通过时直接发布。

### 坑二：把一次查询当成库存锁

`SELECT available_quota` 只是读取，不是占用。并发场景最终必须以条件更新影响行数为准。Redis 锁也不能替代数据库中的最终约束，因为报名记录和名额变化仍需要落在同一个事实源里。

### 坑三：唯一约束字段选错

如果唯一约束写成 `(activity_id, session_id, user_id)`，用户就可以报名同一活动的多个场次，违反当前业务规则。约束字段必须从业务不变量推导，而不是从表面字段组合随便选择。

### 坑四：取消时直接删除报名记录

直接删除会丢历史，也无法自然支持取消后再次报名。使用 `CANCELLED` 状态和重新激活逻辑，既保留事实，又能复用唯一键。相应地，取消和重新报名都必须通过条件状态更新处理并发。

### 坑五：只写应用层校验，不写数据库约束

应用层校验可以返回友好提示，但不能阻止所有写入口，也不能独自解决并发。配额守恒使用数据库 `CHECK`，重复报名使用唯一索引，库存扣减使用条件更新，这些规则应该尽可能让数据库也能表达。

### 坑六：时间测试直接使用系统当前时间

报名窗口和场次开始时间都依赖当前时间。如果生产代码直接调用 `LocalDateTime.now()`，测试会随着时间变化而不稳定。项目通过 Spring 注入 `Clock`，测试使用固定时钟，并在 JDBC URL 中指定 `serverTimezone=Asia/Shanghai`，让业务时间判断可重复验证。

### 坑七：refresh token 轮换却没有处理并发 401

服务端轮换 refresh token 后，客户端仍然可能有多个请求同时拿旧 token 刷新。前端必须合并刷新请求，并在刷新成功后保存服务端返回的新 refresh token。否则看起来像“偶发登录失效”，实际是客户端并发时序没有处理好。

### 坑八：Docker build context 写错

前端 Dockerfile 使用 workspace 根目录的锁文件和 package 文件，所以 Compose 的 build context 不能只指向 `frontend`。这种问题本地直接用 Vite 启动时不明显，到了服务器 Docker 构建才会失败，是典型的“开发命令能跑、生产构建失败”。

### 坑九：只检查容器启动，不检查用户入口

`docker compose ps` 显示 Up 只代表进程没有退出，不代表用户访问链路正确。发布后还要检查 `/actuator/health`、SPA 路由刷新、`/api` 反代、头像上传大小和一条核心业务流程。EventFlow 的发布脚本把健康检查作为硬门槛，但业务验收仍需要浏览器走一遍。

### 坑十：把已配置的基础设施写成已使用

Redis 和 RabbitMQ 当前已进入 Compose 与生产配置，但报名、审核和资料业务没有读写它们；V001 也预留了 outbox 和 processed event 表，但没有对应的消息生产和消费闭环。工程文档必须区分“已部署”“已配置”“已接入主链路”和“已验证”，否则会把架构图误写成实际能力。

## 十三、当前版本的边界和后续方向

当前版本已经完成：

- 活动创建、编辑、场次配置、审核、驳回、发布和下架。
- 普通用户报名、取消、我的报名和公开活动浏览。
- 创建者和管理员报名管理、筛选分页、统计和联系方式脱敏。
- JWT、refresh token 轮换、退出、改密、头像上传和资料维护。
- Flyway 迁移、Docker Compose、Nginx、健康检查和 GitHub Actions CI。
- 生产发布的手动确认、精确版本校验和发布后健康检查脚本。

当前没有完成或没有接入核心链路的能力包括：

- Redis 缓存或 Redis 库存扣减。
- RabbitMQ 消息生产、通知消费者和异步任务。
- 候补名单、临时预约超时释放、签到核销。
- 完整浏览器 E2E 测试。
- 真实数据库并发压测和容量基线。
- 多标签页 refresh token 协调。

后续迭代不应该简单地把所有中间件接进来，而应先明确业务需求。例如候补名单需要定义取消后如何排序、通知失败如何重试；临时预约需要定义锁定时长、定时释放和幂等；消息通知需要可靠投递、消费幂等和失败补偿；并发压测需要真实数据库、并发模型和成功数量断言。这些问题先被定义，技术选型才有意义。

## 结语：项目含金量来自取舍和证据

EventFlow 给我的最大变化，是开始把“页面能操作”与“系统能可靠交付”分开考虑。

报名防超卖不是一句“用了事务”就结束，而是要说明条件更新如何判断库存、唯一约束防什么重复、状态更新如何处理取消重报、异常如何触发回滚；认证不是一句“用了 JWT”，而是要说明 access token 和 refresh token 为什么分开、refresh token 为什么只存哈希、轮换后客户端如何处理并发 401；部署也不是一句“用了 Docker”，而是要说明构建上下文、Nginx 反代、SPA fallback、Secret 边界、精确提交校验和健康检查分别解决什么问题。

这些具体的约束、失败路径和未完成边界，才是这个项目真正值得记录的部分。项目地址：[GitHub - Wybell/eventflow](https://github.com/Wybell/eventflow)
