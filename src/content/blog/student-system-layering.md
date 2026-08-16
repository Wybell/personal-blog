---
title: "从一次学生列表请求理解 Spring Boot 分层"
description: "以教务系统的 /student/list 为例，拆解 Controller、Service、Mapper、MySQL 和 Redis 的职责边界，记录我第一次真正理解后端分层的过程。"
pubDate: 2026-08-16
updatedDate: 2026-08-16
section: learning
projectSlug: student-system
cover: /cover-learning-layering.png
coverAlt: "Spring Boot 分层学习封面"
tags:
  - Java 17
  - Spring Boot
  - Spring MVC
  - MyBatis
  - 分层架构
featured: false
---

刚开始写教务系统时，我最先关注的是“接口能不能返回学生数据”。随着代码逐渐增加，我才发现，真正需要理解的不是某个注解怎么写，而是一次请求为什么要经过 Controller、Service、Mapper，再到 MySQL，缓存又应该放在哪一层。

这篇文章不把分层当成一套需要背下来的目录模板，而是从项目中的 `GET /student/list` 出发，说明每一层实际承担什么责任，以及这样拆分之后解决了什么问题。

## 先看完整请求链路

教务系统中的学生列表请求可以简化成下面这条路径：

```text
浏览器 GET /student/list
        |
        v
StudentController
        |
        v
StudentService.findAll()
        |
        +--> Redis 读取 students:all
        |       |
        |       +--> 命中：直接返回列表
        |       |
        |       +--> 未命中：继续访问 Mapper
        |
        v
StudentMapper.findAll()
        |
        v
StudentMapper.xml -> MySQL student 表
        |
        v
Service 写入缓存并返回 Result<List<Student>>
```

这条链路里，每一层都做了一件相对明确的事。Controller 负责把 HTTP 请求交给业务层；Service 决定查询顺序和缓存策略；Mapper 负责执行数据访问；MySQL 保存真正的学生数据；最后由 Controller 返回统一响应。

## Controller：处理协议，不承载全部业务

`StudentController` 使用 `@RestController` 和 `@RequestMapping("/student")` 统一定义学生接口。查询列表的方法只需要调用 `studentService.findAll()`，再用 `Result.success(students)` 包装结果。

```java
@GetMapping("/list")
public Result<List<Student>> findAll() {
    List<Student> students = studentService.findAll();
    return Result.success(students);
}
```

Controller 需要关注的是路径、HTTP 方法、请求参数和响应格式，而不是把 Redis 判断、SQL 语句和数据更新逻辑全部写在这里。这样做的直接好处是，接口层不会因为缓存策略变化而不断膨胀，Service 也可以被其他入口复用。

当然，当前项目的 Controller 仍然比较基础。它使用实体类直接接收请求，没有加入 Bean Validation，也没有统一处理异常；`/student/page` 还返回了页面名称字符串，但类本身是 `@RestController`，这说明页面路由和接口路由还需要进一步拆分。学习项目最有价值的地方，往往就是这些边界会明确暴露出来。

## Service：把一次业务动作组织起来

Service 不是简单地把 Mapper 方法再调用一遍。教务系统中的 `StudentServiceImpl.findAll()` 至少需要完成三个判断：

1. 先检查 Redis 中是否存在学生列表。
2. 缓存未命中时访问 MySQL。
3. 查询成功后把结果写回缓存，再返回给 Controller。

```java
List<Student> cachedList =
    redisTemplate.opsForValue().get(ALL_STUDENTS_KEY);

if (cachedList != null && !cachedList.isEmpty()) {
    return cachedList;
}

List<Student> students = studentMapper.findAll();
redisTemplate.opsForValue().set(
    ALL_STUDENTS_KEY,
    students,
    30,
    TimeUnit.MINUTES
);
return students;
```

这段逻辑属于业务流程协调，而不是单纯的数据访问。以后如果要增加日志、权限判断、缓存降级或查询条件，通常也应该先考虑 Service 的职责边界，而不是让 Controller 直接绕过 Service 访问基础设施。

## Mapper：让 SQL 有明确的归属

项目使用 MyBatis Mapper 接口和 XML 文件。`StudentMapper` 只声明 `findAll`、`findById`、`insert`、`update` 和 `deleteById` 等数据访问方法，真正的 SQL 写在 `StudentMapper.xml` 中：

```xml
<select id="findAll"
        resultType="com.example.studentsystem.model.entity.Student">
    SELECT * FROM student
</select>
```

这样做让我能同时看到 Java 方法和 SQL 语句之间的对应关系。配置中的 `map-underscore-to-camel-case: true` 还可以把数据库中的 `student_no` 映射到 Java 实体的 `studentNo`，减少手写字段映射的重复代码。

Mapper 的边界也需要保持清楚：它负责“如何访问数据”，不负责决定“什么时候使用缓存”或“用户是否已经认证”。这些判断放在 Service 和 Security 配置中，后续排查问题时才能快速定位：SQL 错了看 Mapper，缓存错了看 Service，接口协议错了看 Controller。

## Entity 和 Result：先跑通，再逐步解耦

`Student` 目前同时承担数据库结果映射、Service 传递和接口返回数据的角色，包含学号、姓名、年龄、专业、班级、联系方式和时间字段。对于一个小型学习项目，这种直接复用可以快速把链路打通。

但随着业务复杂度增加，数据库实体和接口 DTO 之间最好逐步分开：

```text
请求 DTO       只描述客户端允许提交的字段
Entity         只描述数据库模型
响应 DTO       只暴露接口需要返回的字段
```

`Result<T>` 则把 `code`、`message` 和 `data` 统一起来，让前端可以使用相同的解析方式。当前错误码还比较粗糙，后续应该把参数错误、资源不存在、未认证和服务器异常区分开，并交给全局异常处理器统一转换。

## 为什么不让 Controller 直接访问 Mapper

如果 Controller 直接调用 Mapper，最初确实少写一层代码，但很快会遇到几个问题：

- 缓存判断会散落到多个接口方法里。
- 同一条业务规则可能在不同接口中重复实现。
- Service 逻辑难以单独测试。
- 以后更换缓存、增加权限或接入其他入口时，需要修改大量 Controller。

分层的价值不是让代码看起来“更像标准项目”，而是让变化有稳定的落点。教务系统很简单，但它已经存在三种不同类型的变化：接口协议可能变化，缓存策略可能变化，SQL 和数据表可能变化。把它们放在不同边界内，后续修改的影响范围会更容易控制。

## 这次学习留下的边界

当前项目已经通过 Maven Wrapper 完成 Spring Boot 上下文启动测试，但还没有完整覆盖 Controller、Service、Mapper、Redis 和登录流程。字段注入、参数校验、统一异常、DTO、缓存异常降级和前端编辑交互，也都属于后续工作。

因此，我现在对 Spring Boot 分层的理解不是“有 Controller、Service、Mapper 就完成了”，而是：每一层要有可解释的责任，每一次跨层调用都要有明确目的，尚未验证的部分要被单独标记。后续 AI 面试助手和 EventFlow 中更复杂的产品链路、权限和一致性问题，都是从这次对一次简单请求的拆解开始的。
