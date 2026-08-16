---
title: "教务系统：从基础 CRUD 开始理解 Spring Boot"
description: "基于第一个 Java 后端学习项目，复盘 Spring Boot 分层、MyBatis XML、Redis 缓存、Spring Security 和真实完成边界。"
pubDate: 2026-08-14
updatedDate: 2026-08-16
section: project
projectSlug: student-system
cover: /technical-learning-card.png
coverAlt: "教务系统 Spring Boot 项目封面"
tags:
  - Java 17
  - Spring Boot
  - Spring MVC
  - MyBatis
  - MySQL
  - Redis
  - Spring Security
featured: true
---

教务系统是我真正开始理解后端项目结构的第一个项目。它围绕学生信息管理展开，功能主要是登录、学生列表、按 ID 查询、新增、修改和删除。功能规模并不大，但它让我第一次把浏览器请求、Controller、Service、Mapper、MySQL、Redis、Spring Security 和前端页面连成一条完整链路。

现在回头看，它应该被定义为一个 Java 后端学习项目，而不是已经达到生产要求的教务平台。它的价值不在于页面数量，而在于让我第一次面对一个具体问题：一个请求应该由哪些层负责，数据应该怎样访问，认证应该放在哪里，缓存更新之后怎样避免继续读取旧数据，以及哪些地方还没有完成工程化。

## 一、项目目标与完成边界

项目的目标是完成一个最小可用的学生信息管理流程：用户登录后访问学生管理接口，查询学生列表或单个学生，并执行新增、修改和删除操作。后端接口已经围绕这些能力建立起来，静态前端页面完成了学生列表展示、刷新和删除确认；新增与编辑交互、完整的登录后页面跳转仍然属于后续完善内容。

因此，本文会明确区分三类事实：

- 后端已经实现的接口和服务逻辑。
- 当前前端页面实际接上的交互。
- 仍然缺少测试、校验、异常处理和更完整交互的部分。

这种区分对第一个项目很重要。项目能够启动和接口能够返回，并不等于它已经覆盖了生产系统需要考虑的所有场景。

## 二、技术栈与项目结构

项目后端使用 Java 17 和 Maven，核心依赖包括 Spring Boot 4.0.3、Spring Web MVC、MyBatis 4.0.1、MySQL、Redis、Spring Security、Druid 和 Lombok。前端是放在后端静态资源目录中的 Vue 3 页面，使用 Element Plus 组件和 Axios CDN 发送请求。

项目结构大致如下：

```text
src/main/java/com/example/studentsystem
├── config
│   ├── RedisConfig.java
│   └── SecurityConfig.java
├── controller
│   └── StudentController.java
├── service
│   ├── StudentService.java
│   └── impl
│       ├── DatabaseUserDetailsService.java
│       └── StudentServiceImpl.java
├── mapper
│   ├── StudentMapper.java
│   └── UserMapper.java
├── model/entity
│   ├── Result.java
│   ├── Student.java
│   └── User.java
└── util
    └── PasswordGenerator.java

src/main/resources
├── mapper
│   ├── StudentMapper.xml
│   └── UserMapper.xml
├── static
│   └── student-list.html
└── application.yml
```

分层的意义不是把文件夹分得越多越好，而是让职责有明确归属：Controller 负责 HTTP 入口和响应，Service 负责组织业务流程，Mapper 负责数据访问，Entity 表达数据结构，Config 集中放认证和 Redis 等基础设施配置。后续即使项目规模变大，也应该先保持这种边界，再决定是否需要更复杂的模块划分。

## 三、数据模型与统一响应

`Student` 主要表达学生信息，包括：

```text
id          数据库主键
studentNo   学号
name        姓名
age         年龄
major       专业
className   班级
contact     联系方式
createTime  创建时间
updateTime  更新时间
```

`User` 用于登录认证，包含用户名、密码和角色信息。`Result<T>` 用于包装接口响应，表达状态码、消息和业务数据：

```json
{
  "code": 200,
  "message": "success",
  "data": []
}
```

统一响应的好处是前端不需要为每个接口设计一套完全不同的解析方式，Axios 请求完成后可以从 `response.data.data` 读取真正的列表或对象。它目前仍然是项目级的基础实现，后续还可以继续补充统一错误码、参数校验失败结构和全局异常处理。

## 四、接口范围

| 方法 | 路径 | 用途 | 当前边界 |
| --- | --- | --- | --- |
| GET | `/student/list` | 查询学生列表 | 后端接口已实现，前端用于列表展示和刷新 |
| GET | `/student/{id}` | 按 ID 查询学生 | 后端接口已实现，主要供详情查询使用 |
| POST | `/student/add` | 新增学生 | 后端接口已实现，前端交互仍需补齐 |
| PUT | `/student/update` | 修改学生 | 后端接口已实现，前端编辑流程仍需补齐 |
| DELETE | `/student/{id}` | 删除学生 | 前端通过确认框触发删除 |

这些接口没有被包装成复杂的分页、筛选或多角色平台。当前项目的重点是走通基础 CRUD 和认证链路，分页、请求 DTO、字段校验、复杂权限和并发更新控制都属于后续工程化方向。

## 五、一次查询请求是怎样走完的

以查询全部学生为例，请求链路可以概括为：

```text
浏览器 GET /student/list
        |
        v
StudentController
        |
        v
StudentServiceImpl
        |
        +--> Redis 读取 students:all
        |       |
        |       +--> 命中：直接返回缓存列表
        |       |
        |       +--> 未命中：调用 StudentMapper
        |
        v
StudentMapper -> StudentMapper.xml -> MySQL student 表
        |
        v
写入 Redis，返回 Result<List<Student>>
```

Controller 不直接拼接 SQL，是为了让接口层只处理请求和响应；Service 负责决定查询顺序、缓存策略和失效动作；Mapper 负责把 Java 方法映射到 XML 中的 SQL。这样做的一个实际好处是，后续调整缓存策略时不需要把缓存判断散落到多个 Controller 中。

## 六、MyBatis XML 数据访问

项目通过 `StudentMapper` 定义数据访问方法，通过 `StudentMapper.xml` 编写 SQL。相比把 SQL 直接拼接在业务代码中，XML 让查询语句、参数和结果映射更容易被单独检查。配置中的下划线转驼峰可以把数据库字段例如 `student_no` 映射到 Java 属性 `studentNo`，减少手写映射的重复工作。

当前实现采用 Entity 直接承接数据库结果和接口返回数据，适合第一个项目快速走通链路，但也留下了一个明确改进点：后续可以使用请求 DTO 和响应 DTO 隔离数据库模型，避免表结构变化直接影响公开接口。

## 七、Redis 缓存：先理解命中，再理解失效

项目使用两类主要缓存键：

```text
students:all   学生列表
student:{id}   单个学生详情
```

缓存读取采用 Cache Aside 思路：先查 Redis，命中则直接返回；未命中时查询 MySQL，再把结果写入 Redis，当前 TTL 为 30 分钟。写操作成功后需要清理相关缓存：新增、修改和删除至少要让 `students:all` 失效，修改或删除还要清理对应的 `student:{id}`，否则下一次读取可能拿到旧数据。

这部分让我第一次认识到，缓存不是“加一个 RedisTemplate 就结束”。真正需要回答的是：缓存了什么，键怎么设计，数据变化后哪些键必须失效，空列表是否缓存，Redis 不可用时系统是否可以降级，以及缓存一致性是否有测试证明。

当前项目的边界也需要写清楚：没有把空结果缓存、Redis 故障降级、缓存命中率监控和真实缓存场景测试做完整；它更适合作为第一次理解缓存读写与失效关系的实现，而不是高并发生产缓存方案。

## 八、Spring Security 认证链路

项目使用 Spring Security 的表单登录流程。登录入口放行，`/student/**` 需要认证。用户信息由 `DatabaseUserDetailsService` 从 `user` 表加载，密码通过 BCrypt 校验。认证成功后，SecurityContext 保存当前认证信息，退出登录由 Spring Security 负责处理。

角色名称需要注意 `ROLE_` 前缀规则：如果业务角色是 `ADMIN`，在 Spring Security 的权限判断中通常会对应 `ROLE_ADMIN`。当前项目已经具备从数据库读取用户并完成基础认证的路径，但还没有展开细粒度的角色权限和资源归属校验。

项目配置中关闭了 CSRF，这是为了让当前学习项目的接口调用更容易调试；如果把表单认证应用在真实生产环境，不能只复制这个配置，需要结合认证方式、Cookie、跨站请求风险和前后端部署方式重新评估。密码也不能使用明文，数据库连接和 Redis 配置则不应长期硬编码在公开配置中。

## 九、前端目前真正完成了什么

`student-list.html` 使用 Vue 3 管理页面状态，Element Plus 提供表格、按钮和删除确认框，Axios 负责调用后端接口。列表请求成功后，页面读取 `response.data.data` 并渲染学生字段；点击删除时先弹出确认框，再调用删除接口，成功后重新加载列表。

当前前端更准确的描述是“静态管理页面的基础版本”：学生列表、刷新和删除链路已经接通，新增表单、编辑交互、登录页跳转和更完整的错误提示仍然需要补齐。把后端接口已经存在直接写成“前端功能全部完成”，会掩盖项目真实边界，也不利于后续排查问题。

## 十、构建、测试与不足

项目可以通过 Maven Wrapper 构建，当前测试主要是 Spring Boot 应用上下文启动测试。它能说明依赖和基础配置至少可以让应用启动，但不能等同于 Controller、Service、Mapper、缓存和认证场景都已覆盖。

结合当前代码，后续需要补的工程能力包括：

- 将环境相关的数据库和 Redis 配置改为环境变量或配置中心管理。
- 将字段注入逐步改为构造器注入，明确依赖并改善可测试性。
- 为新增和修改增加 DTO、字段校验、错误码和全局异常处理。
- 为 Service 的列表查询、缓存命中、缓存失效和删除失败补充单元测试。
- 在真实 MySQL 和 Redis 环境中验证数据访问与缓存行为，而不是只验证应用能启动。
- 完成登录后的页面跳转、前端编辑交互和统一错误提示。
- 明确并发修改和重复提交的处理策略，避免把第一个项目的简单实现直接照搬到更复杂业务。

这些不足并不否定项目价值。相反，第一次项目能把不足暴露出来，后面的 AI 面试助手和 EventFlow 才有明确的改进方向。项目经验不只是“页面能不能点”，还包括知道自己已经验证了什么、没有验证什么，以及下一步为什么要补它。

## 十一、它在我的项目路径中的位置

教务系统是能力路径的起点：我先理解 Controller、Service、Mapper 和数据库之间的职责，再在 AI 面试助手中学习如何把多个功能组织成完整产品，最后在 EventFlow 中处理状态机、角色权限、场次配额、报名一致性和工程交付。

这三个项目不是孤立的技术名词集合，而是一次逐步加深的实践过程：

```text
教务系统
  -> 分层、CRUD、MyBatis、MySQL、Redis、基础认证
AI 面试助手
  -> 产品闭环、JWT、SSE、Flyway、AI 外部服务、部署
EventFlow
  -> 状态机、权限边界、配额不变量、条件更新、唯一约束、事务、CI/CD
```

对我来说，教务系统最重要的结果不是完成了多少页面，而是让我第一次把一次请求从浏览器拆到数据库，再从数据库返回到页面。后续项目的复杂度增加之后，我仍然会回到这个问题：每一层到底负责什么，当前事实在哪里，失败之后怎样保持边界清楚。
